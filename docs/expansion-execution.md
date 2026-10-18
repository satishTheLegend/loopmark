# Expansion execution ledger

The user selected the recommended stack and explicitly delegated build-and-verify continuation. No additional routine approval gate applies. External service activation, charges, outreach, deployment and store submissions remain separate actions.

| Package | Current status | Evidence / next step |
| --- | --- | --- |
| P0 | VERIFIED | Foundation commit `59cefbd`; 33 unit,209 browser,4 isolated scale checks |
| P1 | COMPLETE | Plan commit `8353f23`; actual four-phase gstack pipeline,104 decisions,26 aggregated tasks,15 packages,46 test groups |
| I01 | VERIFIED for contract/config scope | 80 unit/config tests,43 Chromium cases,build/format/doctor/audit; independent corrections confirmed |
| I02 | IMPLEMENTED / INTEGRATING | Browser repository, old-writer migration fence, normalized media, atomic conflict recovery and collection/draft transition CAS. 53 focused repository/facade tests passed in the client lane; migration exercised across all five browser profiles. App startup migration wiring remains in I05/I09. |
| I03 | IMPLEMENTED / REVIEW FIXES IN PROGRESS | Actual isolated local PostgreSQL/Auth/Storage/Edge runtime; 16 SQL/HTTP/delivered-code tests passed after a clean reset. Independent review found media deduplication, byte-bounded snapshot paging, retention fairness and native CORS gaps; fixes and regressions remain open. See evidence/I03. |
| I04 | VERIFIED FOR IMPLEMENTED STORAGE SCOPE | iOS simulator and Android emulator: 13 actual persistence/adapter groups passed twice across process restarts. Android instrumentation 2/2; unsigned iOS and Android debug builds passed. Native signing/store/physical-device qualification remains I14. See evidence/native. |
| I05 | IN PROGRESS | Auth/HTTP boundary candidate integrated; account/collection controller, connection preview, links and deletion continuation remain under implementation. |
| I06 | IN PROGRESS | Metadata-only shelf, bounded selected-project media reads, strict portable export and immutable save plans integrated. Network coordinator, media admission/download and connected replacement callers remain. |
| I07–I08 | IN PROGRESS / DEPENDENT WORK | Backend media/replacement/deletion and provider purchase authority follow reviewed I03. No live checkout or store transaction has been performed. |
| I09 | IN PROGRESS | Static public privacy/support/deletion pages passed 35 public-page/draft browser checks; account/collection/sync/conflict/sign-out components and app wiring are being integrated. These screens are not yet end-to-end qualified. |
| I10 | IN PROGRESS | Native persistence complete for current ports; capture/share/lifecycle/purchase adapters underway. |
| I11–I13 | PLANNED | Preserve operations, contributor workflow, adversarial/load/compatibility verification and independent final judge in expansion-implementation.md. |
| I14 | EXTERNAL QUALIFICATION PENDING | Actual provider accounts/products, devices,signing and sandbox transactions |
| I15 | PLANNED / EXTERNAL ACTIVATION PENDING | Prepare research/release artifacts; actual funding/cohort/release authorization remains external |

Implementation lives on `expansion/integration` in `../loopmark-expansion-integration`; the original `loopmark` folder retains the verified foundation while work integrates. Worktrunk v0.80.0 lacks its newer reference's `--path`; per-invocation `--config-set worktree-path` worked without changing global configuration. The integration dev app uses port 39500; browser regression uses 4181 and refuses an existing server. Each worker gets its own derived profile, database and output paths. Shared files/package locks stay root-owned.

The Capacitor CLI's xcode dependency pulled uuid7 with a moderate advisory. Its only UUID call uses v4; a scoped npm override pins the compatible CommonJS-capable patched uuid11.1.1. The actual xcode UUID path passed a 1000-ID check and npm audit reports zero known vulnerabilities. Native generation/build will further verify the integration. No forced audit downgrade or global package change was made.

Supabase CLI setup follows its [official local development documentation](https://supabase.com/docs/guides/local-development/cli/getting-started). Every invocation uses SUPABASE_TELEMETRY_DISABLED=1 and DO_NOT_TRACK=1; no global telemetry preference or account was changed. Dependencies are project-local and locked. No real backend, merchant or store project has been created.
