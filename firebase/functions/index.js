const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { gzipSync } = require('node:zlib');

initializeApp();

// Keep this UID in sync with admin/firebase-config.js and firebase/firestore.rules.
const ADMIN_UID = 'YnfQtmTpm9asdR0izeWuMwmX3Sw1';
const RESET_CONFIRMATION = 'RESET ALL NON-ADMIN DATA';

function cleanForJson(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (item && typeof item.toDate === 'function') return item.toDate().toISOString();
    if (item && item.constructor && item.constructor.name === 'DocumentReference') return item.path;
    if (Buffer.isBuffer(item)) return item.toString('base64');
    return item;
  }));
}

async function exportDocumentRecursively(ref, output) {
  const snapshot = await ref.get();
  // Firestore can contain subcollections even when the parent document is missing.
  // Export children regardless of whether this particular document exists.
  if (snapshot.exists) output.push({ path: ref.path, data: cleanForJson(snapshot.data()) });
  const children = await ref.listCollections();
  for (const childCollection of children) {
    const childRefs = await childCollection.listDocuments();
    for (const childRef of childRefs) {
      await exportDocumentRecursively(childRef, output);
    }
  }
}

async function listAllAuthUsers(auth) {
  const output = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      output.push({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        disabled: Boolean(user.disabled),
        creationTime: user.metadata?.creationTime || null,
        lastSignInTime: user.metadata?.lastSignInTime || null,
        providers: (user.providerData || []).map(p => p.providerId)
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return output;
}


exports.redeemActivationKey = onCall({
  region: 'asia-south1',
  timeoutSeconds: 60,
  memory: '512MiB'
}, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in with Google before redeeming an activation key.');
  }
  const code = String(request.data?.code || '').trim().toUpperCase();
  const clientProduct = String(request.data?.product || '').trim().toLowerCase();
  if (!code) throw new HttpsError('invalid-argument', 'Activation key is required.');
  if (!['meesho', 'flipkart'].includes(clientProduct)) {
    throw new HttpsError('invalid-argument', 'Product must be meesho or flipkart.');
  }

  const db = getFirestore();
  const uid = request.auth.uid;
  const email = String(request.auth.token.email || '').toLowerCase();
  const now = new Date();
  const nowIso = now.toISOString();
  const keyRef = db.collection('activationKeys').doc(code);
  const userRef = db.collection('users').doc(uid);
  const legacyMembershipRef = db.collection('memberships').doc(uid);
  const productMembershipRef = db.collection('productMemberships').doc(uid);

  return db.runTransaction(async (tx) => {
    // All reads happen before writes, so consuming a key and issuing entitlements is atomic.
    const keySnap = await tx.get(keyRef);
    if (!keySnap.exists) throw new HttpsError('not-found', 'Activation key was not found.');
    const key = keySnap.data();
    if (String(key.status || '').toUpperCase() !== 'AVAILABLE') {
      throw new HttpsError('already-exists', 'This activation key has already been used or is unavailable.');
    }
    if (key.assignedEmail && String(key.assignedEmail).toLowerCase() !== email) {
      throw new HttpsError('permission-denied', 'This activation key is assigned to another Gmail account.');
    }

    const planRef = db.collection('plans').doc(String(key.planId || ''));
    const [planSnap, productSnap, legacySnap, userSnap] = await Promise.all([
      tx.get(planRef), tx.get(productMembershipRef), tx.get(legacyMembershipRef), tx.get(userRef)
    ]);
    if (!planSnap.exists || planSnap.data().active === false) {
      throw new HttpsError('failed-precondition', 'The plan attached to this key is not active.');
    }
    const plan = planSnap.data();
    let includedProducts = Array.isArray(key.includedProducts) && key.includedProducts.length
      ? key.includedProducts
      : (Array.isArray(plan.includedProducts) && plan.includedProducts.length
        ? plan.includedProducts
        : [String(key.productScope || plan.productScope || 'meesho') === 'combined'
          ? 'meesho' : String(key.productScope || plan.productScope || 'meesho')]);
    includedProducts = [...new Set(includedProducts.map(p => String(p).toLowerCase()))];
    if (includedProducts.some(p => !['meesho', 'flipkart'].includes(p))) {
      throw new HttpsError('failed-precondition', 'The plan contains an unknown product scope.');
    }
    if (!includedProducts.includes(clientProduct)) {
      throw new HttpsError('permission-denied', `This key does not include ${clientProduct}. Open the matching extension or purchase a Combined plan.`);
    }

    const durationDays = Number(key.durationDays ?? plan.durationDays ?? 0);
    const oldRecord = productSnap.exists ? productSnap.data() : {};
    const products = { ...(oldRecord.products || {}) };
    const legacyMembership = legacySnap.exists ? legacySnap.data() : null;
    const commonName = String(key.planName || plan.name || key.planId || 'Membership');
    const commonPlanId = String(key.planId || planRef.id);

    for (const product of includedProducts) {
      let oldEntitlement = products[product] || null;
      if (product === 'meesho' && !oldEntitlement && legacyMembership) oldEntitlement = legacyMembership;
      const oldStatus = String(oldEntitlement?.status || '').toUpperCase();
      const oldExpiry = oldEntitlement?.expiryDate ? new Date(oldEntitlement.expiryDate).getTime() : 0;
      const oldActive = oldStatus === 'ACTIVE' && (!oldEntitlement?.expiryDate || oldExpiry > now.getTime() || Number(oldEntitlement?.durationDays || 0) === 0);

      // Never shorten an existing active lifetime entitlement.
      if (oldActive && Number(oldEntitlement.durationDays || 0) === 0 && durationDays !== 0) {
        products[product] = oldEntitlement;
        continue;
      }

      const start = oldActive && oldExpiry > now.getTime() ? new Date(oldExpiry) : now;
      const expiry = durationDays === 0 ? null : new Date(start.getTime() + durationDays * 86400000).toISOString();
      products[product] = {
        uid, email, product, planId: commonPlanId, planName: commonName,
        productScope: includedProducts.length > 1 ? 'bundle' : product,
        includedProducts, status: 'ACTIVE', durationDays,
        shippingEnabled: true, autofillEnabled: true,
        startDate: start.toISOString(), expiryDate: expiry,
        activationKey: code, source: 'ACTIVATION_KEY',
        activatedAt: nowIso, updatedAt: nowIso
      };
    }

    // Keep a flat entitlement at the root for the Flipkart extension while retaining per-product records.
    // The root scope must describe the chosen root entitlement, not whichever product the latest key activated.
    // Otherwise a Meesho-only renewal could make an existing Flipkart entitlement appear to be Meesho-only.
    const topProduct = products.flipkart ? 'flipkart' : 'meesho';
    const topEntitlement = products[topProduct] || {};
    tx.set(productMembershipRef, {
      ...topEntitlement,
      uid, email, products,
      product: topProduct,
      productScope: topEntitlement.productScope || topProduct,
      includedProducts: topEntitlement.includedProducts || [topProduct],
      activationKey: topEntitlement.activationKey || code,
      lastActivationKey: code,
      lastIncludedProducts: includedProducts,
      lastActivatedAt: nowIso,
      updatedAt: nowIso
    }, { merge: true });

    // The existing Meesho extension reads memberships/{uid}; keep that legacy record in sync
    // only when the redeemed key includes Meesho. A Flipkart-only purchase leaves it untouched.
    if (includedProducts.includes('meesho')) {
      const ent = products.meesho;
      tx.set(legacyMembershipRef, {
        uid, email, planId: ent.planId, planName: ent.planName,
        productScope: ent.productScope, includedProducts: ent.includedProducts,
        status: ent.status, durationDays: ent.durationDays,
        shippingEnabled: true, autofillEnabled: true,
        startDate: ent.startDate, expiryDate: ent.expiryDate,
        activationKey: code, activatedAt: ent.activatedAt, updatedAt: nowIso
      }, { merge: true });
    }

    tx.set(userRef, {
      uid, email, lastLoginAt: nowIso,
      lastMembershipPlan: commonPlanId,
      membershipUpdatedAt: nowIso,
      membershipProducts: includedProducts
    }, { merge: true });
    tx.update(keyRef, {
      status: 'REDEEMED', redeemedBy: uid, redeemedEmail: email,
      redeemedAt: nowIso, redeemedProducts: includedProducts
    });

    return { ok: true, code, includedProducts, planId: commonPlanId, planName: commonName };
  });
});

