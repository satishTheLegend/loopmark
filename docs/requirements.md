# Release traceability

Scope source: [specification](specification.md), derived from the user's idea and delegated master prompt. Local research release, single maker, current browser. Status reflects tested acceptance, not market success or universal platform certification.

| ID | Origin / outcome | Priority | Acceptance and touchpoints | Dependencies / owner | Implementation | Test evidence | Status |
|---|---|---|---|---|---|---|---|
| R1 | Idea: several unfinished projects, master: complete flows | Must | Named project CRUD; validated fields; search/craft/status/sort; finish/reopen; confirmed permanent deletion | T2/T3; root + data worker | src/data.ts, App.tsx, Shelf.tsx, Forms.tsx | data tests stale mutations/capacity; browser complete journey, filters, lifecycle | VERIFIED |
| R2 | Idea: quick pause checkpoint | Must | Required next step; current tool/row prefill; immutable append; commit-only saved notice; reload persistence | R1; root + data | Forms.tsx, ProjectView.tsx, data.ts | browser create/capture/reload/history; concurrent tabs; finished capture guard unit | VERIFIED |
| R3 | Idea: immediately resume, reconstruct changes | Must | Latest next step primary; chronological history; missing QR recovery state | R2; root | ProjectView.tsx, App.tsx | latest after reload; history selection; sorted-import unit; missing local ID browser | VERIFIED |
| R4 | Idea: current photo, optional local voice | Must | Valid photos resized <=1600px; removal; local recording/playback, permission handling, 120s cap and cleanup | R2; root | media.ts, VoiceNote.tsx, Forms.tsx | browser image resize, audio capture/stop/remove/cleanup, denied permission, full-media restore | VERIFIED |
| R5 | Idea: full export/restore | Must | Versioned self-contained backup; strict validated preview; explicit replace; atomic rollback; cross-tab safety | R1/R2; data + root | data.ts, BackupView.tsx | 21 data cases incl malformed/duplicate/hostile media/rollback/tokens; browser full roundtrip and quota failure | VERIFIED |
| R6 | Idea optional label shortcut; included in release | Must | Readable bag label + same-origin QR; print styles; limitations explicit | R2/R5; root | BagLabel.tsx, App.tsx, styles.css | independently decoded QR exact URL; print emulation; missing-record browser | VERIFIED |
| R7 | Inferred offline-first architecture | Must | Production shell precached; offline reload and mutation; storage errors surfaced; manifest/icons prepared | R1–R5; root | main.tsx, build-sw.mjs, manifest, data.ts | browser offline reload/photo capture, blocked storage; no external runtime requests | VERIFIED |
| R8 | Master: complete responsive/accessibility/motion | Must | Empty/populated/error/pending/permission/offline states; 320/390/768/1440px; focus/keyboard; reduced motion; local original art | R1–R7; root + design, independent QA | components, styles.css, public/art | axe across 8 states; keyboard trap/restoration/mobile nav; screenshots; long title/reflow | VERIFIED |
| R9 | Master: evidence and reproducible delivery | Must | Lockfile, local startup/build, CI config, product/research/design/architecture/operations docs; independent judge | All; root + research + QA | README, docs, .github/workflows/ci.yml | build, format, unit/browser tests, dependency audit; docs/review.md | VERIFIED |

## Business acceptance that software testing cannot establish

The 15-person study (10 voluntary checkpoint users, 8 week-later resumers, 5 actual buyers) is **NOT RUN**. Proposed prices and three-free-project policy remain hypotheses. See product.md/research.md. There is no checkout stub, fake purchase or fabricated usage metric. The local app is intentionally unrestricted apart from safety capacity limits.

## Explicit scope decisions and boundaries

Browser web app selected over native stores and a cloud account service. Optional bag labels and voice are included. Native store builds, cloud sync, live checkout, reminders and collection/social features are excluded from this release. No server secrets/accounts are prerequisites. Physical-device audio/installation, physical printing and store acceptance cannot be inferred from browser simulation. CI is configured, not executed on a remote host. Unsaved dialog drafts are not persisted; save before closing. Future draft autosave is a backlog item.
