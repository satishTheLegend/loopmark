> Historical first-release review. Current independent findings and results are in [completion-judge.md](completion-judge.md).

# Baseline independent release review

**Status: PASS for the tested local-first Chromium release.** No open release blocker remains in the reviewed paths. The device and browser limits below remain unverified.

Reviewed on **18 October 2026** against production cache **`loopmark-4d77b5f3b157`**. The verification agent owned browser tests and this review, independently of the UI and data implementation owners. The review followed the accepted [specification](specification.md), default brainstorming/gstack routing, and proportionate private-app SEO guidance. No external audit service, telemetry, deployment, or user account was used.

## Executed evidence

`npm run test:e2e` completed **18 tests, 18 passed, 24.0 seconds**, with no retries. See the [actual browser transcript](evidence/browser-results.txt), [test source](../tests/journeys.spec.ts), and [configuration](../playwright.config.ts).

Environment: Playwright 1.64.1, Chromium 156, macOS ARM64, production Vite preview at `http://127.0.0.1:4173`, isolated browser contexts. This exercised the built service worker rather than the development server.

| Area | Result and evidence |
| --- | --- |
| Project lifecycle, R1 | PASS: empty first use, create/edit, immutable readable code, search/craft filters, opt-in samples, no-results recovery, finish/reopen, cancel deletion, permanent deletion. |
| Checkpoint and restart, R2–R3 | PASS: required next step, latest tool/row prefill, two distinct checkpoints, history selection, latest-note return, persistence after reload, missing/deleted deep-link recovery. |
| Photo and voice, R4 | PASS: image decoding rejection; 2000×1200 upload becomes persisted 1600×960 JPEG; real MediaRecorder with Chromium's fake audio device; save blocked during capture; stop/remove, stream release, denied permission fallback. The two-minute limit uses a simulated clock. |
| Backup and failure safety, R5 | PASS: full download, restore into a fresh browser context, exact photo/audio preservation, all project/checkpoint fields preserved except intentionally renewed concurrency tokens. Unsupported versions, duplicate IDs, remote media and malformed records leave existing data intact. Restore requires confirmation; cancel preserves data. Injected quota errors roll back replacement and keep unsaved form text. |
| Concurrent tabs, R5 | PASS: two simultaneous checkpoint appends both survive, updates propagate to both views, stale detail edits fail without overwriting the newer edit. |
| Bag label, R6 | PASS: readable name/code/tool/row/next step, PNG QR independently decoded with jsQR to the exact same-origin project URL, successful navigation, print-call invocation and print-only rendering. This is print emulation, not a physical print test. |
| Offline and storage, R7 | PASS: activated production service worker, offline reload, new photo checkpoint while offline, another reload retaining it, zero third-party requests in the captured core workflow. Blocked IndexedDB shows recovery; injected write failures preserve prior checkpoints. |
| Accessibility and responsive UI, R8 | PASS: axe WCAG 2.0/2.1/2.2 A/AA tags find zero violations across eight states: empty shelf, project form, detail, checkpoint form, bag label, populated shelf, backup, and guide. Keyboard dialog focus, Tab containment, Escape and opener restoration pass. Mobile menu keyboard/escape behavior passes. |
| Small screens, R8 | PASS: 320px and 390px journeys include real sample history and new user content, forms, navigation, and backup. Checks wait for fonts. Final sample screenshots measured content widths of exactly 320/390/768px at the corresponding viewports. |

The implementation owner separately reported a passing production build, **21 passing data tests**, a clean formatting check, and **zero reported npm audit vulnerabilities** in the 93-package audit. Those are complementary to this agent's browser execution, not duplicate independent executions.

## Findings resolved during review

