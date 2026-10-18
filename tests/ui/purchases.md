# Purchase and recovery component verification

Run from the repository root:

```sh
npx playwright test --config tests/ui/purchases.config.ts --workers 2
```

This fixture uses the production UpgradeView, PurchaseRecovery and ProjectForm with the real billing coordinator, recovery service, entitlement cache, upgrade prompts, IndexedDB repository, workflow store, draft store and data adapter. Only authentication, billing provider and server I/O are synthetic. The page labels that boundary visibly and is excluded from indexing. No payment, email, merchant endpoint or native store SDK is contacted.

Nine scenarios run in Chromium, Firefox, WebKit, Chromium mobile and WebKit mobile:

- Catalog price is the returned ₹437.50; a pending checkout survives reload without an automatic second launch; explicit reopening reuses its attempt ID.
- Explicit synthetic native cancellation remains cancelled after server reconciliation and permits an intentional new attempt.
- A fourth guest project retains its draft through the free limit, optional sign-in and purchase. Verified access does not save the draft; Continue opens it, and Create saves it only after review.
- A syntactically valid paid return URL requests verification and grants no access by itself.
- Pending purchase recovery cannot export its unconfirmed key. Confirmation allows a complete local key export without rendering the secret.
- Offline key creation retains a retryable local operation and reuses it after reconnect.
- A key rotated elsewhere becomes superseded after a verified status check and disappears from export controls.
- Offline status keeps a timestamped previous confirmation and explicit export, with an unavailable-current-status notice.
- Price and recovery controls support keyboard activation; the next focusable control receives keyboard focus. Screens reflow at 320, 390 and 1440 pixels and have no axe WCAG 2 A/AA, 2.1 AA or 2.2 AA violations.

Verified 2026-10-18: 45/45 scenarios passed across five profiles after component layout changes. TypeScript and 18 focused billing/recovery/prompt unit tests passed. The screenshot review found and corrected inline recovery controls by reusing account-form styles and adding scoped spacing. Browser artifacts are written to `test-results-ui/`; the Chromium layout test saves each reviewed width.

The run was based on root 17f434a plus b9a1a2c, shared ea81d56 and client fixes 0319dd5, 95f91e3 and 3cd0ac0. The actual-coordinator fixture exposed the dotted product-ID rejection fixed in 95f91e3. This is component/browser evidence only; it does not satisfy provider sandbox, native SDK transaction, signed build or physical-device release qualification.
