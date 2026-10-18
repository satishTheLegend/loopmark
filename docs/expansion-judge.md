# Independent expansion judgment — provisional

Review date: 18 October 2026. Reviewer: `final_traceability_review`, independent of implementation authors. The implementation and runtime evidence are still changing. This is a source/requirements review and handoff, **not a final PASS**.

The complete accepted inventory is in [requirements.json](evidence/expansion/requirements.json): 123 IDs comprising R1–R9, X01–X10, C00–C23, D01–D12, DX01–DX08, E01–E14 and T01–T46. It preserves the accepted branch wording, actual source paths, exact present test names, file hashes, historical proof paths and limitations. Branches are deliberately pending final adjudication; the current group associations must be narrowed to the actual asserting tests and matched to frozen execution evidence before closure. Missing planned paths are marked absent rather than credited. Historical foundation and intermediate candidate results do not qualify the final source.

## Actionable local findings

**IR08 — T13 same-epoch rebase recovery is incomplete.** The server correctly returns `SYNC_REBASE_REQUIRED` after receipt/feed compaction or device retirement. The client coordinator throws, runtime stops automatic polling, and bundled help instructs the maker to preserve recovered work and refresh. Inspection did not find a complete explicit action which retains saved pending work/drafts/media, refreshes the server device identity, resets stale hydration/cursor state, and fetches current authoritative content. Refreshing authentication with the same collection epoch leaves the old ready cursor in place. Root independently confirmed the likely gap and is assigning implementation. Closure requires actual recovery with stale cursor and retired device, pending local work preserved, fresh reader consistency, interruption/failure preservation and no rewrite/replay of stale immutable commands.

**IR09 — T03 expired-code and server resend-response assertions were absent.** Root has implemented the closure candidate in `cc19c17`. Twelve auth unit cases pass, including expired OTP, resend 429 and verify 429 without registering an account. Two actual App tests in `tests/expansion/auth-errors.cloud.ts` exercise an expired delivered local Auth code followed by a fresh code, and reload followed by real resend throttling. Their execution and final-source qualification are pending; no remaining source defect is alleged by this finding.

**IR04 remains open until the final matrix is adjudicated.** The inventory now exists, but named assertions, branch adequacy and executed proof must be matched individually. A provisional inventory or passing total does not meet the final traceability requirement. In particular, T20/T28/T39/T41/T43/T44 operations/load/retention work is still owned by the backend worker, while native memory/performance and final production bundle qualification are still owned by the native worker.

The earlier [initial report](evidence/expansion/independent-initial-review.md) remains a historical record. IR01 diagnostics, IR02 safe-error support metadata, IR03 missing-media export retry, IR06 actual product conflict wiring and IR07 durable project-link continuation have implementation/test candidates. Their exact final closure is deferred to the frozen review; IR06 now includes a stale open review in the authored test, whereas its earlier passing run did not include that branch.

## Separate external gates

No provider account or fixture establishes a real purchase, store restore, merchant eligibility, signed distribution, signed native domain association or store acceptance. Native simulator/emulator tests do not establish physical VoiceOver/TalkBack, camera/HEIC/orientation fidelity, iOS successful recording, OS transfer/reinstall or physical power-loss behavior. Automated contributor timing does not establish the human cold-start target. The consented 15-person pilot and its 10/8/5 real outcomes have not run. Funding and release authorization remain separate from technical test results.

Native deletion receipt capabilities currently use app-private, OS-backup-excluded SQLite; they are not claimed to be hardware-vault encrypted. No fresh-device receipt-file import flow is implemented or claimed. The independent local erasure ledger is a different service/volume on the same physical host; this is not physical disaster-storage qualification.

## Provisional decision

**NOT READY for final complete-local-scope approval.** IR08 and current pending local evidence must close. External qualification is **BLOCKED / NOT RUN**, independently of that local judgment. Resume this independent review after integration freezes source and records matching browser, backend, native, operations/load, compatibility and release-check evidence. No tests or builds were run by this reviewer during the exclusive native performance window.
