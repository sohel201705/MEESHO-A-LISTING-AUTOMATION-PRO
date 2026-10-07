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
`m7pkPGN62YMWfPr7ftbSMw3jv052`

GitHub Pages path:
`/admin/`

## 4) Extension OAuth
Create/configure the Chrome Extension OAuth client and replace the placeholder in:
- `Extension/manifest.json`
- `Extension/firebase-config.js`

## 5) Membership
One active plan enables both Autofill and Shipping Optimizer. Default device limit is 3.

## 6) Security
The Web App Firebase config is client-side configuration. Do not upload any service-account private key, private API credential, or secret certificate. Firestore Rules are the database authorization boundary.
