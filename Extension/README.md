# MEESHO A+ LISTING AUTOMATION PRO — Extension v3.21.0

## Membership verification (v3.21.0)
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
- Extension version: 3.21.0
- Fixes: read Admin Panel's product membership record, prevent accidental “active lifetime” status when the expiry/duration is missing, remove implicit trial auto-start from paid membership verification, and label any free trial distinctly from paid membership.


## Plan pricing visibility fix (v3.21.0)
- The Extension fetches published plans with a Firestore `runQuery` whose filter explicitly requires `active == true`, as required by the current Firestore Rules.
- An unfiltered collection list could be denied by Firestore Rules and silently render the empty-state message even when the Admin Panel showed active plans.


## Seller onboarding (v3.21.0)
- The extension opens the dashboard immediately after successful login when membership is active; the first-time seller workspace wizard is skipped.
- Seller, manufacturer, packer, importer, HSN, GST and support defaults are not required during login.
- Users can create reusable seller defaults later from AI Catalog Autofill while preparing a product listing. Existing locally saved profiles/defaults are preserved.


## Full AI workspace UI recovery (v3.21.0)
- Restores visibility of the Listing Studio page, product basics, progress/status controls, workspace navigation and API Connections page in the injected side-panel iframe.
- Adds navigation fallback handlers so Listing Studio, Seller Profile, API Connections, AI Listing Chat and Activity Center remain usable if the AI dashboard initializer is interrupted.
- Existing AI provider keys, local router settings and saved seller profiles remain in browser-local storage; this release does not clear local data.
- Seller/manufacturer/packer/importer/HSN/GST details remain optional during login and can be saved later from the Listing Studio profile tools.
