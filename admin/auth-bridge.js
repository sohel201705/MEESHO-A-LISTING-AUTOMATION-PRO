import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyBYlz75tipBELEJW_fNyhBzZPb_PUdN5yE',
  authDomain: 'meesho-a-plus-listing-b5ea0.firebaseapp.com',
  projectId: 'meesho-a-plus-listing-b5ea0',
  storageBucket: 'meesho-a-plus-listing-b5ea0.firebasestorage.app',
  messagingSenderId: '1070112616030',
  appId: '1:1070112616030:web:12aea571a1c7b5d2170ecf'
});

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const PARENT_FRAME = document.location.ancestorOrigins?.[0] || '*';

function send(payload) {
  try {
    globalThis.parent.postMessage(
      { source: 'meesho-firebase-auth', ...payload },
      PARENT_FRAME
    );
  } catch (_) {}
}

async function signIn() {
  try {
    const credential = await signInWithPopup(auth, provider);
    const user = credential.user;
    const idToken = await user.getIdToken(true);
    send({
      type: 'AUTH_SUCCESS',
      auth: {
        idToken,
        refreshToken: user.refreshToken || '',
        localId: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoUrl: user.photoURL || '',
        emailVerified: Boolean(user.emailVerified),
        expiresIn: 3600
      }
    });
  } catch (e) {
    send({
      type: 'AUTH_ERROR',
      error: e?.message || 'Google sign-in failed.'
    });
  }
}

window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  if (event.data?.initAuth) signIn();
});
