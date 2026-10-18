# Versions, migration and rollback

These version numbers describe different boundaries and must not be conflated:

| Boundary | Current value | Compatibility rule |
| --- | --- | --- |
| Sync command protocol | 2 | Unsupported envelopes fail safely; no best-effort write interpretation |
| Command payload | 1 | Canonical immutable payload/hash survives retries |
| Portable JSON backup | 1 | Read existing complete v1 files; export complete compact v1 with inline media |
| Browser normalized DB | `loopmark-v2`, IDB schema 1 | Independent of wire and SQL migration numbering |
| Legacy browser DB | `loopmark` and `loopmark-drafts` | Copy and verify before selecting normalized storage; leave source content intact |
| Native SQLite / server SQL | Ordered committed migrations | Use their migration ledger, not the wire version, as the applied-schema authority |

Portable files contain projects and checkpoint history, not account ownership, paid grants, outbox commands, credentials or recovery capabilities. Limits remain 200 projects, 1,000 checkpoints per project, 48 MiB summed serialized project objects, and less than 50 MiB for the complete compact file. An older over-free-cap local import remains readable/exportable; it does not create a paid entitlement.

Browser migration freezes legacy writers at an IDB upgrade barrier based on the actual current version, including a deliberate absent-source fence. Original presence is durably recorded so an empty fence database cannot become a legacy entitlement. Copy verification checks source revision/counts/media hashes and drafts; selection happens only after a durable receipt and complete scope CAS. Blocked upgrades, corruption or late source changes keep the original selection and expose the read-only fallback. Do not delete legacy sources as a repair step.

If the first normalized selection is interrupted, restart with the same guest collection key and migration token. Existing active scope wins only after its view validates. Keep old records/drafts during collection epoch replacement, and select the new epoch only after validating the receipt plus contiguous snapshot pages. A missing page, wrong identity or stale generation must not expose an empty replacement.

Before shipping a schema change, run current (N) and prior-supported (N−1) fixtures, complete backup round trips, interrupted migrations and old-client refusal. The current backup N−1 fixture is the original v1 producer with unchanged portable format; protocol-1 writes are intentionally unsupported. Native/SQL rollback requires a proven migration/restore procedure; do not downgrade an application over a newer DB and assume compatibility. Preserve a complete export first and use the [release qualification record](../release/qualification.md) for the measured combination.

Server disaster recovery must reconcile the independent erasure ledger before serving restored data. A database snapshot alone must never resurrect a deleted account. Follow the server runbooks and qualification tests; local reset is not a production rollback procedure.
