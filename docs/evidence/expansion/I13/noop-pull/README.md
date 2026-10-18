# Unchanged sync polls preserve device review

A valid empty background pull changed the local collection revision even though its cursor and records were unchanged. Deletion review therefore failed with `REVISION_CONFLICT` before sending any deletion request. The final UI retained the account and its draft, so no deletion or data loss occurred.

The sanitized [original cloud trace extraction](red-cloud-proof.json) binds to the raw trace SHA-256 and records the review click, subsequent empty unchanged-cursor pull, delete click, and failed receipt assertion. It excludes email addresses, verification codes, account/device identifiers, private content, request headers, and full response bodies. The original matrix was intentionally stopped after confirmed defects; this is not a completed matrix result.

Fix commit `0b518fa` shares page validation and mutation semantics between IndexedDB and SQLite. It retains schema, scope/generation, collection, epoch, and current-cursor checks. A valid empty page with an unchanged cursor skips the collection write, revision increment, and subscriber publication. Nonempty receipt application and real cursor progress still change the review revision. The controller's deletion and draft CAS checks remain unchanged.

The controlled old-source run failed in exactly two new regressions: the empty poll changed revision `1` to `2`, and deletion with an explicitly reviewed draft failed before its barrier callback. The remaining 24 tests passed. With the fix, **69 tests passed across five files**, and TypeScript checking exited successfully. [metadata.json](metadata.json) records exact commands, source blobs, output hashes, and the pre-format red-test-source limitation.

- [red.stdout.log](red.stdout.log): actual failing regression output.
- [green.stdout.log](green.stdout.log): actual focused passing output.
- [typecheck.stdout.log](typecheck.stdout.log): successful compiler output (empty by design).

Regression coverage includes unchanged records/pending intents/drafts, no subscriber notification for a no-op, successful reviewed deletion after an empty poll, preservation of separate guest work, wrong collection/epoch/cursor/generation rejection, malformed empty progress rejection, guest rejection, and review invalidation by a real receipt or cursor advancement after an already acknowledged receipt. Existing draft-after-review and scope transition tests remain in the green suite.

Actual cloud rerun and native SQLite/runtime evidence are coordinated separately by their owners and are not claimed by this evidence package.
