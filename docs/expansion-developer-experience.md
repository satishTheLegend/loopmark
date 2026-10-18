# Expansion developer workflow contract

This is an implementation specification. Commands marked **new** do not exist yet; they are required deliverables, not executed results. Existing `npm ci`, `npm run dev`, `npm test`, `npm run build`, `npm run test:e2e` and `npm run format:check` remain supported. The product is a craft app; the developer audience is its small TypeScript implementation and operations team, not external SDK consumers.

## Four setup paths

| Path | Start state and commands | First understood result | Evidence boundary |
|---|---|---|---|
| Guest web | Clean checkout, Node 24 LTS/npm installed; `npm ci`; `npm run dev`; create and save one checkpoint at printed URL | Saved note survives reload without account/network dependency | Target under 5 minutes including README reading and dependency install; cold network time recorded, not excluded |
| Local sync | Above plus running Docker-compatible runtime; **new** `npm run local:up`; **new** `npm run test:sync:smoke` | Two independent browser contexts converge the same checkpoint, A/B access denied | Cold image download and migration time measured separately and together; no claim under 5 minutes |
| Native development | Above plus Xcode/iOS simulator or Android SDK/JDK/emulator; **new** `npm run native:sync`; **new** `npm run native:ios:build` or `npm run native:android:build` | Unsigned simulator/emulator app saves/reopens a native local checkpoint | No signing/store account needed for this result; toolchain installation and build measured separately |
| Provider sandbox | Local contracts passed, developer supplies authorized merchant/store test accounts and secrets | Real sandbox order/webhook or store purchase/restore changes server entitlement | Never replaced by fakes; prerequisites and exact account step appear in provider guide |

`local:up` checks Docker and project-pinned Supabase CLI, creates an isolated loopback-bound local network, starts only the selected project/worktree stack and applies migrations plus synthetic fixture data. It writes a gitignored `.env.local` containing public local endpoints/keys only; never prints service-role secrets. No production linking, global install, destructive reset, paid account or upload. On port collision it exits with a named override instruction rather than reusing another worker's database. `local:down` stops this stack without deleting volumes; **new** `local:reset -- --confirm-project <id>` is separate and refuses nonloopback endpoints. Commands display the workspace/project ID and purpose before changes.

`npm run doctor` (**new**) reads versions, required files, free ports and capability flags without mutation or network account setup. Human output and `--json` distinguish guest-ready, local-sync-ready, native-toolchain-ready and provider-sandbox-unconfigured. Missing provider credentials do not fail the guest path. Exit 0 means requested capability ready; 2 configuration/prerequisite missing; 3 unhealthy local dependency. No secret value is printed. Exact proposed success summary: `Guest web: ready. Local sync: ready. Provider sandbox: not configured.` Do not hardcode a success when probes fail.

## Public configuration versus invariants

Typed configuration lives in `src/config.ts`; server config in `supabase/functions/_shared/config.ts`; operator config in `scripts/lib/config.mjs`. `.env.example` lists names, safe example values, scope and whether required for each path. Parse once with Zod and reject invalid values before enabling the affected capability. Project package/lockfile pins the CLI and native dependencies; no global dependency installation is required.

| Value | Default / permitted override | Scope and precedence |
|---|---|---|
| App origin and backend URL | Guest has none; local loopback endpoint from local:up; HTTPS for remote | Explicit process environment over gitignored local env; no runtime arbitrary redirect target |
| Public auth key | Absent disables cloud, never guest | Vite/native public key only; service-role key forbidden by schema/bundle scan |
| Local port/project ID | Deterministic per-worktree profile, explicit `LOOPMARK_DEV_PROFILE` override | Local tools only; checked collisions, recorded in evidence |
| Media concurrency | 2; integer 1–4 | Client config; no change to ownership/admission |
| Retry delay | 1 second initial, cap 60 seconds, bounded jitter; server retry-after honored | Client test adapter may inject clock; production max attempts per foreground cycle documented |
| Alert thresholds | Sync 5 minutes, webhook 5 minutes, deletion 24 hours,daily backup | Server/operator bounded nonnegative durations; source shown in doctor |
| Cloud/payment availability | Disabled unless complete valid configuration and enrollment gates | Server authoritative; client cannot enable server grant |
| Test adapters | Constructor injection only in tests/local debug bundle | Production build rejects test-grant module and test-store release key |

Fixed invariants are not configuration: authenticated owner, account-generation fences, verified server entitlement, atomic record/outbox, stable receipt/hash identity, revision/epoch CAS, no loss of historical data, all-byte complete export and the 200 / 1,000 / 48 MiB envelope until a separately tested new format. A large env value cannot relax them. Provider adapters implement the same typed contracts; no network calls belong in React components.

## Contracts and error catalog

