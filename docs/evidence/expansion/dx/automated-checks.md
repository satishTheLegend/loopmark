# Automated contributor checks, 2026-10-18

The client candidate was checked in its isolated worktree, then assembled with the integration checkout's read-only source/configuration and backend guard `ff725cf` in a temporary local directory. No backend was started, reset, migrated or stopped.

- Four executable example tests passed: durable save/reopen with exact photo export; immutable retry after lost response; conflict recovery with stale-review refusal; verified entitlement followed by refund.
- TypeScript checking passed.
- Ten developer documents passed script-name, configuration-name and local-file-link validation against the assembled integration package.
- Nine DX checks passed with zero skipped tests: production bundle secret exclusion; validator negative cases; missing Docker/provider prerequisites; occupied port preservation; wrong project/readiness; wrong reset confirmation; remote operator URL refusal; remote Docker override refusal; remote active Docker context refusal.

The bundle check used generated synthetic secret sentinels and scanned emitted assets. Launcher tests copied the real launcher into a temporary workspace and used a recording fake Docker executable. Those tests exercise refusal paths without risking a real database.

This is automated local evidence with installed dependencies, not a clean `npm ci` or human walkthrough. The integrated commit must rerun the commands. Actual browser engines, native bridges, real providers and physical devices retain their separate qualification records. Cold human setup timing remains unmeasured in [the evidence index](README.md).
