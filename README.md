# MEESHO A+ LISTING AUTOMATION PRO — Extension

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
