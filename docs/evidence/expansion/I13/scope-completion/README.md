# Obsolete sync completion cannot replace the selected collection

The preserved cloud traces show two different outcomes after a deliberate Account projects → Personal projects selection while hydration completes. Chromium mobile ends on the fatal account-changed screen; WebKit's purchase flow keeps displaying the old account collection after the picker closes. In both cases the old snapshot cleanup overlaps the selection. The old controller unconditionally refreshed the captured account scope after the cancelled coordinator resolved. That refresh either reported a fatal mismatch after selection, or incremented the refresh version while the new selection's refresh was still running.

[cloud-traces.json](cloud-traces.json) contains bounded timing evidence and hashes of the original traces. The separate conflict trace captures an early review before its authoritative pull finishes, followed by the visible stale-review alert. That third case is a fixture ordering issue: its frozen review must be explicitly refreshed. The root agent owns its test correction; this product fix does not auto-rewrite reviews.

Commit `3a71ace` checks the complete SessionScope, transition ownership, disposal, and refresh version before obsolete work can increment the version, cancel work, publish state, or surface errors. It rechecks after storage awaits. Serial selection refresh remains authoritative, and a genuine durable mismatch for the currently selected scope still fails closed. The same checks cover sync, operation retry, attachment retry, the initial repository read, an A → B → A selection, and older failing refreshes within the same scope.

The coordinator also rechecks scope/cancellation after initial/final metadata reads and after error-path attachment reads. A stopped cycle cannot publish its old counts or error into the new selection. Ordinary current-scope errors remain reportable.

Controlled old-source results: **11 controller regressions failed**, with 22 passes; **all 4 new coordinator regressions failed**, with 7 passes. Fixed results: **48 focused tests passed**, then **371 tests passed across 46 files**, and TypeScript checking passed. Exact commands, source hashes, output hashes, and red-source limitations are in [metadata.json](metadata.json). Log files preserve actual redirected output with only the absolute repository path replaced.

This package does not claim a new cloud matrix or native qualification. Those follow after independent review and integration.
