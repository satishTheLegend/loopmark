# Runtime startup readiness regression

Candidate `c0e9bddd769a10021a641e002e54ec779f006333` passes 382 source unit tests with no skips and TypeScript checking. Nine scheduler regressions use the real controller, coordinator and IndexedDB repository, with controlled local recovery and fake timers only.

`red.raw.json` is the unmodified targeted Vitest report for the pre-fix scheduling behavior. Authentication is already published when the initial timer fires; local resume remains blocked. After releasing it and verifying the controller has settled, no pull happens at the next 150 ms opportunity. The seven non-selected tests in that targeted run are reported as pending, not as passes. `reentrant-red.raw.json` separately preserves the candidate-review failure where a synchronous subscriber overtook queue admission. The final `green.raw.json` is an unmodified full source-suite report.

The controller now publishes queued-transition readiness after establishing admission order and clears it only after the final queued task settles. The scheduler observes that edge and checks foreground, connectivity, disposal, authentication, selection, and fatal errors before starting. The existing immediate `runSync` scope/generation guard remains in place. Realtime channel eligibility is unchanged.

The original mobile WebKit trace verifies the session and then shows no pull during its assertion interval. Read-only SQL confirms its expired-cursor fixture was valid. That trace is consistent with the reproduced defect, but it does not expose the internal busy or timer state; exact original timing attribution is not proven. Root owns fresh browser/native qualification of the final assembled product.

The exact source and report hashes are in `report.json`, `red-source.json`, and `reentrant-red-source.json`. No backend service, database, browser session or native runtime was changed for this probe.
