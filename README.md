# MEESHO A+ LISTING AUTOMATION PRO

## Unified Membership Architecture

One active membership unlocks both:

- Autofill
- Shipping Optimizer

This repository is organized for GitHub Pages + Firebase:

```text
/admin/                    GitHub Pages Admin Panel
/firebase/                 Firebase security rules/config
/Extension/                Chrome extension
SETUP_GITHUB_FIREBASE.md   Setup instructions
```

### Current Firebase project

```text
meesho-a-plus-listing-b5ea0
```

### Admin bootstrap UID

```text
m7pkPGN62YMWfPr7ftbSMw3jv052
```

The Admin UID is the bootstrap root of trust in Firestore Rules. Do not put Firebase service-account private keys in this repository.

### Membership model

ONE ACTIVE PLAN = AUTOFILL + SHIPPING OPTIMIZER

There is no separate Shipping membership.

See `SETUP_GITHUB_FIREBASE.md` before enabling production access.
