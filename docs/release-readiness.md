# Expanded release readiness

Status: **implementation and local verification in progress; external activation blocked by named prerequisites**. This is the expanded release record. Foundation-only completion reports describe their earlier scope and do not establish cloud, billing or native release readiness.

## Current disposition

| Boundary | Evidence available | Remaining gate |
| --- | --- | --- |
| Guest craft workflow and separate restore | Browser regression, migration, draft and backup tests; preserved foundation checks | Final integrated source freeze and complete current matrix |
| Account/connection/sync/deletion | Actual local Auth/Postgres/Storage/Edge, delivered codes, two-device flows, private receipt and retained-copy tests | Current media/purchase integration, full adversarial and final regression |
| iOS/Android | Real simulator/emulator persistence, native adapters and production-screen save/relaunch/permission flows | Exact final bundle rerun, physical hardware, store sandbox, signing and actual associated-domain proof |
| Web/store purchases | Strict contracts, hosted-navigation and native adapters; local provider-authority implementation progressing | Real merchant/RevenueCat/store accounts and actual sandbox scenario evidence |
| Operations and contributor workflow | Local setup/configuration and current evidence | Full recovery/rollback/load/clean-contributor execution and independent judgment |
| Pilot and funding | Concrete protocol, operating scenarios and activation record | Named owners, approved funds, consented cohort, actual 10/8/5 outcomes |

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
