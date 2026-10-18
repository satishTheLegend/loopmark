# Scale and enlarged-text verification

18 October 2026. Final measured production build with service-worker cache `loopmark-ad60daeda70e`, from the local-foundation hardening changes based on `5d9bd54`. These are local laboratory results, not field Core Web Vitals or measurements from a low-end phone. The user's newly selected cloud/checkout/native phase is separate work.

## Method

`tests/scale.spec.ts` imports synthetic v1 backups through the real file picker and confirmation UI. It exercises the built application on `http://127.0.0.1:4173`, persists through IndexedDB, reloads, and exports the resulting data for comparison. Timings begin at the browser's input/click/change event and end when the expected rendered result is observed, avoiding Playwright's protocol and actionability-wait overhead. Restore timing adds file validation and confirmed commit; it excludes human time considering the confirmation.

Environment: Apple M5, macOS arm64, headless Chromium 156.0.8078.4, one Playwright worker, no CPU or network throttling. Each test has an isolated browser context. Text saves and search use three samples; restoration uses one full media fixture. The sample count is deliberately reported and is insufficient for percentile or statistical reliability claims.

The three scale journeys execute on all five engine/device profiles and retain the same count, persistence, playable-media and exact roundtrip assertions. Timing thresholds apply to the desktop Chromium profile; the other profiles record observations without claiming a calibrated budget. The text/reflow case also runs on all five profiles: desktop exercises its zoom-reflow model, while phones retain their actual profile viewport for the 200% text test. The file contains no skipped cases.

| Declared case | Fixture | Observed result | Acceptance |
|---|---|---|---|
| Responsive shelf at 50 projects / 500 checkpoints | 176,401-byte JSON, 10 checkpoints per project | Search to correct result: 1.3, 1.1, 1.1 ms. Navigation start to populated shelf after reload: 27.9 ms. Export retains all 500 checkpoints. | Pass for this lab. Search has a 500 ms regression guard; the product specifies responsiveness without a separate numerical search budget. |
| Text save at 20 projects / 200 checkpoints | 70,486-byte initial JSON | Three click-to-latest-checkpoint saves: 17.3, 13.6, 14.0 ms. Reload preserves the last note; export contains 203 checkpoints. | Pass: each <500 ms. |
| Media restore at 10 projects / 100 checkpoints | 8,285,353-byte JSON; 100 distinct 240×160 PNGs (45,776–45,784 bytes each) and a 16,044-byte, one-second PCM WAV per checkpoint | Validation 326.0 ms + confirmed commit 287.7 ms = 613.7 ms. Image decodes; audio becomes playable; exported fields/media match the input except intentionally renewed project revision timestamps. | Pass: combined work <5,000 ms. |

The media fixture contains valid decoded data, not MIME-only placeholders. It is smaller than the maximum accepted library and uses short audio. The test does not establish performance for a 48 MiB library, maximum-duration recordings, large camera originals, storage eviction, memory pressure, prolonged sessions, or backgrounded mobile hardware. FCP/LCP/INP, frame rate and real user capture speed are not inferred from these numbers.

All five profiles also passed the three scale journeys in the combined three-worker run. These observations are not calibrated cross-device comparisons:

| Profile | Search samples, ms | Save samples, ms | Media validation + commit, ms |
|---|---|---|---|
| Chromium desktop | 2.0, 1.5, 1.5 | 18.0, 17.6, 17.0 | 652.8 |
| Firefox desktop | 6, 4, 4 | 10, 8, 8 | 554 |
| WebKit desktop | 3, 3, 2 | 8, 6, 7 | 261 |
| Chromium phone emulation | 3.4, 2.4, 2.5 | 15.4, 17.0, 18.1 | 924.9 |
| WebKit phone emulation | 6, 4, 3 | 19, 11, 11 | 478 |

Every metric attachment identifies the served worker cache and worker count. The table records the first 209-case combined run, which had 208 passed, one unrelated initial WebKit click/setup failure, and zero skipped; all 20 scale/text cases passed. After correcting the test's first-render readiness, the subsequent full run passed **209/209**, with zero skipped or flaky results, on the same build. Its [transcript](evidence/completion-browser-output.txt) retains the new timing observations; the table above is not silently relabeled as that later run. The isolated run below separately establishes the declared Chromium budgets.

## Reflow and text enlargement

The desktop test models 200% browser zoom by reducing the CSS viewport from 1280 to 640 pixels and verifies usable shelf, detail, checkpoint capture and backup controls without horizontal document overflow. Separately, it doubles each rendered element's computed font size at a 1280-pixel viewport and verifies the same important controls, a real checkpoint save and backup export.

This passed in Chromium, Firefox and WebKit. The mobile extension preserves the Pixel 7 and iPhone 13 profile widths (412 and 390 pixels) and doubles text through shelf, detail, checkpoint save and backup export. It exposed a real craft-filter overflow; wrapping the filters repaired it. Both phone cases passed on `loopmark-ad60daeda70e` in a fresh-context targeted run (2/2, 4.0 seconds). This is evidence for layout reflow and text resizing, not an assertion that operating-system browser zoom controls, screen magnification or speech assistive technology were exercised. The browser reviewer separately covers reduced motion and maximum-length unbroken text at 320 pixels.

## Reproduction and evidence

```sh
npx playwright test tests/scale.spec.ts --project=chromium --workers=1 --output=test-results-scale --reporter=line
npx playwright test tests/scale.spec.ts --grep '200%' --project=firefox --project=webkit --workers=1 --output=test-results-scale-engines --reporter=line
npx playwright test tests/scale.spec.ts --grep '200%' --project=chromium-mobile --project=webkit-mobile --workers=1 --output=test-results-scale-mobile-final --reporter=line
```

Final isolated results: **4/4 Chromium passed** (6.7 seconds) on `loopmark-ad60daeda70e`, with the browser reviewer pausing other test workloads during measurement. The phone enlargement recheck passed **2/2** (4.0 seconds) on the same build. All three desktop enlargement cases also passed in the combined run. The three measured tests attach `scale-measurements.json` with exact bytes, samples, served cache ID, worker count and runtime metadata. Test output directories are generated local evidence and are not committed. The test source is the durable reproduction artifact; this document records the measured run.

An earlier harness applied CSS `zoom` to the document root. That does not model browser zoom media-query behavior and made a dialog interaction fail. It was replaced with the explicit reflow model above; the initial failure is not presented as a fixed application defect.

Earlier build `loopmark-35d2556783b7` measurements used one repeated PNG; the final fixture uses 100 distinct images so photo-decode deduplication cannot avoid 99 validations. The table above supersedes those earlier timing values.
