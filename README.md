# MEESHO A+ LISTING AUTOMATION PRO — GITHUB PUBLISH PACKAGE

Repository: `sohel201705/MEESHO-A-LISTING-AUTOMATION-PRO`

## Components
- `admin/` — GitHub Pages Admin Panel
- `firebase/` — Firestore security rules and Firebase CLI configuration
- `Extension/` — Chrome extension source
- `SETUP_GITHUB_FIREBASE.md` — setup and recovery guide

## Firebase project
`meesho-a-plus-listing-b5ea0`

## Admin UID
`YnfQtmTpm9asdR0izeWuMwmX3Sw1`

## Free-first deployment model
- The Admin Panel is a static GitHub Pages site.
- Google sign-in and Firestore run on Firebase's no-cost Spark plan, subject to the published free quotas.
- The repository does not deploy Cloud Functions or use Cloud Storage for backup.
- Activation-key redemption is performed through an atomic Firestore commit, with Firestore Rules validating the one-time key and resulting membership documents.
- Firestore Rules can be deployed by GitHub Actions from the repository secret `FIREBASE_SERVICE_ACCOUNT_JSON`. This deploy workflow publishes Rules only; it does not deploy Functions.

## Local JSON backup and restore
- In Admin Panel → Settings → Local Backup, Restore & Factory Reset, choose **Download Backup (JSON)**. The browser downloads the known app Firestore documents to the administrator's computer.
- Use **Restore Backup File** to select a backup from the same Firebase project. Restore replaces the known app data while preserving the live `admins/{ADMIN_UID}` record.
- For reset, first download a current backup, then type `RESET ALL NON-ADMIN DATA` and confirm.
- The browser Admin Panel can only clear the known application collections and known subcollections. It does not have permission to enumerate arbitrary unknown Firestore collections.
- Firebase Authentication sign-in accounts are not deleted by local reset; without a trusted Admin SDK server, a browser-only panel cannot securely delete other users' Authentication identities. After reset their Firestore membership records are cleared, so they must be activated again.

## Important
Replace any OAuth client placeholders before testing extension Google login. Never put service-account private keys in repository code or client-side files.

The local backup is a JSON snapshot of Firestore documents, not an export of Firebase Authentication user credentials. Keep downloaded backups somewhere private.
