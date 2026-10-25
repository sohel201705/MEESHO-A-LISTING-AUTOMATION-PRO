# MEESHO A+ LISTING AUTOMATION PRO — Extension v3.20.7

## Membership verification (v3.20.7)
- Google sign-in does not grant paid membership by itself.
- Access is granted only when Firebase has an explicit `ACTIVE` entitlement for this user in `productMemberships/{uid}.products.meesho` or a compatible legacy `memberships/{uid}` document.
- The entitlement must have a valid future expiry date, or explicitly identify a Lifetime plan with `durationDays: 0`.
- Missing expiry/duration fields are not treated as lifetime.
- Automatic 24-hour trials are no longer created or treated as paid membership by the membership gate.
- If no active membership exists, the user remains signed in but sees membership plans and the activation-key entry.
- If the Firebase membership read fails, access is denied and the UI shows a verification error rather than assuming the account is active.

## Admin and data
- Admin Panel: `../admin/`
- Firestore rules source: `../firebase/firestore.rules`
- Firebase project config: `firebase-config.js`
- The admin panel uses product-scoped entitlements in `productMemberships/{uid}` and a legacy Meesho record in `memberships/{uid}` for compatibility.
- Saved seller profiles and AI provider keys remain on the user's device in extension storage; don't delete local storage when updating the extension.

## Installation
1. Download the latest Extension ZIP from GitHub Releases.
2. Extract the ZIP.
3. In a compatible desktop/extension-supporting browser, load the extracted folder that contains `manifest.json`.
4. Sign in with Google.
5. If no active membership is found, choose a plan / contact support in WhatsApp and enter the one-time activation key after Admin issues it.

## Release
- Extension version: 3.20.7
- Fixes: read Admin Panel's product membership record, prevent accidental “active lifetime” status when the expiry/duration is missing, remove implicit trial auto-start from paid membership verification, and label any free trial distinctly from paid membership.