| Finding | Observed impact | Resolution and regression evidence |
| --- | --- | --- |
| Offline asset cache mismatch | Offline reload produced an empty shell even with an active worker and cached assets. Vite serves `Vary: Origin`; module requests differed from precache requests. | Static same-origin cache lookup now ignores `Vary`. Offline reload, save with photo, and subsequent reload pass. |
| Initial focus and delayed focus race | Dialog initially focused Close. A delayed focus fix then redirected tool input into the project name during rapid entry. Native Tab traversal also left dialog content. | Synchronous layout-time focus and explicit boundary wrapping. Creation and keyboard focus tests pass. |
| Secondary text contrast | Sidebar/footer, checkpoint facts/date, and photo upload label failed 4.5:1. | Darkened text tokens; eight-state axe scan passes after entrance animations settle. |
| Card accessible name | An overriding `aria-label` omitted visible card text. | Name now includes the visible content, with an explicit open prefix. Axe passes. |
| Sample-history mobile overflow | Final screenshots exposed a case missed by the initial short fixture: a history preview gave the mobile grid an intrinsic width beyond the screen. | Single-column grids use `minmax(0, 1fr)` and shrinkable children. Real sample content is now in both mobile regression tests; final screenshots fit 320/390px. |
| Imported history order | A structurally valid backup could supply checkpoints out of order and show an older next step first. | Data owner normalizes newest-first order and added regression coverage. |
| Restore and cross-tab safety | The shared review also identified stale restore revision tokens, sample seeding that could race a real write, and capture into a newly finished project. | Transactional guards and renewed revision tokens; dedicated data tests plus browser stale-edit and concurrent-append tests. |
| Interactive control boundaries | Manual design review found form/search boundaries too faint against their backgrounds. | Interactive borders darkened to `#948777`; final form screenshot inspected. |

## Source security review

Reviewed `src/data.ts`, `src/media.ts`, project/checkpoint/backup/dialog/voice/label components, routing, and service-worker generation. No remaining critical or high-severity issue was identified in those paths.

- User/imported strings render as React text. A browser test restores HTML/script-looking strings, verifies literal display, and verifies no execution or injected image element.
- Import validation checks schema, IDs, duplicate codes, timestamps, field/count/storage budgets, allowed media types, base64 syntax and container signatures before mutation. Remote and SVG attachments are rejected. Media compatibility is still dependent on the browser decoder.
- Replacement and per-project writes use IndexedDB transactions. Fault injection verifies rollback and retained input. Metadata revision checks protect newer edits in another tab.
- Recording requires explicit interaction; streams stop on stop, limit, cancellation and unmount. Object URLs used for photo conversion and downloads are revoked.
- There are no HTML injection sinks, runtime analytics, remote attachment fetches, or application secrets in the reviewed source. The app is a private local notebook: `noindex, nofollow` and disallow-all robots are appropriate; public search indexing and schema enrichment were not added.

## Performance and visual evidence

[Raw final-candidate measurements](evidence/performance.json) record three fresh-context, unthrottled localhost samples. These are lab observations, not field Core Web Vitals or a Lighthouse score.

| Measurement | Observed |
| --- | --- |
| Main JavaScript, standard Node gzip | 117,205 bytes; below the 200 KB target |
| CSS, standard Node gzip | 8,391 bytes; below the 30 KB target |
| Complete built directory | 667,792 bytes |
| First contentful paint | 48 / 52 / 56 ms; median 52 ms in this local environment |
| Observed layout shift | 0.000835–0.004733 through fonts/entry animation plus 500 ms |
| Initial resources / third-party requests | 9 resources per sample / zero third-party requests |

Final screenshots were captured after fonts and animations settled. Desktop shelf, mobile detail at 320/390px, checkpoint dialog, backup page and print label were visually inspected. Additional screenshots preserve empty, tablet, guide and mobile shelf states.

- [Desktop shelf](evidence/desktop-shelf.png), [empty shelf](evidence/desktop-empty.png), [project detail](evidence/desktop-project.png)
- [390px detail](evidence/mobile-project.png), [320px detail](evidence/project-320.png), [768px detail](evidence/project-768.png), [mobile shelf](evidence/mobile-shelf.png)
- [Checkpoint dialog](evidence/checkpoint-form.png), [backup](evidence/backup-restore.png), [guide](evidence/guide.png)
- [Bag label dialog](evidence/bag-label.png), [print rendering](evidence/bag-label-print.png)

## Boundaries and reproduction

Not exercised: physical microphone/camera/printer, OS-level PWA installation, Safari/Firefox or real mobile hardware, screen-reader speech output, actual disk exhaustion, long-term storage eviction, field LCP/INP, or hosted deployment. Permission/quota failures are injected; audio capture uses a fake device and the duration cap uses virtual time. Automated accessibility success is not a WCAG certification. Browser/device codec differences and storage clearing remain documented product constraints.

From the project directory: `npm ci`, `npx playwright install chromium`, `npm run build`, `npm test`, then `npm run test:e2e`. Browser tests start or reuse the preview at port 4173; rebuild before testing source changes.

Durable project lessons captured by the regression suite: cached static responses may vary by Origin; focus must not be deferred into later typing; wait for committed save state before reload; and mobile reflow must include real history content after fonts load. No external memory or telemetry was written.
