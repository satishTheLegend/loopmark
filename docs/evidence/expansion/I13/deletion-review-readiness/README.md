# Deletion review readiness

The original WebKit-mobile deletion-remove test passed a “Synced” text check at 8.124s, before the new project push began at 8.441s. Its next snapshot already showed “1 item waiting to sync.” The review opened by 8.583s. A real pull then applied that project's exact receipt and advanced cursor 0 → 1 at 8.605–8.636s. The unchanged empty pull at 8.934–8.994s was a separate no-op.

Deletion was safely refused with `REVISION_CONFLICT`. No deletion or reauthentication HTTP request occurred. The review remained open with its re-review action. This is a fixture readiness error; changing the review CAS or suppressing real cursor progress would be incorrect. The trace does not prove that the old assertion matched a stale live announcement rather than the previous visible current state.

[The bounded extraction](original-trace-proof.json) contains the original trace SHA256, selected UI timing, cursor transitions, and request counts. It excludes account identities, OTPs, operation IDs, project IDs, craft data and tokens.

## Controlled readiness oracle

The fixture holds only the named project's real `project.create` request. Before release it requires the visible status label to show waiting or working, so an earlier empty-account “Synced” render cannot pass. It registers response observations before releasing the request, then requires:

- A successful response for that exact operation ID.
- A pull for the same collection and epoch containing the exact push receipt.
- A resulting cursor at or beyond that receipt's cursor.
- The visible status label returning to exactly “Synced to your account.”

The deletion-remove journey captures its review after this barrier. The retain-copy journey deliberately captures its review while the push remains held, then crosses the same barrier: its existing stale-review rejection, explicit re-review, cleared confirmation, disabled action, subsequent deletion, receipt export, and retained-copy assertions are preserved. The third account connection journey has no equivalent initial status assumption and is unchanged.

No delay, retry policy, product logic, review CAS, authentication throttle wait, or destructive assertion changed. Only the account test file and this evidence were edited. The actual path is `tests/expansion/accounts.cloud.ts`.

## Verification

Prettier and `git diff --check` pass. No browser, test, build or service was run in this lane. Root will run the three account journeys plus the project-link journey across five profiles (20 cases), including the original failing WebKit-mobile deletion case. This record makes no runtime-pass claim.