P2 must freeze `src/domain/contracts.ts`, `src/domain/schema.ts`, `src/domain/errors.ts` and `src/domain/policy.ts` before parallel consumers. Distinguish `protocolVersion:2` (wire envelope), per-kind `payloadVersion:1`, local schema version, server migration number and portable `backupVersion:1`; none implies the others. Include `collectionId`, `collectionEpoch`, device identity, operation ID, base revision, canonical payload hash and trusted server owner in documented request/receipt types. Cancellation aborts transport only; an already committed operation may still require lookup by the same idempotency key. SyncCoordinator alone owns transient retry; adapters return typed failures and do not nest hidden retry loops. Exact method shapes and durable ordering are in the engineering contract.

Shared safe error type: `{code, problem, cause, nextAction, retryable, retryAfterMs?, correlationId, helpRef, field?}`. `helpRef` names a bundled offline-help entry and optional public docs anchor. UI wording is safe; authorized operator diagnostics may add redacted boundary details. Map every CEO rescue-row class and setup error. Do not reveal whether an unauthorized project/account exists.

| Boundary | Current evidence | Proposed problem / cause / fix / help |
|---|---|---|
| Local stack start | No expansion start script exists | `DEV_RUNTIME_UNAVAILABLE`: Local sync cannot start / Docker-compatible runtime is unavailable / Start it, then rerun local:up; guest mode still works / `developer-setup#runtime` |
| Old collection epoch | Plan names EpochMismatch, no runtime wording | `SYNC_REBASE_REQUIRED`: These changes belong to an older collection / The connected collection was replaced / Keep them in Recovered work, refresh this collection, then choose a destination / `sync#recovered-work` |
| Media quota | Plan has preservation rule, no runtime wording | `MEDIA_CAPACITY_REACHED`: This attachment is saved only on this device / The account's portable-data limit is full / Export or review account storage; upgrading project access does not raise this limit / `storage#capacity` |
| Existing malformed backup | Actual `src/data.ts`: “This file is not valid JSON. Choose an exported Loopmark backup.” | Preserve that useful remedy, add stable `BACKUP_INVALID_JSON`, safe cause and `backup#invalid-file`; no metadata/content logging |

## Operator command grammar

Use **new** `npm run ops -- <replay-webhooks|reconcile-purchases|resume-deletions|backup-snapshot|restore-check|status> --environment <local|staging|production> --target <redacted-id|all> --limit <1..100> [--cursor <opaque>] [--json] [--execute]`. Default environment local, limit 20, dry-run. Production requires explicit environment and matching configured project identity; noninteractive execution requires all target/scope arguments. Dry-run prints project, environment, target, effect count and next cursor. `--execute` is explicit mutation intent, not authority to bypass authorization. `restore-check` restores to a fresh isolated target, never over the source. Commands honor cancellation and cap runtime/work count. Idempotent replay uses existing event/operation IDs; reports carry resumable job IDs. Exit 0 success, 2 usage/config, 3 dependency unavailable, 4 partial/retryable, 5 denied/invariant violation. JSON has stable schemaVersion,status,counts,nextCursor,jobId,errors; stderr diagnostics never corrupt stdout JSON. `--help` documents exact flags, safety boundary and examples.

## Documentation and examples

Add `docs/developer/README.md` with links to quickstart,configuration, contracts, testing, native builds,provider sandbox,operations and migration. README keeps guest path first and links this index. `examples/` or `tests/examples/` contains executable TypeScript examples for local save, offline push with lost acknowledgement, conflict retry, complete export and durable webhook reconciliation. Examples use synthetic data, real domain contracts and explicit fake-provider labels. CI executes examples and verifies documented npm scripts/config names exist; external sandbox tests run separately with authorized secrets and cannot silently skip into PASS. Bundle offline error help with the app. Maintain `CHANGELOG.md` and `docs/developer/migrations.md` for supported wire/local/backup versions and N/N-1 client compatibility; reject unsupported writes with actionable upgrade/recovery text while preserving export. No destructive downgrade or automatic store/production deployment.

The project has no public remote or developer community. `CONTRIBUTING.md` documents maintainer handoff, issue reproduction with synthetic data, ownership, tests and private security reporting procedure. It does not publish a repository, choose an open-source license, create Discord or send messages. Dependency license inventory remains required.

## Measurement

Record one clean-checkout human walkthrough per supported contributor OS before release of the expanded developer workflow: README reading, command count, dependency downloads, first useful saved/reloaded checkpoint, confusion and observed duration. Target under 5 minutes with supported Node/npm preinstalled; cold packages count. Record network and hardware, avoid comparing warm script time to that target. Local backend/native/provider paths have distinct clocks and account/tool waits. CI measures its own cold/warm setup and smoke durations only as automation evidence. No hidden telemetry or recurring researcher prompting is introduced. After implementation rerun DX review against captured output; unmeasured TTHW stays unknown.
