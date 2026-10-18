# Verification and delivery

**Status: VERIFIED for the local Chromium-tested release.** Date: 18 October 2026. The app is implemented in this standalone directory. This is not a claim of store acceptance, public deployment, live payment integration or field validation.

## Integrated checks

| Check | Executed result | Evidence / interpretation |
|---|---|---|
| `npm run build` | PASS; strict TypeScript and Vite production build | Final candidate SW `loopmark-4d77b5f3b157`; 29 precached assets |
| `npm test` | 21/21 PASS | IndexedDB transactions, validation, media envelope, rollback, stale tabs, clock rollback, atomic sample seeding and capacity |
| `npm run test:e2e` | 18/18 PASS in 24.0 seconds | [Full browser transcript](evidence/browser-results.txt); isolated real Chromium browser contexts |
| WCAG automated checks | Zero axe violations across 8 tested states | Empty/populated shelf, detail, both forms, bag label, backup, guide; keyboard tests additionally cover focus containment and return |
| Responsive checks | PASS 320px and 390px, screenshots at 768px and 1440px | Long content, shelf/detail/forms/backup/menu; no horizontal overflow in tested phone flows |
| `npm run format:check` | PASS | All maintained source/test/config files formatted |
| `npm audit --audit-level=high` | 0 known vulnerabilities across 93 installed packages | Point-in-time advisory check, not a complete security guarantee |
| Runtime requests | No external network requests in tested core journeys | All fonts, app assets, original illustrations, media and QR generation local |
| Independent judge | See [review.md](review.md) | Actual source and browser evidence; full cross-model gstack/autoplan not claimed |

Environment: macOS arm64, Node 26.8.2, npm 11.19.1, TypeScript 7.0.2, React 19.3.1, Vite 8.3.4, Vitest 5.0.5, Playwright 1.64.1 / Chromium 156. Resolved versions remain in package-lock.json. Runtime app preview used 127.0.0.1:4173. No physical phone or signed app package was used.

## What the tests establish

A maker can start from an empty collection, create/edit a project, capture a photo and note, reload and resume, inspect immutable history, finish/reopen/delete, search/filter samples, and recover from validation errors. Two tabs preserve independent checkpoint appends and reject stale metadata edits. Full export to a file and import into a separate browser context preserves all photos/voice and user fields. Invalid files never clear the collection; injected transaction failure demonstrates rollback. Real microphone APIs use Chromium's synthetic device; recordings survive export/restore, stop at a simulated 120-second boundary and release tracks on close.

Production offline reload and photo checkpoint capture were exercised with network disabled after successful cache installation. Generated QR pixels were independently decoded with jsQR to the exact origin/project URL. Print emulation verifies only the bag label appears; missing local project links lead to recovery instructions. Hostile imported markup remains text; imported media rejects remote URLs, SVG, malformed encodings and mismatched container signatures. Validation is bounded metadata/container validation, not a forensic media scanner.

## Measured budgets

Vite reports main JavaScript 118.45kB gzip and CSS 8.44kB gzip, within the 200kB/30kB goals. The exact gzip implementation/level differs from Node's default; [performance.json](evidence/performance.json) records its own byte values and actual timing samples. Local unthrottled headless measurements are laboratory evidence only; no field INP/CWV claims or device frame-rate guarantees are made. Fonts were narrowed to local Latin subsets with system fallback for other scripts. All animation is CSS opacity/transform; reduced motion disables it. No animation runtime is shipped.

## Defects corrected during verification

- Offline module/CSS cache misses caused by `Vary: Origin`; immutable same-origin asset lookup now ignores Vary.
- Focus initially started on close, then asynchronous focus could steal input; now synchronous modal initialization with explicit Tab wrapping and opener restoration.
- Muted text and form boundaries were darkened after automated/manual contrast findings.
- Real sample text exposed an intrinsic grid width after fonts loaded; single-column grids now use minmax(0,1fr) and shrinkable children, verified at 320/390px.
- Mobile offscreen navigation is hidden from focus; open drawer makes main content inert and handles Escape/resizing.
- Samples now initialize in an atomic empty-library transaction, protecting against another tab creating a project.
- Finished-project capture is rejected in the data transaction, and imported history is normalized newest-first.
- Restore tokens remain newer than existing/imported state even after older backups, deletion, and clock rollback.

## Boundaries and remaining work

No release-critical external service is blocked because this release needs none. Physical microphones/cameras, Safari/Firefox, iOS/Android installation and physical printers/scanners remain **UNVERIFIED**. Audio codec playback across browsers is not guaranteed. The web manifest and icons are implemented; no OS install or store build is claimed. Hosted CI is configured, not remotely run. Deployment is prepared, not performed. Existing unsaved dialog drafts are discarded when closed; they are not automatically backed up. Browser storage can be evicted/cleared; users need downloaded backups.

The 15-person cohort, capture-speed improvement, return habit, willingness to pay and actual purchases are **NOT RUN**. Pricing and native/cloud extensions are explicit future decisions. No fabricated metrics, purchase success or users appear in the application.
