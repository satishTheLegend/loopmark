# Sync completion announcement regression (T33 / IR27)

The rendered status must announce overall completion once after a pending cycle, even when acknowledgements empty the visible queue before the final account pull finishes. The completion marker belongs to the full selected session scope.

## Controlled sequence and source binding

The fixture uses the real `summarizeSync` and `SyncStatus` with explicit component events. It exercises pending (one item) → syncing (zero items) → checking (zero items) → confirmed current. This is rendered-component evidence, not an actual cloud transaction.

- `red.log` and `red.json`: the pre-fix component reached visible “Synced to your account” but its polite live region was empty. The assertion failed at that exact boundary. Production component/caller hashes and fixture hashes are retained; `red-fixture.patch` reconstructs the controlled fixture against the recorded base commit. The raw trace hash is retained; the local raw trace is `.gstack/t33-red.zip` in the client worktree.
- `green.log` and `green.json`: final candidate `8bfd398f90507454b337708415f92ff172c4eeb8`, 10/10 passes across Chromium, Firefox, WebKit and both emulated mobile profiles, one worker, no retries. The completion sequence, three repeated current publications, three further checking/current polls, and all six individual scope fields are checked. A scope change cannot inherit the old completion marker. Existing actionable failure announcements remain covered by the second selected title.
- The actual App keys `SyncStatus` by `canonicalJson(state.scope)`, covering namespace, collection, epoch, local generation, device ID and device generation. The component remembers an observed pending cycle through empty working/checking states and consumes it once on confirmed current.
- `verification.json` records successful typecheck, targeted formatting and whitespace checks. Those command outcomes came from tool results; no separate raw command log was captured.

## Preserved unsuccessful setup attempts

`fixture-error-red.*` failed before the completion boundary because the new fixture supplied `syncState: syncing` without the actual caller’s `working: true`. That setup error is not product failure evidence. It was corrected before the controlled red run above.

`focus-fixture-green.*` retains the first candidate attempt: 8 passed, 2 failed. Both WebKit profiles stopped at the earlier focus assertion because the pointer click left the pre-focused button inactive. The fixture now triggers that focus-preservation check with keyboard Enter after explicit focus. The focus assertion and completion assertions remain present. The final 10-case pass follows that test-only correction. Raw trace hashes are retained for both failures.

The isolated worktree shares dependencies by symlink. Vite rejected optional font asset paths outside its serving allow-list; those warnings remain in all stdout logs. This evidence asserts state labels, keyboard focus and live-region DOM mutations, not typography, layout, assistive-technology speech output or provider/network behavior. No retry, delayed assertion, or relaxed completion expectation was added.
