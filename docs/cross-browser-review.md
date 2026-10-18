# Cross-browser review · 18 October 2026

This review extends the original Chromium-only evidence in [review.md](review.md) for the local app foundation. It uses the production build served at `http://127.0.0.1:4173`, isolated synthetic browser contexts, and the [journey suite](../tests/journeys.spec.ts). The frozen candidate is service-worker cache `loopmark-ad60daeda70e`; the final combined result is recorded below.

## Final candidate result

**209/209 passed**, with **zero failures, skips or flaky results**, in 177.230 seconds using three workers and no retries. Run started 18 October 2026 at 10:00:49 UTC. This is the final integrated local-foundation result, including the expanded scale and phone text-enlargement cases.

| Browser project | Engine version | Passed |
| --- | --- | --- |
| Chromium desktop | 156.0.8078.4 | 43/43 |
| Firefox desktop | 157.0 | 41/41 |
| WebKit desktop | 27.2 | 41/41 |
| Chromium mobile emulation | 156.0.8078.4 | 43/43 |
| WebKit mobile emulation | 27.2 | 41/41 |

Each project's production-offline test attached its actual controller and cache metadata: `/sw.js` was activated, with the single cache `loopmark-ad60daeda70e`. The scale cases independently recorded the same cache identity. The full machine-readable report and transcript were captured as `/tmp/loopmark-final-browser-results.json` and `/tmp/loopmark-final-browser-results.txt`; extracted totals/cache metadata are `/tmp/loopmark-final-browser-summary.json`. The retained output directory is `test-results-cross-browser-release`. Earlier failure runs remain separate for diagnosis.

The independent one-worker Chromium scale check passed 4/4 on the same build; exact fixture sizes, timings and limitations are in [performance-review.md](performance-review.md). Final visual evidence uses synthetic isolated contexts after fonts loaded: [desktop guide](evidence/completion-guide.png) and [375px mobile draft](evidence/completion-draft-mobile.png). Preview on port 4173 remains available.

## Coverage and reproduction

The [Playwright configuration](../playwright.config.ts) now defines Chromium, Firefox and WebKit desktop projects at 1440 × 1000, a Pixel 7 Chromium emulation, and an iPhone 13 WebKit emulation. Each project also runs explicit 320px and 390px reflow journeys. Device descriptors exercise touch, viewport, pixel ratio and user-agent behavior; they do not prove actual phone, Safari-app or OS behavior.

There are 109 core journey cases: 23 each for Chromium desktop/mobile and 21 each for Firefox, WebKit desktop/mobile. Two `@chromium-media` tests require Chromium's fake microphone flags and are explicitly assigned only to Chromium projects. The other engines run actual native MediaRecorder encoding and playback using a synthesized Web Audio stream, plus missing-API and denied-permission recovery. No broken application flow is excluded from an engine to obtain a pass.

The [reliability suite](../tests/reliability.spec.ts) adds nine contracts in each of the five projects (45 cases), covering recovered-edit revisions, competing drafts, failed draft writes, durable duplicate prevention after cleanup failure, stale restore previews, and storage-protection outcomes. The full integrated suite also includes 20 draft, 15 offline-lifecycle and 20 scale/enlargement cases, for 209 cases with no skips. Scale fixtures run across all engines; latency budgets remain calibrated to desktop Chromium. Desktop 200% zoom is a 640px layout model, and independent 200% text enlargement runs on every profile at its normal viewport width.

All engines cover:

| Contract | Exit condition |
| --- | --- |
| Project and checkpoint lifecycle | Create/edit, immutable code/history, latest-step resume, reload persistence, finish/reopen, cancel/delete and missing-record recovery. |
| Photo handling | Decode rejection, 2000 × 1200 image resized to 1600 × 960 JPEG, save/reload and offline capture. |
| Voice | Native encoded stream saves, survives backup/restore into an isolated context and plays with positive currentTime and no decoder error; denied/missing API permits a written checkpoint. Navigation during delayed FileReader conversion waits, preserves the completed voice in a recoverable draft, and saves it after reopening. |
| Backup transactions | Hostile/invalid files preserve the existing collection, replacement requires confirmation, injected failed replacement rolls back entirely. Changes after preview require review of updated counts and a second explicit replacement confirmation. |
| Cross-tab behavior | Both concurrent checkpoints survive and stale project edits cannot overwrite newer data, including a recovered edit draft. Competing drafts preserve the first stored copy and warn before abandoning the second input. |
| Draft failures | Failed draft writes show lost-recovery status while an explicit record save still succeeds. A failed draft deletion cannot duplicate a saved checkpoint, including after reload. |
| Storage protection | Already-persistent, unsupported, status-check error, denied request and successful retry states are distinguished; backup download stays available. |
| QR and printing | Independently decode generated PNG QR to exact project URL, open saved record, invoke print and inspect print-only visibility. |
| Offline | Activate production service worker, reload offline, capture text/photo and reload again without third-party requests. |
| Storage failures | Blocked IndexedDB and injected quota failures show recovery and preserve prior committed data and form values. |
| Accessibility | Forward and reverse keyboard focus containment, Escape/opener restoration, mobile navigation, eight-state axe A/AA scans. |
| Content stress | Maximum-length unbroken names, tools, yarn, notes, position and next step reflow at 320px; reduced-motion preference stops animations. |
| Scale and enlargement | 50 projects/500 checkpoints, text saves with 20 projects/200 checkpoints, and 10-project/100-checkpoint media restore persist exact contents. Doubled text preserves shelf/detail/capture/backup use on desktop and phone profiles. |

