# Loopmark release specification · 2026-10-18

## Intent and delegated decisions
Help a maker with several unfinished projects leave enough information now to restart confidently later. The user supplied the pause/resume concept and delegated routine product, design and engineering decisions in the master prompt. This is an architectural new project. Spec/plan review proceeds under that delegation, without implying the user personally reviewed artifacts.

## Accepted release
Responsive local-first React web application, installable/offline after a successful production load. No account, server database, external analytics or payments. All project data remains in this browser's IndexedDB. Local downloads are explicit. New users start empty; sample projects are opt-in and visibly marked.

- R1: Create/edit a project with name (1–100 chars), craft, tool size (max 80), yarn (max 200), notes (max 2000), color. Assign a readable immutable code. Search names, code, craft, yarn; filter active/finished and craft. Finish/reopen and confirm permanent deletion.
- R2: Save immutable checkpoints with current row/repeat (max 100), tool size (max 80), required actionable next step (1–1000), optional notes (max 2000), one photo and one local voice note. Prefill latest position/tool. Save disables during pending operation; errors keep form open. A successful checkpoint is visible immediately and survives reload.
- R3: Resume opens latest checkpoint first with next step dominant; all prior checkpoints are available in newest-first history. No silent overwriting of history. Missing/deleted local QR records show a recovery explanation.
- R4: Photo from device upload/camera hint, decode and resize to <=1600px JPEG, max input 15 MB; invalid images rejected. Voice uses MediaRecorder when supported, explicit permission, 120-second cap, stop/delete/play and stream cleanup. Attachments included in backup. Permission denied or unsupported has a useful fallback.
- R5: Full versioned JSON download/restore, validates all imported records/media/IDs before writes, 50 MB file cap, destructive replacement requires a concrete confirmation, entire restore atomic, failure leaves prior state. No remote attachment URLs in imported data. Prevent lost writes across tabs via transactional per-project mutation; notify views of external changes.
- R6: Printable bag label includes readable project code/name/tool/position/next step and local-origin QR deep link. State same browser/site limitation. Accessible print-only rendering.
- R7: Offline shell, local fonts/assets, app manifest/icons. No network needed for core data workflows after production cache installed. Storage failures are visible; backup advice and persistent-storage request available.
- R8: Warm craft-focused design; desktop/tablet/mobile; empty, populated, no-results, validation/error, offline, missing record and storage failure states; keyboard dialogs with focus trap/restore, visible focus, named inputs, live status and reduced motion. WCAG 2.2 AA target; automated plus manual checks, no claim of certification.
- R9: Reproducible setup, lockfile, CI build/test/browser checks, source research/design/architecture docs, recovery/deployment runbook, independent review and evidence.

## Exclusions and business experiment
Native app/store packaging, cloud sync, accounts, live payments, three-project enforcement, pattern library, social feed and reminders are future scope. Pricing ₹299–₹599 / US$4.99–US$7.99 remains a hypothesis. Pilot 15 makers with >=4 unfinished projects; 10 voluntarily capture, 8 restart after >=7 days, 5 pay. No fabricated analytics or participants.

## Architecture contract v1
Owner root; src/types.ts authoritative. Project owns an ordered checkpoint array; IndexedDB transaction reads and mutates latest project. Each checkpoint immutable once saved. Root owns package/lock/config/types/styles/routes and integrations; workers own designated modules. No parallel editing of shared files. Same-origin browser storage is not an account or device sync. Media encoded as validated data URLs for self-contained backup. UTC ISO timestamps, local display.

## Screens and flow
Shelf → new project → project detail → pause checkpoint → saved state → later open detail → next step and history. Sidebar: projects, finished, backup & restore, guide. Dialogs: project editor, checkpoint capture, bag label, destructive confirmation. Search stays on shelf. Backup import is previewed before confirmation.

## Quality and boundaries
Production main JS target <200 KB gzip, CSS <30 KB gzip, no remote runtime requests. Browser tests at 1440/390px; responsive check 320px. All sources escaped by React; never render HTML from backups. Files cannot embed external URLs. No credentials. Browser storage can be cleared/evicted and private browsing is temporary. Mic requires localhost/HTTPS and device testing remains a separate constraint. Voice playback codec portability is not guaranteed across browsers. Backup privacy is explicit: downloaded files contain user media and notes.
