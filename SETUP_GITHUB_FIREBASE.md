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

## 7. FreeLLMAPI local router and 24-hour trial

### Per-user local AI router
Each user must run their own FreeLLMAPI instance on the same computer as Chrome and enter their own router API key in the extension's AI settings. The extension does not provide a shared central token pool or host anyone else's router.

- Default endpoint: `http://127.0.0.1:31415/v1/chat/completions`
- Compatibility fallback: `http://127.0.0.1:3001/v1/chat/completions`
- Use **Test Connection** before generating a listing. For FreeLLMAPI, the test sends a tiny image as well as text; a successful text-only connection is not enough for product-photo research.
- Configure a vision-capable model in the local router's fallback chain. If no vision model is available, image-based listing generation may return `no_vision_model`.
- Keep the router bound to loopback / localhost. Do not expose its port to a public interface or the internet. Provider access, rate limits and free quotas are controlled by the user's own router/providers and can change.

### One-time 24-hour trial
The extension starts a trial the first time an authenticated user reaches the access check without an active membership. Firestore stores `trials/{uid}` with a server-generated `startedAt` timestamp. Rules allow the owner to read it but do not allow a user to update or delete it; the trial expires 24 hours after that timestamp. An active membership takes precedence over the trial.

After updating rules, deploy them using the existing GitHub Actions workflow (or your established Firebase Rules deployment method) before testing the first trial. If a user's trial cannot start, the extension displays a setup error instead of silently granting access.

**Important limitation:** this no-VPS design does not create a trusted server that authorizes every AI request. Firestore Rules protect the one-time trial record, but an advanced user who modifies the local extension or changes the computer clock may bypass a client-side expiry check. Strong tamper-resistant enforcement requires a trusted backend / server-side verification, which is intentionally outside this no-backend option.

## 8. Nightly transient-log cleanup

The `.github/workflows/nightly-cleanup.yml` workflow runs daily at **midnight India time** using GitHub Actions and the existing `FIREBASE_SERVICE_ACCOUNT_JSON` repository secret. It deletes documents from the Firestore `logs` collection only, preserving the `_meta` collection marker. It does **not** delete users, memberships, product memberships, plans, activation keys, payments, devices, trial records, system settings or seller profile data.

The cleanup is scoped this way so that routine diagnostics are cleared without removing business/account records. If the repository secret is absent or the service account cannot access the project, the workflow fails visibly instead of using client credentials.

## 9. Security
- Firestore Rules are the permission boundary.
- Never store service-account private keys in client-side code, public files or browser storage.
- Keep downloaded backup files private because they contain user names, email addresses, memberships and key records.
- No Factory Reset is automatically run by publishing or opening the Admin Panel.