exports.factoryResetNonAdminData = onCall({
  region: 'asia-south1',
  timeoutSeconds: 540,
  memory: '2GiB'
}, async (request) => {
  if (!request.auth || request.auth.uid !== ADMIN_UID) {
    throw new HttpsError('permission-denied', 'Only the configured Admin UID can run factory reset.');
  }
  if (request.data?.confirmText !== RESET_CONFIRMATION) {
    throw new HttpsError('invalid-argument', 'The exact reset confirmation phrase is required.');
  }

  const db = getFirestore();
  const auth = getAuth();
  const timestamp = new Date().toISOString();
  const firestoreDocuments = [];
  const rootCollections = await db.listCollections();

  // Export every document and nested subcollection before deleting anything.
  for (const collectionRef of rootCollections) {
    const refs = await collectionRef.listDocuments();
    for (const ref of refs) await exportDocumentRecursively(ref, firestoreDocuments);
  }
  const authUsers = await listAllAuthUsers(auth);
  const backup = {
    format: 'meesho-a-plus-listing-automation-pro-factory-reset-backup-v1',
    projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '',
    createdAt: timestamp,
    preservedAdminUid: ADMIN_UID,
    note: 'Firestore document data and Firebase Authentication user metadata. This is a logical JSON backup, not a native Firebase import file.',
    firestoreDocuments,
    authUsers
  };
  const compressed = gzipSync(Buffer.from(JSON.stringify(backup), 'utf8'));
  // Fail safely before mutation if the backup is unexpectedly large for a single backup object.
  if (compressed.length > 400 * 1024 * 1024) {
    throw new HttpsError('resource-exhausted', 'Backup is larger than the safe single-file limit; no data was deleted.');
  }

  const backupPath = `factory-reset-backups/${timestamp.replace(/[:.]/g, '-')}.json.gz`;
  const backupFile = getStorage().bucket().file(backupPath);
  try {
    await backupFile.save(compressed, {
      resumable: false,
      metadata: {
        contentType: 'application/gzip',
        cacheControl: 'private, no-store',
        metadata: { projectId: backup.projectId, adminUid: ADMIN_UID, createdAt: timestamp }
      }
    });
  } catch (error) {
    throw new HttpsError('failed-precondition', 'Backup could not be written to Firebase Storage. No Firebase data was deleted.');
  }

  // Delete other Firebase Auth users in batches. Keep the configured Admin UID.
  const removableUids = authUsers.map(u => u.uid).filter(uid => uid !== ADMIN_UID);
  for (let i = 0; i < removableUids.length; i += 1000) {
    const batch = removableUids.slice(i, i + 1000);
    const result = await auth.deleteUsers(batch);
    if (result.failureCount > 0) {
      throw new HttpsError('internal', `Auth reset stopped after backup; ${result.failureCount} user deletion(s) failed. Backup: ${backupPath}`);
    }
  }

  // Delete every Firestore document recursively, except admins/{ADMIN_UID}.
  for (const collectionRef of rootCollections) {
    const refs = await collectionRef.listDocuments();
    for (const ref of refs) {
      if (collectionRef.id === 'admins' && ref.id === ADMIN_UID) continue;
      await db.recursiveDelete(ref);
    }
  }

  // Ensure the sole Admin record remains available for sign-in/bootstrap.
  await db.collection('admins').doc(ADMIN_UID).set({
    uid: ADMIN_UID,
    role: 'owner',
    resetPreserved: true,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  return {
    ok: true,
    backupPath,
    processedFirestoreRootCollections: rootCollections.length,
    deletedAuthUsers: removableUids.length,
    preservedAdminUid: ADMIN_UID,
    nextStep: 'Run Initialize DB / Integration from the Admin Panel to recreate collection markers, default plans, and missing settings.'
  };
});
