# Canonical delivery

[Final delivery report](2026-10-18T19-17-29-858Z-0e3f9ca/delivery.json) and [handoff integrity](2026-10-18T19-17-29-858Z-0e3f9ca/handoff.json) record the successful delivery to `/Users/lalaji/Repos/CGProjects/loopmark` on `main`.

The reviewed integration revision `0e3f9ca3ff10272e6d1a8511883f9634fb772563` was fast-forwarded into the canonical folder. Its 157 production inputs remain identical to frozen product source `2b6e6286ddb8ca46368f58b82378b644432d19d1`. The later delivery-evidence commit adds only this record.

The procedure checked checkout, dependency-directory and preview-process ownership; stopped the prior owned preview; ran the locked `npm ci`, production build and guest doctor; and started the new owned preview at **http://127.0.0.1:4173**. Both selected Chromium journeys passed with one worker and no retries: complete project/checkpoint/history lifecycle, and photo/simulated-voice export with isolated-browser restore. Existing user browser storage was not cleared. All 41 recorded command-log hashes match, and the served HTML hash matches the canonical build.

The [archived procedure](2026-10-18T19-17-29-858Z-0e3f9ca/delivery-procedure.mjs) records this specific run and its bound process identities. It is not a general installer. The preview is intentionally left running; backend services and native test devices were stopped with preserved backend volumes. No hosted provider, live purchase or store release was activated.

[Native artifact metadata](../native/final-artifacts.json) identifies the retained Android debug APK and iOS simulator archive in the canonical project's `artifacts/native/` directory. Their platform and signing limits remain explicit.
