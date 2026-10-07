// MEESHO A+ LISTING AUTOMATION PRO — Firebase membership/auth service worker
importScripts('firebase-config.js');

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const FIRESTORE_COMMIT = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit`;
const AUTH_BASE = 'https://identitytoolkit.googleapis.com/v1';
const SECURE_TOKEN_BASE = 'https://securetoken.googleapis.com/v1/token';
const AUTH_SCOPE = ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];

function configReady() {
  return Boolean(
    FIREBASE_CONFIG?.apiKey &&
    !FIREBASE_CONFIG.apiKey.startsWith('PASTE_') &&
    GOOGLE_OAUTH_CLIENT_ID &&
    !GOOGLE_OAUTH_CLIENT_ID.startsWith('PASTE_')
  );
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function getGoogleAccessToken(interactive = false) {
  if (!chrome.identity?.getAuthToken) throw new Error('Chrome Identity API is unavailable.');
  const result = await chrome.identity.getAuthToken({ interactive, scopes: AUTH_SCOPE });
  if (!result?.token) throw new Error('Google sign-in did not return an access token.');
  return result.token;
}

async function removeGoogleToken(token) {
  if (!token || !chrome.identity?.removeCachedAuthToken) return;
  try { await chrome.identity.removeCachedAuthToken({ token }); } catch (_) {}
}

async function firebaseSignInWithGoogle(googleAccessToken) {
  const url = `${AUTH_BASE}/accounts:signInWithIdp?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;
  const body = new URLSearchParams({
    postBody: `access_token=${encodeURIComponent(googleAccessToken)}&providerId=google.com`,
    requestUri: 'https://localhost',
    returnSecureToken: 'true',
    returnIdpCredential: 'false'
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || 'Firebase Google sign-in failed.';
    throw new Error(msg.replaceAll('_', ' '));
  }
  return data;
}

