# Native adapter measurements

The preserved baseline is source `3141cd6586e4783b4f7ab1ba1a9f2f10363c8e81`. Its [bundle manifest](baseline-3141cd6/bundle.json) records every generated asset SHA-256; each result additionally records the manifest hash and installed app/APK hash. These are actual Capacitor WebViews, native SQLite and private files. They are synthetic adapter measurements, not a production screen-startup, physical-device or store qualification.

## Method and limits

The benchmark uses the separate application ID `app.loopmark.craft.benchmark`, preserving the installed product test app. Each sample terminates and relaunches that app. A command file selects the action; SQLite contains the previously imported collection. The runner checks the exact installed bundle before measuring. Startup includes either module entry through repository open/read, or separately OS launch through that same repository-ready timestamp. Neither metric means the React UI is interactive.

The small fixture is 10 finished projects / 100 checkpoints, with 100 distinct valid 60 KiB PCM WAV files: 8,214,758 bytes of compact portable JSON. The boundary fixture is 200 finished projects / 1,000 checkpoints and six distinct valid WAVs: exactly 50,331,648 bytes (48 MiB) of compact JSON including base64 and envelope. These are not the original desktop photo-and-audio fixture. Import timing includes validation, hashing, native publication and collection commit; synthetic fixture generation is outside the timer. Export includes strict complete-byte encoding, compact JSON, Blob and the same chunked native cache-file staging used by `NativeShare`. The OS share sheet and receiving app are outside the measurement. A separately restarted process verifies the complete project's canonical hash.

The host is Apple M5 / 16 GiB / Darwin 27. iOS uses runtime 26.5; Android uses the existing API 36 test emulator (Android 16, four virtual CPUs, configured 2 GiB RAM). The Loopmark team held its heavy jobs, but unrelated host builds/browser work were observed. At approximately 14:52 UTC swap usage was 17.6 GiB and disk pressure required reclaiming completed test build caches. Android's later measurements are especially affected. These are **contended-host observations**, not controlled hardware capacity claims. The original five-second 10/100 target in the plan is explicitly a desktop lab target; the native baseline is measured separately.

Memory samples sum RSS for the app host and its isolated WebView processes. Shared pages may be counted twice and short peaks between samples may be missed. The requested interval is 100 ms plus command overhead. Raw samples and process IDs remain in each JSON. This is neither physical footprint nor Android PSS. No p95 is inferred from the small sample counts.

## Baseline observations

| Action | iOS | Android |
| --- | --- | --- |
| Process launch → repository ready, 10/100 (5 samples) | 1,069–1,246 ms | 2,345–3,255 ms |
| Process launch → repository ready, 200/1,000 (5 samples) | 1,294–1,504 ms | 6,999–17,507 ms |
| 8.21 MB import (3 samples) | 2,631–2,778 ms | 7,508–8,463 ms |
| Exact 48 MiB import (1 sample) | 3,781 ms | 193,212 ms |
| 8.21 MB complete export through native file (1 sample) | 1,661 ms | 6,405 ms |
| Exact 48 MiB complete export through native file | 3,562–3,953 ms (3 samples) | 87,720 ms (1 sample) |
| Highest sampled RSS during exact 48 MiB export | 1,741.5 MiB | 916.5 MiB |

The baseline verified record counts and the complete canonical project content after restart. Its staged share file had a size check; all-byte staged-file comparison was added and executed in the later functional qualification below. Android repeat exports were stopped after the first complete result when host contention became clear. The Android runtime passed the same four developer examples earlier; its preliminary artifact is retained separately and will be rerun on the final candidate. iOS's committed-fixture example result is in the baseline directory. Actual corrupt/missing-file repair passed both platforms before the subsequent complete-export recovery refinement.

The high boundary memory and slow Android observation prompted a targeted follow-up: preallocated base64 decoding, raw-byte container validation, optional-snapshot cache-repair parity and phase profiling. Follow-up results must reference their own source/artifacts; these baseline numbers must not be relabeled as later-source measurements.

## Optimized candidate

Source `eb63bdf` includes the preallocated decoding and raw-byte validation changes. The Loopmark team stopped its browser/load jobs and backend containers for the sequential native interval 16:25:34–16:27:55 UTC. Host swap and unrelated processes were not reset, so this is not a controlled comparison with the older baseline. The [raw reports and summary](optimized-eb63bdf/summary.json) retain source/artifact hashes, every RSS sample, available pre-operation baseline, peak increase and last sample. The last sample is not a post-GC or released-memory claim.

| Action | iOS | Android |
| --- | --- | --- |
| Process launch → repository ready, 10/100 (5 samples) | 882–934 ms | 1,879–2,387 ms |
| Process launch → repository ready, 200/1,000 (3 samples) | 999–1,274 ms | 2,093–2,500 ms |
| 8.21 MB import (3 samples) | 2,389–3,425 ms | 4,272–7,676 ms |
| Exact 48 MiB import (1 sample) | 2,388 ms | 4,908 ms |
| 8.21 MB export through native file (3 samples) | 926–1,041 ms | 2,568–2,863 ms |
| Exact 48 MiB export through native file (1 sample) | 1,829 ms | 6,793 ms |
| Exact 48 MiB export before file staging | 1,203 ms | 4,439 ms |
| Highest sampled RSS during 48 MiB import | 1,626.0 MiB | 1,079.4 MiB |
| Highest sampled RSS during 48 MiB export | 1,428.7 MiB | 1,014.0 MiB |

Memory remains substantial. These successful simulator/emulator operations do not close physical-device memory-pressure or jetsam qualification. Native performance has no pre-established pass budget; the desktop import threshold is not reused.

The [final native adapter examples, repair, rebase and download protection](functional-final/index.json) also pass on both platforms. In a separate [functional file-integrity run](share-file-integrity-2ba523f/qualification.json), both platforms read all 50,331,648 bytes back from the actual staged file in 512 KiB chunks and compare every byte against the serialized backup before recording its SHA-256. This comparison runs after the export timer. Those runs occurred under shared host load and do not replace the isolated timing records. No claim is made about a receiving app's eventual destination.

## Reproduce

Use the toolchain and explicit test-device selection in `docs/developer/native.md`. No global environment or personal device is changed. Build only after preserving any prior evidence:

```sh
LOOPMARK_NATIVE_BENCHMARK=1 node scripts/native/build-benchmark.mjs
LOOPMARK_NATIVE_BENCHMARK=1 node scripts/native/build-benchmark-app.mjs ios
LOOPMARK_NATIVE_BENCHMARK=1 node scripts/native/build-benchmark-app.mjs android
```

Set `LOOPMARK_IOS_SIMULATOR` to the test-owned booted simulator; set `ANDROID_SERIAL`, `ANDROID_HOME`, and `LOOPMARK_JAVA_HOME` for Android. With `LOOPMARK_NATIVE_BENCHMARK=1`, run `node scripts/native/benchmark.mjs <ios|android> <import|startup|export|examples|repair|profile> <small|limit> [samples]`. Import the same dataset before startup/export. `LOOPMARK_NATIVE_BENCHMARK_WINDOW=exclusive` records only team coordination; operators must separately record actual host isolation/pressure. Restore production generated assets with `npm run native:sync` before any product build, and verify the resulting product manifest.