Reproduce with `npm ci`, `npx playwright install chromium firefox webkit`, `npm run build`, then `npm run test:e2e`. The suite starts production preview automatically when port 4173 is free. Use separate `--output` directories if multiple agents run tests concurrently. The updated CI workflow retains Node 24 build/unit/format verification and runs three independent browser-engine jobs; Chromium and WebKit each include their mobile emulation project. CI uploads per-engine reports and traces even after failures. Hosted CI execution is separate from the local results below.

## Baseline findings

The original Chromium baseline passed 18/18. Firefox passed all 16 applicable original journeys. Initial WebKit desktop/mobile runs found a focus failure, and the new stress/media cases found two further defects.

| Finding | Reproduced behavior | Regression |
| --- | --- | --- |
| WebKit dialog keyboard escape | Tab traversal moved focus outside the dialog, despite Chromium and Firefox passing. Native WebKit traversal can skip buttons that the boundary-only trap assumes it will visit. | `dialog traps keyboard focus and returns it to the opener`, forward and reverse Tab. |
| Long-field mobile overflow | A 320px detail page with valid maximum-length unbroken strings measured 1522–1523px wide across desktop engines. Mobile Chromium could not reach the resulting offscreen capture button. | `maximum-length unbroken fields reflow at 320px and reduced motion suppresses transitions`. |
| WebKit voice rejected at save | Native WebKit recording returned `data:audio/webm; codecs=opus;base64,...`; the validator rejected the legal whitespace before `codecs`, leaving the checkpoint form open. | `native recorder accepts a synthesized audio stream and restores its playable output`. |
| Phone text enlargement | Doubled text made the shelf filter row 454px wide in a 390px phone viewport. Ordinary narrow-screen reflow did not expose it. Filter controls now wrap. | `200% zoom reflow model and 200% text preserve shelf, capture and backup use`, both phone profiles. |

The first integrated repair run found two further issues: asynchronous draft loading disabled the first field during initial dialog focus, and stricter WebM validation rejected Firefox's legitimate empty SeekHead element. Later draft lifecycle checks caught successful-save navigation being blocked by an exit guard and navigation racing unfinished voice conversion. Their focused browser rechecks passed after repair; the final integrated run remains the release evidence.

Test-fixture issues were corrected without weakening product assertions: the empty-shelf selector now targets project-card buttons instead of also matching the mobile “Open navigation” button; media denial/synthesized-stream injection uses the MediaDevices prototype because WebKit replaces the instance method during hash navigation. Project creation helpers wait for closed dialogs, the project hash URL and the detail H1; matching a shelf-card heading during asynchronous draft cleanup was insufficient. The older fake-media test now also waits for dialog closure and the committed latest checkpoint before navigating to backup. Actual native recording, payload validation, storage and playback remain exercised.

The first complete frozen-build run reported 190 passes, 14 intentional scale/zoom exclusions and five failures. Two failures were the fake-media navigation race above. Three WebKit first interactions missed their expected transition. A focused reproduction captured the storage case: mouse-down hit the status paragraph, mouse-up hit the button, and the resulting click hit their parent while scrollY changed from 687 to 741 and back. Fonts were already loaded and the trace showed no intervening DOM update. This supports a scroll/input coordination diagnosis; it does not establish an upstream WebKit bug or a product layout correction. The tests now wait for fonts and, for the affected sample/protection controls, scroll into view and allow two animation frames before a single native click. They do not retry clicks, force actions or dispatch synthetic application events. The three affected journeys passed 60/60 focused repetitions with this setup. Original failure traces and diagnostic logs were retained.

After extending scale and phone enlargement coverage, the first 209-case run on `loopmark-ad60daeda70e` passed 208 with one WebKit project-opening setup timeout. The trace showed that the helper awaited `document.fonts.ready` while the loading screen was still mounted; the shelf and its fonts appeared afterward. The helper now waits for the actual control to be visible before waiting for fonts and the first scroll paint. A separate instrumented attempt did not reproduce the desktop miss in 50 runs, so the original missed click's precise cause remains unproven. The corrected setup passed 20/20 repeated fallback-media journeys across both WebKit profiles before the final combined run. No application change was made for this diagnostic finding.

## Evidence limits

Local environment: macOS ARM64, Node 26.8.2, Playwright 1.64.1, Chromium 156, Firefox 157, WebKit 27.2. This is browser-engine testing, not a physical Safari/iPhone/Android test. A synthesized stream proves the engine's recorder/container/decoder and application path; it does not prove microphone hardware, real permission UI or acoustic quality. Chromium fake-device duration tests use virtual time. Quota failures are injected, not actual disk exhaustion. Printing is emulation, not paper output. PWA OS installation, store publication, physical camera/printer and screen-reader speech remain outside this executable environment. Axe success is not accessibility certification.

Durable lessons are preserved in the regressions: WebKit may change the MediaDevices object through hash navigation; its recorder MIME parameters can contain whitespace; native keyboard traversal varies by engine; and valid maximum-length strings must be tested without convenient word-breaking spaces. No optional global tooling was installed, and no telemetry, remote audit service or production account was used.
