# MEESHO A+ LISTING AUTOMATION PRO — GITHUB PUBLISH PACKAGE

This package is ready to publish to the GitHub repository:
`sohel201705/MEESHO-A-LISTING-AUTOMATION-PRO`

## Root structure
- `admin/` — GitHub Pages Firebase Admin Panel
- `firebase/` — Firestore security rules and Firebase CLI config
- `Extension/` — Chrome extension source
- `index.html` — root landing page
- `SETUP_GITHUB_FIREBASE.md` — publishing/setup guide

## Firebase project
`meesho-a-plus-listing-b5ea0`

## Admin UID
`YnfQtmTpm9asdR0izeWuMwmX3Sw1`

## Unified membership
**ONE ACTIVE PLAN = AUTOFILL + SHIPPING OPTIMIZER**

Shipping Optimizer is not a separate membership.

## Important
Replace the Chrome Extension OAuth client ID placeholder in `Extension/manifest.json` and `Extension/firebase-config.js` before testing Google Login in the extension. Never put a Firebase service-account private key in this repository.

## Firebase factory reset and automatic integration

- The Admin Panel UI is kept in the existing `admin/` directory; this change adds controls using the same existing panel styles.
- The `Initialize DB` action creates missing collection marker documents, missing default plans, and missing settings. It does not overwrite existing plan prices or saved settings.
- A factory reset is an explicit Admin-only action. It first writes a compressed backup to Firebase Storage, then removes Firestore documents and Firebase Authentication users except the configured Admin UID and its `admins/{ADMIN_UID}` document.
- Reset is **not** triggered by publishing or opening the Admin Panel. It requires typing `RESET ALL NON-ADMIN DATA` and confirming in the panel.
- Storage files themselves are left untouched. Backups are stored under `factory-reset-backups/` in the default Firebase Storage bucket.
- The factory reset callable and Firestore Rules are deployed by `.github/workflows/deploy-firebase.yml` only when the GitHub repository secret `FIREBASE_SERVICE_ACCOUNT_JSON` is configured. Without it, the workflow emits a warning and skips backend deployment.
- Current Admin UID: `YnfQtmTpm9asdR0izeWuMwmX3Sw1`. Keep it consistent in `admin/firebase-config.js`, `firebase/firestore.rules`, and `firebase/functions/index.js`.
