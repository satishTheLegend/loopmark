# Expanded release readiness

Status: **local implementation and browser/backend verification complete; final native qualification in progress; external activation blocked by named prerequisites**. This is the expanded release record. Foundation-only completion reports describe their earlier scope and do not establish cloud, billing or native release readiness.

## Current disposition

| Boundary | Evidence available | Remaining gate |
| --- | --- | --- |
| Guest craft workflow and separate restore | 394 current unit cases, 15 current status/accessibility cases and 40 current startup/draft cases; retained 255-case UI / 264-case full guest / 100-case targeted guest matrices and isolated scale evidence | Finish the current frozen native artifact qualification; physical-device behavior remains separate |
| Account/connection/sync/deletion | Current `2b6e628` affected cloud run 40/40; actual local Auth/Postgres/Storage/Edge, delivered codes, two-device flows, authority/retention/recovery and 84/84 server tests. Earlier 77/80 and 76/80 full runs remain failed records with explicit focused closures | Hosted provider configuration and production qualification; no live account or purchase claim |
| iOS/Android | Real SQLite/files, inbox-store faults, OS file delivery, production capture/relaunch/permissions/diagnostic share cancel/review/restore/repeat; measured small/48 MiB operations | Current full harness, acknowledged-voice restart and production artifact refresh in progress; physical hardware, store sandbox, signing and actual associated-domain proof remain external |
| Web/store purchases | Strict contracts, hosted/native adapters and actual local ledger/webhook authority using an explicitly synthetic provider | Real merchant/RevenueCat/store accounts and actual sandbox scenario evidence |
| Operations and contributor workflow | Actual encrypted database/object recovery, independent-current erasure ledger, fair scheduling, alerts, compatible rollback, clean automated contributor checkout and dependency provenance; 1,000-account recovery/audit pass, simultaneous burst and peak backup fail | Independent final judgment; hosted capacity qualification, disaster-separated external recovery facility and operating owner |
| Pilot and funding | Concrete 21-day/15-maker protocol, operating scenarios and activation record | Named owners, approved funds, consented cohort, actual 10/8/5 outcomes |

Use the [execution ledger](expansion-execution.md) for changing implementation detail. A PASS in one boundary does not imply another. Simulator microphone denial is not physical recording fidelity. A synthetic provider response is not a provider sandbox transaction. A source review is not an executed recovery drill.

## Evidence checker

`npm run test:release:contracts` checks the checker using explicitly synthetic records. `npm run test:release -- --environment staging --platform web --json` performs a read-only check of an operator-supplied evidence manifest at `.gstack/release/staging-web.json`. Use `--manifest` for another local path. Supported environments are staging/production and platforms web/ios/android. Missing manifests or gates exit 2 with BLOCKED; no skipped test is represented as passing.

Prepare the manifest **after freezing and committing the tested source**. Keep the final manifest in ignored `.gstack/release/` so its revision can identify the clean commit without a self-referential commit hash. Record `schemaVersion: 1`, environment, platform, the exact 40-character source revision, nonempty `artifacts: [{path, sha256}]`, and `gates: [{id, status, evidence: [{path, sha256}]}]`. Evidence files must be inside `docs/evidence/` or `.gstack/release/`; artifacts must resolve inside the project. Paths through symlinks outside the checkout, changed bytes, duplicates, dirty source and wrong targets fail closed. No secrets or purchase/deletion capability tokens belong in a manifest.

Required shared gates: regression, security, compatibility, accessibility, recovery-drill, operations, configuration, support-privacy, funding, release-owner-review. Web adds provider-sandbox-web and host-routing. Native adds native-build, native-persistence, physical-device, store-sandbox, signing, install-upgrade, deep-links and store-disclosures. Production adds pilot-decision. Use status pass/fail/blocked/unverified; only actual PASS with matching evidence can satisfy a gate.

The output `evidence-complete` means the supplied recorded statuses and hashes are consistent. It does **not** independently prove the assertions inside a report, grant authorization, publish anything or qualify untested hardware. The independent reviewer must inspect evidence scope, conditions and unresolved findings. Release authorization remains the specific decision in the [activation record](release/activation-record.md).

## Exact external actions needed

1. Select owned backend/email/recovery providers, region, HTTPS domain and working support contact; approve an operating ceiling and owner.
2. Supply authorized staging provider configuration through private environment/secret management. Activate an eligible Razorpay merchant and RevenueCat/Apple/Google sandbox products; never send credentials in chat or commit them.
3. Provide physical iOS/Android test devices and signing identities. Qualify each exact artifact for capture/playback, low storage, interruption, assistive technology, installation/upgrade and domain links.
4. Review source/build/config hashes, actual sandbox and recovery results, privacy/store disclosures and rollback record. Authorize a particular deployment or store submission only after its gates pass.
5. Authorize the separate [21-day pilot](expansion-research-protocol.md). Recruit 15 qualified makers, measure voluntary capture/week-later restart/actual purchases, and record prompting and missing data. No engineering result substitutes for this study.

Outstanding external prerequisites do not excuse unfinished local implementation. Continue independent code, tests, operations preparation and documentation before final handoff.
