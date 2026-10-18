# Completion cross-verification

18 October 2026. Scope: Loopmark's local craft-restart foundation in this separate project directory. Baseline commit `5d9bd54`; current candidate offline cache `loopmark-ad60daeda70e`. No public deployment, external account mutation, outreach or payment processing occurred. The user subsequently included cloud sync, checkout and native iOS/Android apps; their new planning record is [expansion-plan.md](expansion-plan.md). Passing this foundation does not complete that expanded scope.

## What changed

| Gap | Implemented behavior | Permanent evidence |
|---|---|---|
| Interrupted forms | New/edit/checkpoint drafts persist text and prepared media locally; explicit discard locks editing; close and hash navigation flush writes or ask before losing failed input. | `draft-recovery.spec.ts`, `reliability.spec.ts`; final judge J01/J02 |
| Cleanup and tab races | Draft compare-and-swap preserves another tab; saved record + receipt commit together. Unchanged retries cannot duplicate project/checkpoint if draft cleanup fails. Stale metadata stays protected. | Data receipt/rollback/concurrency tests; reliability cleanup/stale-draft cases |
| Recording interruptions | Close/navigation finishes active recording and waits for conversion and draft persistence. A new recording cannot overlap conversion. | Native encoder/playback roundtrip on each engine; delayed FileReader navigation regression |
| Restore confirmation | Snapshot counts/revision captured before file validation; newer writes reject replacement until fresh review and another confirmation. | Unit stale revision test; real two-tab preview/reconfirm journey |
| Malformed data | Bounded canonical dates, complete media container checks, photo decoding before restore; native WebKit MIME whitespace and Firefox empty SeekHead accepted. | Data malformed/truncated/native-recorder fixture cases and all-engine media roundtrips |
| Legacy poisoned clock | Explicit valid-backup restore can recover old invalid watermarks atomically, retains rollback and stale-edit rejection. | Raw-IDB legacy-poison/failed-restore/recovery regression |
| Offline lifecycle | Readiness checks every required cached asset; failed install/retry and cache repair are visible; updates wait for old windows; install prompt is feature-detected with manual guidance. | Real disposable HTTP origins in `offline.spec.ts`: failed asset, repair, waiting update with draft |
| Accessibility and clarity | WebKit keyboard trap, async form focus, narrow/unbroken text, mobile stacking, required-field hints, error tone and actual persistence status repaired. | Five browser projects, axe/keyboard/reduced motion, maximum fields, storage-policy states and text/reflow cases |

Drafts are explicitly separate from saved-record backups. Users must save them into the collection to include them in an export. In-progress recording cannot survive abrupt browser/process termination; normal close/navigation finishes it first. Browser data remains subject to user clearing/eviction.

## Executed verification

- Strict TypeScript/Vite production build: PASS, 29 precached assets.
- Data tests: **33/33 PASS**, including original and new regression cases.
- Formatting and `git diff --check`: PASS. Dependency advisory audit: **0 known vulnerabilities** at the time checked.
- Main JS: **124.56 kB gzip**, CSS **8.63 kB gzip** (Vite), within the declared delivery budgets.
- Final cross-engine browser run: **209/209 PASS**, 0 failures, 0 skipped, 0 flaky, in 177.2 seconds on the same frozen build. Chromium desktop/mobile: 43 each; Firefox and WebKit desktop/mobile: 41 each. The two Chromium fake-microphone cases use engine-specific flags; native synthesized recording/playback and recovery run in every engine.
- Final isolated scale recheck: **4/4 PASS** with one worker. Search at 50 projects/500 checkpoints: 1.1–1.3 ms; text saves at 20/200: 13.6–17.3 ms; 100-distinct-photo/voice restore: 613.7 ms. These are the documented desktop laboratory workloads, not physical-phone or field measurements.
- Rendered inspection: final [desktop guide](evidence/completion-guide.png) and [375px draft form](evidence/completion-draft-mobile.png) inspected by the browser owner and root. The guide reports actual offline readiness; the form retains entered text, focus and the single-column layout.

[Static transcript](evidence/completion-static.txt) · [browser transcript](evidence/completion-browser-output.txt) · [all case results](evidence/completion-browser-summary.json) · [cross-browser report](cross-browser-review.md) · [scale report](performance-review.md) · [independent judge](completion-judge.md) · [complete baseline gap ledger](completion-audit.md).

## Process and scope accounting

The root implemented UI/integration repairs; an independent data owner reproduced and repaired transactional/import defects; a browser owner ran real browser engines and owned regressions/CI; a separate scope reviewer challenged the original requirements and reviewed the final source. Ownership, base revision, review sequence, contracts, resource limits and dependency order are in [completion-plan.md](completion-plan.md).

For this local-foundation pass, brainstorming/gstack and applicable engineering/design/SEO/icon guidance were selected. Actual native product → design → engineering reviews and QA were executed. The full gstack external-model/runtime wrapper was not executed for that pass; this is not presented as cross-model consensus or a complete wrapper PASS. The headless gstack browser was used for local orientation; native Playwright supplied the exhaustive repair evidence. The later expansion has a separate actual autoplan runtime record. Exact usage and omissions are in [skills.md](skills.md), with the installed metadata inventory.

## Remaining external checks and exclusions

E01–E06 in the audit stay open: physical iPhone/Android microphone/camera, OS installation/background/retention, printer/scan, speech assistive technology, stable hosted delivery/remote CI, and the consented 15-person study with actual week-later restarts and purchases. Laboratory timing, browser emulation and injected faults cannot establish those results. Pricing, demand, human 30-second capture and conversion are unvalidated.

Cloud accounts/sync, checkout/paywall and native store packages were exclusions of the original local release. The user's later answer explicitly adds all three to the next phase, with in-depth planning before implementation. They are now planned work, not completed features or silently deferred requirements. Reminders/social/pattern features remain outside the accepted product. Public support, privacy and deletion routes will be evaluated with the expanded account/store scope. No implemented stub or fake purchase represents a live integration as complete.
