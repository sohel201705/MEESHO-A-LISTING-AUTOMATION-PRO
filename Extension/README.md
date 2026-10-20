# MEESHO A+ LISTING AUTOMATION PRO — Extension v3.18.3

## Unified access

One active membership unlocks both:
- Autofill
- Shipping Optimizer

## Firebase flow

1. User clicks Login with Google.
2. Chrome Identity obtains the Google OAuth token.
3. Firebase Identity Toolkit exchanges it for a Firebase session.
4. `users/{UID}` is created/updated automatically.
5. `memberships/{UID}` is checked.
6. The plan controls duration and device limit.
7. An active membership enables both Autofill and Shipping Optimizer.

## Device limit

The extension registers a device session under:

`devices/{UID}/sessions/{deviceId}`

The membership device limit is enforced before premium access is granted.

## Required configuration

Set the Chrome Extension OAuth Client ID in:
- `manifest.json`
- `firebase-config.js`

Firebase project:
`meesho-a-plus-listing-b5ea0`


## Membership plan picker
The pricing view starts on Meesho plans and lets the customer switch to Flipkart-only or Combo plans. This changes only the displayed plan category; the original Firestore plan IDs, prices, activation keys, and membership entitlements remain in use.


## Local FreeLLMAPI router

Each user runs their own FreeLLMAPI on the same computer as Chrome and enters their own local router key in AI settings. The extension supports `http://127.0.0.1:31415/v1/chat/completions` and automatically falls back to `http://127.0.0.1:3001/v1/chat/completions` when appropriate. Use **Test Connection** to check chat and image input. Configure a vision-capable model in the router's fallback chain and keep the router bound to localhost / loopback.

## 24-hour trial

Users without an active membership can start one 24-hour trial per Firebase account. The start time is saved in a create-once Firestore `trials/{uid}` record. Deploy the updated `firebase/firestore.rules` before enabling trial sign-up. Since this option has no trusted backend, client-side expiry is not tamper-proof; see `SETUP_GITHUB_FIREBASE.md` for details.
