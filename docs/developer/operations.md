# Local service operations

The operator runner targets the exact worktree profile on a local Docker socket. It rejects TCP/SSH Docker contexts, remote overrides, another profile, hosted environments, unknown flags and unbounded limits. It does not log credentials, craft text, email, raw webhook bodies or object URLs. Hosted scheduling and independent infrastructure require the separate I14 account/ownership qualification; these local commands do not activate a service.

Run commands from the project directory. JSON stdout has one result, including `schemaVersion`, status, dry-run state, counts, safe errors and an operation ID. Exit codes are 0 success, 1 partial work, 2 invalid input, 3 unavailable/unqualified dependency, and 130 cancelled. The command defaults to **dry-run**. Add `--execute` to mutate. `--limit` defaults to 20 and accepts 1–100; each worker phase is bounded. Ctrl-C stops new work and unfinished work remains retryable under its durable IDs/leases.

```sh
npm run ops -- status --environment local --target all --limit 20 --json
npm run ops -- replay-webhooks --environment local --target all --limit 20 --json --execute
npm run ops -- reconcile-purchases --environment local --target all --limit 20 --json --execute
npm run ops -- resume-deletions --environment local --target ACCOUNT_UUID --limit 20 --json --execute
npm run ops -- maintenance --environment local --target all --limit 20 --json --execute
npm run ops -- backup-snapshot --environment local --target all --job-id POINT_UUID --json --execute
npm run ops -- restore-check --environment local --target POINT_UUID --json --execute
npm run ops -- schedule --environment local --target all --limit 20 --json --execute
```

`replay-webhooks` performs authenticated-inbox reconciliation through current provider lookup. It does not treat historical event state as authority. Payment workers use at most four active canonical purchase leases and fenced updates. Native admission reservations expire after 15 minutes; cancelling the native sheet releases only intent admission. A late verified purchase still reconciles.

`maintenance` checks the current independent erasure ledger, replays missing disable barriers, physically expires recovery directories, advances eligible deletion receipts, compacts old device receipts/feed safely, and sweeps unreferenced objects. A deletion receipt can become complete only after its disclosed expiry and after every containing recovery point has been physically removed. Completed webhook inbox rows expire after 30 days; retained minimal purchase evidence follows the actual provider/jurisdiction policy selected before live sales.

`schedule` is one bounded tick. Its durable leases allow an external operator scheduler to invoke it every minute: billing/maintenance become due each minute, backup after one day. No OS cron or hosted scheduler is installed automatically. Repeated/overlapping ticks cannot claim an unexpired lease. Failed work backs off; invariant failures can be quarantined for investigation. Service activation needs a named on-call owner and a recurring monthly restore drill.

Status reports the age of received-but-unacknowledged commands, aggregate conflict rate and media failures over 15 minutes, maximum server phase duration, verification lag, deletion age, expired-device count, recovery freshness and storage bytes. Unsent device outboxes cannot be observed by the server and remain a separate client diagnostic. Operation IDs are SHA-256 projections scoped to the verified owner; metric buckets contain no craft content or account identifiers. Deleted account pending projections are removed at the disable barrier. Monitoring errors never change an already committed command outcome.

Create `.gstack/local/<profile>/operations-policy.json` with an actual named responsible owner, thresholds, optional storage capacity and an approved monetary operating budget. Unknown fields and invalid values fail closed. Without this file, status reports `OPERATIONS_OWNER_UNASSIGNED` and `OPERATING_BUDGET_UNCONFIGURED`; the project does not invent a funded service or human owner. A **synthetic test example**, not a funding decision:

```json
{"owner":"Synthetic drill owner","thresholds":{"syncSeconds":300,"webhookSeconds":300,"deletionSeconds":86400,"backupSeconds":86400,"verificationSeconds":3600,"conflictPercent":10,"conflictMinimum":20,"mediaFailures":5},"storageBudgetBytes":1073741824,"operatingBudget":{"currency":"INR","approvedMonthlyMinor":10000,"spentMinor":8000,"observedAt":"2026-10-18T00:00:00Z","fundedThrough":"2026-11-01T00:00:00Z"}}
```

The monetary amount is in minor currency units. A qualified operator must update observed spend from actual account billing at least daily and record the funded-through date. Money thresholds produce separate `OPERATING_BUDGET_50/80/100` alerts; bytes produce `STORAGE_CAPACITY_50/80/100`. Stale spend observations and expired funding are separate alerts. An executing scheduler tick at the configured monetary ceiling pauses new cloud enrollment and never automatically resumes it. It does not stop existing access or initiate charges. Alert delivery integration and a funded named owner remain activation gates; local stdout is the implemented delivery surface.

`pause-enrollment`, `resume-enrollment`, `pause-payments`, and `resume-payments` use the same explicit grammar and dry-run default. They update a service-only negative admission control in one transaction. Existing accounts, command/read/export APIs, entitlement refresh, callbacks and already-created purchases remain accessible; provider credentials/enrollment are still required to permit a new purchase. Controls do not alter offline device storage. `rollback-check` runs the preceding qualified protocol-2 server function artifact on the additive current database, checks its authenticated boundary, and restores the exact current artifact in `finally`. Actual regression callers verify reads, writes and exports in both runtimes. An exclusive durable profile journal refuses overlapping rollbacks. If the process is killed during replacement, `rollback-resume` restores the exact saved current artifact only after verifying that the recorded process is no longer running. An invariant failure leaves the journal closed for investigation. No SQL downgrade is performed. Exact source hashes, prior revision and elapsed time are recorded privately; the one-hour target and fifteen-minute disable target are measured locally.

For a failure, preserve the operation ID and run status. Retry the same backup ID after correcting missing/corrupt bytes or disk capacity. Never turn an incomplete point into complete by editing its index. Stop new enrollment/payment initiation through the reviewed configuration flags while preserving existing local capture/read/export. Roll back only to an additive N/N-1 compatible binary; do not reverse migrations or erase local outboxes. Record the exact artifact/config hashes and elapsed disable/rollback time in the release drill evidence.
