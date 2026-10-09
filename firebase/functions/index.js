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
  if (!snapshot.exists) return;
  output.push({ path: ref.path, data: cleanForJson(snapshot.data()) });
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
    format: 'telastro-factory-reset-backup-v1',
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
