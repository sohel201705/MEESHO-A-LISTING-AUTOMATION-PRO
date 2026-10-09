# GitHub + Firebase Publish Guide

## 1) Upload to GitHub
Publish the contents of this package to the repository root:
`sohel201705/MEESHO-A-LISTING-AUTOMATION-PRO`

Keep these folders at the root:
- `admin/`
- `firebase/`
- `Extension/`

## 2) Firebase
Firebase project: `meesho-a-plus-listing-b5ea0`

Enable:
- Authentication → Google
- Firestore Database

Deploy rules from the repository root with:
`firebase deploy --only firestore:rules`
(or use the Firebase CLI with `--config firebase/firebase.json`).

## 3) Admin
Admin UID locked in code and rules:
`YnfQtmTpm9asdR0izeWuMwmX3Sw1`

GitHub Pages path:
`/admin/`

## 4) Extension OAuth
Create/configure the Chrome Extension OAuth client and replace the placeholder in:
- `Extension/manifest.json`
- `Extension/firebase-config.js`

## 5) Membership
One active plan enables both Autofill and Shipping Optimizer. Device-limit enforcement is disabled for Monthly, Yearly and Lifetime plans.

## 6) Security
The Web App Firebase config is client-side configuration. Do not upload any service-account private key, private API credential, or secret certificate. Firestore Rules are the database authorization boundary.

## 7) Automatic Integration and Factory Reset

The Admin Panel keeps its current layout. Use **Initialize DB** after a clean reset to create the required Firestore collection markers, default product-scoped plan records, combined plans, and settings. Existing prices and settings are preserved when the same documents already exist.

The Factory Reset button is destructive and is never run automatically by GitHub publishing. The administrator must type `RESET ALL NON-ADMIN DATA` and confirm. The callable first creates a compressed backup in Firebase Storage (`factory-reset-backups/`), then removes Firestore data and Firebase Authentication users except the configured Admin UID and its admin document. Storage files are left untouched.

### One-time backend deploy credential

Create a GitHub repository Actions secret named `FIREBASE_SERVICE_ACCOUNT_JSON` containing a service-account JSON authorized to deploy Firestore Rules and Firebase Functions for project `meesho-a-plus-listing-b5ea0`. The workflow `.github/workflows/deploy-firebase.yml` deploys Rules and the factory-reset callable on changes to `main`. If the secret is absent, the workflow skips backend deployment and reports a warning.

Rules changes in this release:
- Allow only the fixed Admin UID to create its own `admins/{uid}` owner record for first-time bootstrap.
- Remove device-limit field equality from activation-key validation.
- Add admin-controlled read/write access for `productMemberships` and `combinedPlans`.
- Factory reset is implemented in a callable function with Admin UID verification; Rules do not grant users database-wide delete permission.

Do not run Factory Reset until the backup target is available in Firebase Storage. The function fails before deleting anything if it cannot create the backup.