async function refreshFirebaseSession(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  const res = await fetch(`${SECURE_TOKEN_BASE}?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || 'Firebase session refresh failed.');
  }
  const expiresIn = Number(data.expires_in || 3600);
  const next = {
    firebase_id_token: data.id_token,
    firebase_refresh_token: data.refresh_token || refreshToken,
    firebase_expires_at: Date.now() + Math.max(60, expiresIn - 30) * 1000,
    firebase_user_id: data.user_id || ''
  };
  await chrome.storage.local.set(next);
  return next.firebase_id_token;
}

async function getStoredSession() {
  return chrome.storage.local.get([
    'firebase_id_token',
    'firebase_refresh_token',
    'firebase_expires_at',
    'firebase_user',
    'firebase_google_access_token'
  ]);
}

async function getValidFirebaseToken({ interactive = false } = {}) {
  if (!configReady()) return null;
  const session = await getStoredSession();
  if (session.firebase_id_token && Number(session.firebase_expires_at || 0) > Date.now() + 90_000) {
    return session.firebase_id_token;
  }

  if (session.firebase_refresh_token) {
    try {
      return await refreshFirebaseSession(session.firebase_refresh_token);
    } catch (_) {
      await chrome.storage.local.remove(['firebase_id_token', 'firebase_refresh_token', 'firebase_expires_at', 'firebase_user_id']);
    }
  }

  try {
    const googleToken = await getGoogleAccessToken(interactive);
    const auth = await firebaseSignInWithGoogle(googleToken);
    const expiresIn = Number(auth.expiresIn || 3600);
    const user = {
      uid: auth.localId || '',
      email: auth.email || '',
      full_name: auth.displayName || auth.fullName || auth.email || 'Google User',
      name: auth.displayName || auth.fullName || auth.email || 'Google User',
      photoURL: auth.photoUrl || '',
      provider: 'google.com',
      emailVerified: auth.emailVerified !== false
    };
    await chrome.storage.local.set({
      firebase_id_token: auth.idToken,
      firebase_refresh_token: auth.refreshToken,
      firebase_expires_at: Date.now() + Math.max(60, expiresIn - 30) * 1000,
      firebase_user: user,
      firebase_google_access_token: googleToken,
      firebase_user_id: user.uid
    });
    await ensureUserDoc(user, auth.idToken);
    return auth.idToken;
  } catch (e) {
    if (interactive) throw e;
    return null;
  }
}

function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const text = atob(padded);
    const json = decodeURIComponent(Array.from(text, ch => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    return JSON.parse(json);
  } catch (_) { return null; }
}

function fsValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  return { stringValue: String(value ?? '') };
}

function toFirestoreFields(data = {}) {
  const fields = {};
  for (const [key, value] of Object.entries(data)) fields[key] = fsValue(value);
  return fields;
}

function fromFsValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in v) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) out[key] = fromFsValue(value);
  return out;
}

async function firestoreGet(path, token) {
  const res = await fetch(`${FIRESTORE_BASE}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Firestore read failed (${res.status}).`);
  return { name: data.name, fields: fromFirestoreFields(data.fields || {}) };
}

async function firestorePatch(path, data, token, fieldPaths = Object.keys(data)) {
  const url = new URL(`${FIRESTORE_BASE}/${path.split('/').map(encodeURIComponent).join('/')}`);
  for (const fieldPath of fieldPaths) url.searchParams.append('updateMask.fieldPaths', fieldPath);
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error?.message || `Firestore write failed (${res.status}).`);
  return fromFirestoreFields(out.fields || {});
}

async function ensureUserDoc(user, token) {
  if (!user?.uid) return;
  const now = new Date().toISOString();
  const fields = {
    uid: user.uid,
    email: user.email || '',
    name: user.full_name || user.email || 'Google User',
    photoURL: user.photoURL || '',
    provider: 'google.com',
    emailVerified: Boolean(user.emailVerified),
    lastLoginAt: now
  };
  await firestorePatch(`users/${user.uid}`, fields, token, Object.keys(fields));
}

async function buildAccess() {
  const token = await getValidFirebaseToken({ interactive: false });
  if (!token) return { allowed: false, reason: 'unauthenticated', user: null, membership: null, plan: null };
  const decoded = decodeJwtPayload(token) || {};
  const stored = await getStoredSession();
  const user = stored.firebase_user || {
    uid: decoded.user_id || decoded.sub || '',
    email: decoded.email || '',
    full_name: decoded.name || decoded.email || 'Google User',
    name: decoded.name || decoded.email || 'Google User'
  };
  if (!user.uid) return { allowed: false, reason: 'unauthenticated', user: null, membership: null, plan: null };

  let userDoc = null;
  let membershipDoc = null;
  try { userDoc = await firestoreGet(`users/${user.uid}`, token); } catch (_) {}
  try { membershipDoc = await firestoreGet(`memberships/${user.uid}`, token); } catch (_) {}
  const membership = membershipDoc?.fields || null;
  let plan = null;
  if (membership?.planId) {
    try { plan = (await firestoreGet(`plans/${membership.planId}`, token))?.fields || null; } catch (_) {}
  }

  const status = String(membership?.status || '').toUpperCase();
  const expiry = membership?.expiryDate ? new Date(membership.expiryDate) : null;
  const lifetime = Number(membership?.durationDays || 0) === 0 || String(membership?.planId || '').toLowerCase() === 'lifetime';
  const active = status === 'ACTIVE' && (lifetime || (expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now()));
  const full = {
    ...user,
    ...(userDoc?.fields || {}),
    uid: user.uid,
    email: user.email || userDoc?.fields?.email || '',
    full_name: user.full_name || userDoc?.fields?.name || user.email || 'Google User',
    membershipStatus: active ? 'ACTIVE' : (status || 'NOT_ACTIVATED'),
    subscription_status: active ? 'active' : (status ? status.toLowerCase() : 'not_activated'),
    subscription_reason: active ? '' : (status === 'EXPIRED' ? 'expired' : status === 'SUSPENDED' ? 'suspended' : status === 'REVOKED' ? 'revoked' : 'not_activated'),
    planId: membership?.planId || '',
    planLabel: membership?.planName || plan?.name || '',
    durationDays: Number(membership?.durationDays || plan?.durationDays || 0),
    expiryDate: membership?.expiryDate || null,
    shippingEnabled: active,
    deviceLimit: Number(membership?.deviceLimit || plan?.deviceLimit || 3),
    products: {
      fill: { active, status: active ? 'active' : (status === 'EXPIRED' ? 'expired' : 'not_found'), planType: membership?.planId || '', planLabel: membership?.planName || plan?.name || '', expiresAt: membership?.expiryDate || null },
      ship: { active, status: active ? 'active' : (status === 'EXPIRED' ? 'expired' : 'not_found'), planType: membership?.planId || '', planLabel: membership?.planName || plan?.name || '', expiresAt: membership?.expiryDate || null }
    }
  };
  return { allowed: active, reason: active ? 'active' : (status === 'EXPIRED' ? 'expired' : status || 'not_activated'), user: full, membership, plan };
}

async function login() {
  if (!configReady()) throw new Error('Firebase is not configured. Open Extension/firebase-config.js and add the Firebase Web API key and Chrome Extension OAuth client ID.');
  const googleToken = await getGoogleAccessToken(true);
  try {
    const auth = await firebaseSignInWithGoogle(googleToken);
    const expiresIn = Number(auth.expiresIn || 3600);
    const user = {
      uid: auth.localId || '',
      email: auth.email || '',
      full_name: auth.displayName || auth.fullName || auth.email || 'Google User',
      name: auth.displayName || auth.fullName || auth.email || 'Google User',
      photoURL: auth.photoUrl || '',
      provider: 'google.com',
      emailVerified: auth.emailVerified !== false
    };
    await chrome.storage.local.set({
      firebase_id_token: auth.idToken,
      firebase_refresh_token: auth.refreshToken,
      firebase_expires_at: Date.now() + Math.max(60, expiresIn - 30) * 1000,
      firebase_user: user,
      firebase_google_access_token: googleToken,
      firebase_user_id: user.uid
    });
    await ensureUserDoc(user, auth.idToken);
    return buildAccess();
  } catch (e) {
    await removeGoogleToken(googleToken);
    throw e;
  }
}

async function logout() {
  const data = await chrome.storage.local.get(['firebase_google_access_token']);
  await removeGoogleToken(data.firebase_google_access_token);
  if (chrome.identity?.clearAllCachedAuthTokens) {
    try { await chrome.identity.clearAllCachedAuthTokens(); } catch (_) {}
  }
  await chrome.storage.local.remove([
    'firebase_id_token','firebase_refresh_token','firebase_expires_at','firebase_user','firebase_google_access_token','firebase_user_id','firebase_membership','firebase_plan','firebase_device_slot','firebase_device_id','firebase_auth_tab_id','auth_token','user_info','supabaseSession','license','fk_license','isActivated','license_key'
  ]);
}

async function redeemActivationCode(code) {
  const token = await getValidFirebaseToken({ interactive: false });
  const stored = await getStoredSession();
  const user = stored.firebase_user;
  if (!token || !user?.uid || !user?.email) return { ok: false, error: 'Please sign in with Google first.' };

  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return { ok: false, error: 'Enter an activation code.' };

  const keyDoc = await firestoreGet(`activationKeys/${normalized}`, token);
  const key = keyDoc?.fields;
  if (!key) return { ok: false, error: 'Activation code not found.' };
  if (String(key.status || '').toUpperCase() !== 'AVAILABLE') return { ok: false, error: 'This activation code is already used or unavailable.' };
  if (key.assignedEmail && String(key.assignedEmail).toLowerCase() !== String(user.email).toLowerCase()) return { ok: false, error: 'This activation code is assigned to another Google account.' };

  const planDoc = await firestoreGet(`plans/${key.planId}`, token);
  const plan = planDoc?.fields;
  if (!plan || plan.active === false) return { ok: false, error: 'The plan attached to this activation code is not available.' };

  const membership = {
    uid: user.uid,
    email: user.email,
    planId: key.planId,
    planName: key.planName || plan.name || key.planId,
    status: 'ACTIVE',
    durationDays: Number(key.durationDays || plan.durationDays || 0),
    deviceLimit: Number(key.deviceLimit || plan.deviceLimit || 3),
    shippingEnabled: true,
    activationKey: normalized,
    startDate: key.startDate || new Date().toISOString(),
    expiryDate: key.expiryDate || null,
    activatedAt: new Date().toISOString()
  };
  const keyUpdate = {
    ...key,
    status: 'REDEEMED',
    redeemedBy: user.uid,
    redeemedEmail: user.email,
    redeemedAt: new Date().toISOString()
  };

  const writes = [
    {
      update: {
        name: `${FIRESTORE_BASE}/memberships/${encodeURIComponent(user.uid)}`,
        fields: toFirestoreFields(membership)
      }
    },
    {
      update: {
        name: `${FIRESTORE_BASE}/activationKeys/${encodeURIComponent(normalized)}`,
        fields: toFirestoreFields(keyUpdate)
      }
    },
    {
      update: {
        name: `${FIRESTORE_BASE}/users/${encodeURIComponent(user.uid)}`,
        fields: toFirestoreFields({
          uid: user.uid,
          email: user.email,
          name: user.full_name || user.name || user.email,
          photoURL: user.photoURL || '',
          lastMembershipPlan: membership.planId,
          membershipStatus: 'ACTIVE',
          membershipUpdatedAt: new Date().toISOString()
        })
      }
    }
  ];

  const res = await fetch(FIRESTORE_COMMIT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: out?.error?.message || 'Activation could not be completed.' };
  const access = await buildAccess();
  return { ok: true, access };
}

async function openWhatsApp(url) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('WhatsApp URL is missing.'));
    chrome.tabs.create({ url, active: true }, tab => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve({ ok: true, tabId: tab?.id || null });
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  // Keep local auth state across extension updates; explicit logout clears it.
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'GET_ACCESS':
        case 'CHECK_MEMBERSHIP':
          sendResponse(await buildAccess());
          return;
        case 'GET_FIREBASE_TOKEN': {
          const token = await getValidFirebaseToken({ interactive: false });
          const stored = await chrome.storage.local.get(['firebase_user']);
          sendResponse({ token, user: stored.firebase_user || null });
          return;
        }
        case 'FIREBASE_LOGIN':
          sendResponse(await login());
          return;
        case 'FIREBASE_LOGOUT':
          await logout();
          sendResponse({ ok: true });
          return;
        case 'ACTIVATE_MEMBERSHIP':
          sendResponse(await redeemActivationCode(message.code));
          return;
        case 'OPEN_WHATSAPP':
          sendResponse(await openWhatsApp(message.url));
          return;
        default:
          sendResponse({ ok: false, error: 'Unknown message type.' });
      }
    } catch (e) {
      sendResponse({ ok: false, allowed: false, reason: 'error', error: e?.message || 'Unexpected error.' });
    }
  })();
  return true;
});
