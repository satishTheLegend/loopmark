# Eight-screen Firefox accessibility timeout

The frozen production suite reported 263 passes and one Firefox timeout. The preserved trace contains all eight axe result attachments; every result is `[]`, and all eight corresponding assertions finish without an error. Guide finishes after the aggregate 30-second test budget starts teardown. This evidence supports a fixture budget exhaustion diagnosis, not a recorded accessibility violation. It does not establish why this particular Firefox run was slower.

Source: product commit `a07b014cdde249bbba94c6567a73f24f800797da`, `tests/journeys.spec.ts:669`. The full trace and source stdout SHA-256 values are in [metadata.json](metadata.json). Raw trace screenshots, request data, and environment details are excluded from this bounded extraction. The eight `axe-*.json` files are exact attachment bytes from that trace.

Times below are seconds relative to the `Before Hooks` event.

| Screen | Scan starts | Result attached | Assertion ends | Violations |
| --- | ---: | ---: | ---: | ---: |
| empty | 2.680 | 5.170 | 5.174 | 0 |
| project-form | 5.399 | 7.198 | 7.201 | 0 |
| project-detail | 9.763 | 12.070 | 12.081 | 0 |
| checkpoint-form | 12.239 | 15.995 | 15.996 | 0 |
| bag-label | 18.194 | 20.776 | 20.779 | 0 |
| populated-shelf | 21.343 | 24.990 | 24.991 | 0 |
| backup | 25.043 | 28.788 | 28.789 | 0 |
| guide | 28.881 | 30.977 | 30.978 | 0 |

`After Hooks` starts at 30.012s. Guide's axe partial scan starts at 29.356s, then axe creates a blank result-processing page at 29.967s. Guide's zero-violation attachment appears at 30.977s and its assertion finishes at 30.978s during teardown. Cleanup ends at 36.250s, consistent with the stdout duration of 36.2s. The per-browser trace stopping during teardown is not evidence that the final assertion is missing: it is present in `test.trace`.

[red-timeline.json](red-timeline.json) records exact selected event IDs, relative milliseconds, attachment hashes, and final processing calls. [red.stdout.excerpt.log](red.stdout.excerpt.log) preserves the command/header, all five profile outcomes for this test, and complete failure/summary block with source line ranges. It is an explicitly labeled excerpt of the original redirected stdout, not reconstructed output.

The test now has an explicit 60-second aggregate budget with the same eight scans and assertions. No global timeout, retry, animation wait, or product change was made. After the load-window release, the focused test passed on all five browser profiles with one worker: **5 passed in 26.1s** (Chromium 3.8s, Firefox 5.5s, WebKit 5.1s, Chromium mobile 3.5s, WebKit mobile 4.6s). All **40 attachments** are exactly `[]`.

[green.stdout.log](green.stdout.log) is the complete byte-for-byte redirected output. [green-results.json](green-results.json) preserves the exact command, timing, source blob, raw report/stdout hashes, and each attachment hash; the `green/` directories contain the unchanged decoded attachment bytes. This is a focused five-profile qualification, not a rerun of the complete 264-test suite.
