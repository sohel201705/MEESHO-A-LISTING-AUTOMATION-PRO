# GitHub + Firebase Setup Guide (Free-First)

## 1. Repository and Firebase project
Repository: `sohel201705/MEESHO-A-LISTING-AUTOMATION-PRO`

Firebase project: `meesho-a-plus-listing-b5ea0`

Keep these folders at the repository root:
- `admin/`
- `firebase/`
- `Extension/`

## 2. Firebase setup
In Firebase Console, enable Authentication → Google and create/keep the Cloud Firestore database. Use the Spark (no-cost) plan; do not activate Blaze or the $300 trial solely for this project.

Firestore's published no-cost quota is currently 1 GiB stored data, 50,000 document reads/day, 20,000 writes/day and 20,000 deletes/day for one free database. If usage exceeds the free quota on Spark, requests may be limited instead of automatically billed. See Firebase's current pricing documentation before changing billing: https://firebase.google.com/docs/firestore/pricing

## 3. Admin Panel
Configured Admin UID:
`YnfQtmTpm9asdR0izeWuMwmX3Sw1`

GitHub Pages path: `/admin/`

Keep `admin/firebase-config.js`, `firebase/firestore.rules`, and the Admin UID in sync. The Admin UI uses the existing dark theme.

## 4. GitHub Actions Rules deployment
Repository secret:
`FIREBASE_SERVICE_ACCOUNT_JSON`

This secret contains a service-account key with permission to publish Firestore Rules. It is used only by GitHub Actions; never paste the secret into repository files or the Admin Panel. The workflow deploys Firestore Rules only and never deploys Cloud Functions.

The current deploy command is equivalent to:
`firebase deploy --only firestore:rules`

This avoids Cloud Functions and the related billing/API requirements. Google Cloud may still require Rules-specific IAM permissions for the service account.

## 5. Local JSON backup, restore and reset
1. Sign in to the Admin Panel with the configured Admin UID.
2. Open Settings and choose **Download Backup (JSON)**. Store the downloaded file safely on your own computer or external drive.
3. To restore, choose **Restore Backup File** and select a valid JSON backup for this project. The restore replaces known app Firestore data, while preserving the live Admin record.
4. To reset, download a fresh backup first, type `RESET ALL NON-ADMIN DATA`, then confirm. Afterwards use **Initialize DB** to recreate missing default plans, collection markers and settings.

The backup covers the app's known Firestore collections and known subcollections. It does not include Firebase Authentication account credentials. A browser-only panel cannot securely delete other users' Firebase Authentication identities without a trusted Admin SDK server; their login identities therefore remain after the free reset, while app Firestore data and membership records are cleared. Unknown custom collections not listed by the app are not automatically discovered by the browser.

## 6. Membership activation
Activation keys are redeemed with a single Firestore commit. Security Rules require the key to transition from AVAILABLE to REDEEMED in the same atomic write as the corresponding membership record(s), and product entitlements are limited to the products in the key.

Keys currently use the start/expiry dates set when the Admin generates them. To avoid shortening an active membership, the extension refuses a key whose expiry precedes the member's current expiry; generate renewal keys after the existing expiry or manage a longer expiry from the Admin Panel.

## 7. Security
- Firestore Rules are the permission boundary.
- Never store service-account private keys in client-side code, public files or browser storage.
- Keep downloaded backup files private because they contain user names, email addresses, memberships and key records.
- No Factory Reset is automatically run by publishing or opening the Admin Panel.
