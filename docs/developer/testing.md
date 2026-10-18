# Tests and executable examples

Run checks from the project directory. A missing runtime is a failing prerequisite, not a skipped green test.

| Command | What it proves |
| --- | --- |
| `npm test` | Domain, adapters, services and configuration with deterministic fault/dependency boundaries |
| `npm run build` | Type checking, production compilation and generated offline/public assets |
| `npm run test:e2e` | Credential-free browser journeys, migration, accessibility, offline and capacity behavior |
| `npm run test:examples` | The contributor examples below execute against actual repository/service contracts |
| `npm run test:docs` | Documented scripts, file links, configuration names and required setup paths remain present |
| `npm run test:dx` | Read-only doctor failures, destructive-command refusal and bundled secret exclusion |
| `npm run test:server -- --suite all` | Actual isolated SQL/Edge/Auth/Storage boundary tests; requires local stack |
| `npm run test:sync` | Actual OTP, multi-browser conflict/media/replacement/deletion and app cloud UI; requires explicit `LOOPMARK_SYNC_PUBLIC_ENV` |
| `npm run test:ui` | Synthetic component pages with real services/IDB where applicable and controlled provider I/O; no backend required |
| `npm run test:load -- --accounts 100` / `--accounts 1000` | Actual isolated reconnect, interrupted-media, webhook, compaction and encrypted-backup workload; preserves burst failures separately from bounded recovery |
| `npm run test:load:capture` | Independently timed actual App checkpoint saves, reload and full export; overlap must be matched to a separate load report |
| `npm run test:native:ios` / `npm run test:native:android` | Actual native bridge assertions after building the dedicated synthetic harness |
| `npm run test:release` | Release evidence validation; does not manufacture absent external qualification |

Use `npx playwright install chromium firefox webkit` to install the pinned browser versions. Linux runners also need browser system libraries (`npx playwright install --with-deps`). Browser installation is a one-time tool download; it is not part of ordinary `npm test`. Worker processes and platform suites should be limited on machines with insufficient memory.

Load fixtures require the exact owned local profile and synthetic accounts. They never establish paid-provider capacity. Report raw HTTP/transport failures, recovered effects and incomplete commands separately; do not turn a failed simultaneous burst into a PASS because a later recovery phase succeeds. Run native memory and browser performance measurements separately from deliberate backend stress.

## Read, run, then adapt

These are internal executable examples using the same schemas and ports as the application:

- [local-save.ts](../../tests/examples/local-save.ts) saves immutable project/checkpoint intents with stable caller-owned operation IDs.
- [offline-retry.ts](../../tests/examples/offline-retry.ts) retries the original command and hash after a lost response. It does not rewrite attempted payloads.
- [conflict.ts](../../tests/examples/conflict.ts) applies a reviewed cloud choice while retaining the device work as a recovered collection.
- [complete-export.ts](../../tests/examples/complete-export.ts) pins a local view and requires every referenced byte. Connected export uses the application's backup service to fetch missing bytes under a server snapshot lease.
- [webhook-reconciliation.ts](../../tests/examples/webhook-reconciliation.ts) reads the server's verified ledger projection. A provider callback or SDK success never grants local access directly.

The Node example suite exercises BrowserRepository with fake-indexeddb's transaction implementation. This is not browser-engine or native SQLite evidence. The first four functions accept the shared repository/media ports; native fixtures can invoke them without importing browser IDB code. Native parity must pass in the actual iOS and Android harnesses before an all-adapter claim. Provider verification and webhook authenticity are separately tested in actual server suites; the client example uses a deterministic server response.

## Reproduce failures safely

Use a dedicated profile and synthetic projects/media. Report the commit, OS/runtime versions, capability, command, safe error code/correlation ID, and the smallest synthetic reproduction. Include whether a save was locally durable, queued, or acknowledged. Never attach a real backup, authorization header, email OTP, recovery key, deletion receipt capability or raw provider log. Public issue creation and remote reporting are outside these commands.

CI separates Linux guest, isolated local backend, macOS iOS and Android jobs. Tests requiring credentials/provider accounts are separately qualified. Keep each job's result with its actual environment; warm automated timing does not replace the human cold-setup walkthrough.
