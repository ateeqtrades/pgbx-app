// Production build only: SMS login codes through Firebase Authentication (phone), used when the server says
// otp.mode is 'firebase'. Bundled on its own (live/firebase-login.js, dist/firebase-login.js) and loaded only on the
// login screen, so the rest of the app doesn't carry it.
//
// Firebase sends the SMS and checks the code. It proves the number with a signed ID token, which the app passes to
// the PGBX server (/auth/otp/verify); the server checks the token and opens the PGBX session as for any login.
// The check that the request comes from a person is Firebase's invisible reCAPTCHA (no Play Integrity device check).
import { initializeApp } from 'firebase/app';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, signOut } from 'firebase/auth';

let auth = null, verifier = null, pending = null;

function setup(config) {
  if (!auth) { auth = getAuth(initializeApp(config, 'pgbx')); auth.languageCode = 'en'; }
  if (!verifier) {
    let box = document.getElementById('pgbx-recaptcha');
    if (!box) { box = document.createElement('div'); box.id = 'pgbx-recaptcha'; document.body.appendChild(box); }
    verifier = new RecaptchaVerifier(auth, box, { size: 'invisible' });
  }
}

const MESSAGES = {
  'auth/invalid-verification-code': 'That code is incorrect. Check the message and try again.',
  'auth/code-expired': 'That code has expired. Request a new one.',
  'auth/session-expired': 'That code has expired. Request a new one.',
  'auth/too-many-requests': 'Too many attempts. Please wait a while and try again.',
  'auth/quota-exceeded': 'Login codes are busy right now. Please try again later.',
  'auth/invalid-phone-number': 'Enter a valid Pakistani mobile number, for example 300 1234567.',
  'auth/captcha-check-failed': 'We couldn’t confirm you’re not a robot. Please try again.',
  'auth/network-request-failed': 'Can’t reach the login service. Check your connection and try again.',
  'auth/operation-not-allowed': 'Login codes aren’t available right now. Please try again later.',
};
const fail = e => {
  const err = new Error(MESSAGES[e && e.code] || 'We couldn’t send or check the code. Please try again.');
  err.code = e && e.code === 'auth/network-request-failed' ? 'NETWORK' : 'FIREBASE';
  err.firebaseCode = e && e.code;
  return err;
};

// phone: national number without 0 or +92, e.g. 3001234567
export async function sendCode(config, phone) {
  setup(config);
  try { pending = await signInWithPhoneNumber(auth, '+92' + phone, verifier); }
  catch (e) {
    try { verifier.clear(); } catch (x) { }                 // a fresh check for the next try
    verifier = null;
    throw fail(e);
  }
}

// Returns the signed ID token for the server. The Firebase sign-in itself is not kept: PGBX keeps its own session.
export async function confirmCode(code) {
  if (!pending) { const e = new Error('Request a new code first.'); e.code = 'FIREBASE'; throw e; }
  try {
    const r = await pending.confirm(code);
    const token = await r.user.getIdToken();
    pending = null;
    signOut(auth).catch(() => { });
    return token;
  } catch (e) { throw fail(e); }
}
