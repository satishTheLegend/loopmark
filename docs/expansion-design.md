# Expansion interaction specification

Planning artifact, 18 October 2026. Applies to X01–X10 after final plan review. It preserves the existing quiet-workbasket direction and changes no shipped screen yet. `design-system/loopmark/MASTER.md` remains the source of palette, type family, geometry and motion; additions below specify expanded behavior. No generated mockup is approved: the actual designer attempt failed with no API key, zero images and no provider request.

## Screen hierarchy and navigation

The three things a returning maker needs are the latest next step, tool/position, and Save checkpoint. Cloud administration must not displace them. A project shelf card earns its container as a distinct resumable project; account and sync settings use sections and rows, not a second dashboard of cards.

```text
Wide (>= 950 px)                          Compact (< 950 px)
226px existing nav | project workspace   brand + labeled navigation
Projects          | collection name     collection name / On this device or account
Finished          | project title       project title
Backup & restore  | NEXT STEP | photo    NEXT STEP
How it works      | tool, row | audio    tool, row
Account & device  | Save checkpoint      Save checkpoint
                  | saved here; details photo / audio
                  | earlier checkpoints saved here; details; earlier checkpoints

Account & device
├── Collection selection and connection
├── Sync details / offline availability / conflicts
├── Upgrade status / restore purchases / pending attempt
├── Local storage / cloud quota (separate quantities)
├── Privacy / support / delete account
└── Sign out and keep/remove device copy

Link -> cached authorized project OR sign-in continuation -> ownership check -> Resume
Deletion receipt -> narrowly scoped status page (independent of a live account session)
```

Collection identity is a persistent one-line heading above the shelf or below project title: `Personal projects · On this device`, `Personal projects · <account email>`, `Kept from <account email> · On this device`, or `Recovered after restore · <date> · On this device`. A labeled Change collection control opens a list with record counts and local/connected state; it does not transfer records. A single remembered selection is scoped by device and account. Guest remains selected after login until the user chooses an existing account collection or confirms attaching local work. Sign-out selects the retained local collection when kept; otherwise it selects the guest collection. Replacement selects the new connected epoch; old pending work appears as a named recovered local collection. Drafts stay bound to their source collection/project and show that destination before resuming. Switching with an open draft triggers Save draft and switch / Keep editing, not implicit submission to the new destination.

## Connection, conflict and recovery decisions

Connection preview names the destination email, source collection, additions, exact matches, separately copied collision records, resulting active and total counts, current cloud usage and capacity consequence. Same ID plus same canonical content is a match; divergent content is copied under a fresh ID and labeled `<name> (copy from this device)` with readable-code mapping retained. Imported over-cap content stays readable/exportable; create/reopen and cloud admission rules are explicit. If the preview exceeds technical capacity, connect does not partially upload or discard the source. Choose fewer records in a later explicit preview or remain local. Confirm is bound to source revision and destination revision/epoch; changes require a fresh preview. Interrupted connection resumes the same operation with source preserved and displays Retry connection. Completion names the chosen collection and offers Open projects.

Conflict review shows `This device` and `Cloud`, each with observed time described as informational. Highlight changed fields; a Show unchanged fields disclosure exposes the full record. Desktop is two columns, compact screens stack labeled versions. Actions are Keep this device's changes, Use cloud version, Edit a merged version, and Decide later. Nothing is preselected. The merge editor starts from an explicit chosen baseline, marks changed fields, and submits against the latest server revision; it cannot edit an immutable checkpoint in place. Both checkpoint versions remain separate history entries. A conflict that changes while open disables commit, shows New changes arrived, and requires refresh/review. A deletion conflict offers Keep a local recovered copy before accepting deletion; this is not silent server resurrection. Closing restores focus to the originating row and leaves the conflict pending.

Before removing a local copy, show separate counts for unsent checkpoints, failed or pending attachments, drafts, and recovered collections. `Keep on this device` is the safe default; `Create complete backup` is available and truthfully reports missing cloud bytes. `Remove device copy` explains that synced records remain in the account, and requires a separate `Discard <N> items only on this device` confirmation when any unique work exists. Cancel returns without loss. A failed export never unlocks removal automatically. Account deletion similarly offers explicit retain/remove local-copy choice before disabling access. Retained data is a disconnected collection, cannot silently upload to another account, and remains discoverable through Change collection.

## Status vocabulary and priority

Local durability is always separate from cloud state. `Saved on this device` appears only after the local transaction/file commit. `Not saved — try again` retains the draft. Cloud acknowledgement says `Synced to your account`; this is not a claim that another device downloaded the attachments. A project earns `Available offline on this device` only when its current metadata plus every referenced photo/audio byte are locally verified and pinned for the selected offline set. The text describes the current device, not all devices. Missing downloads render a stable photo/audio placeholder with Download, bytes/progress when known, Retry on failure, and `Connect to download this photo/voice note` while offline. First account pull says `Loading your projects` until its initial consistent snapshot completes; it must not flash the empty-shelf invitation.

Independent cloud indicator priority: account disabled/deleting → sign-in required → conflict → quota reached → failed attachment/operation → offline with waiting items → working → current. This precedence selects the short label only; Sync details always lists every category with item count, oldest pending age and appropriate retry/sign-in/review action. Failed and waiting states are static text plus Tabler icon, not pulsing dots. Progress changes use visible text; polite announcements occur on local-save completion, a newly actionable category, and overall completion, never each retry or each media byte. Focus does not move for background updates. `Retry all transient failures` excludes conflicts, invalid files, quota and authentication.

## Upgrade and purchase continuation

The fourth-project/reopen gate preserves the original operation and draft in a durable purchase continuation keyed by collection and account generation. Explain the three-active-project free cap and that the one-time upgrade unlocks more active projects within the same technical storage envelope. Existing projects, all history and exports remain accessible. The gate offers See upgrade and Keep using my projects; it does not create a purchase automatically. After login the user reviews account and localized server/store price; no external checkout link appears in native storefronts by default. Cancellation returns to the preserved draft/context. Delayed verification shows `Payment received; checking upgrade` or provider-specific pending approval, allows normal notebook use, and remains discoverable under Upgrade status. Only authoritative entitlement enables `Continue creating <project name>` or `Reopen <project name>`; do not silently save a project or charge again. App restart restores this continuation. Wrong-account or store mismatch offers sign-in/support/restore without transfer of data or receipt ownership. Restore purchases is adjacent to status and remains available after reinstall.

Quota rows separate active-project access, total project count (200), checkpoints (1,000), serialized portable data (48 MiB) and provider object bytes. The blocking message names the limiting quantity and affected pending items. An upgrade is not suggested for technical quota. Remove downloaded copies frees device space only, preserves cloud records and resets offline-ready status. Delete project explains removal across connected devices and requires a named confirmation; export is offered first. Cloud enrollment paused by budget has a distinct explanation and keeps current local work usable.

## Account deletion receipt and public pages

After recent authentication and explicit consequence confirmation, persist a random one-time display/downloadable receipt before revoking the account session. The receipt has a request timestamp, public redacted support reference and a separate high-entropy read-only status token. Do not put the token in analytics, referrers, logs or a shareable public project URL. The receipt status page survives app restart and account deletion, is rate-limited and returns only pending/completed/needs-help and request time; it exposes no email, project or payment information. Store the token in protected device storage and offer a text download to the user. A lost token requires the documented support verification process; do not offer account enumeration. Completion records the chosen device-copy outcome and retention explanation for legally required payment records. Repeated requests return the existing receipt without starting duplicate jobs. The exact retention/security boundary is an engineering contract, not a public project page.

Public `/privacy`, `/support` and `/delete-account` explain the actual service and deletion request method without exposing private data. The authenticated application and receipt/status routes remain noindex; route authorization is enforced separately. Guest copy says no cloud upload. Connected copy states the account destination, private cloud storage and actual local/cloud state. Update README, Guide, media permission helpers, Backup & restore, labels, privacy, support, store disclosures and screenshots together. Avoid the unqualified existing `No media is uploaded` claim once connected mode exists. Neither a label nor sync is called a backup; exports contain private notes/media.

## Visible-state matrix

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Account code | Sending/verifying, disabled repeat button | Email label and Continue; guest action remains | Invalid/expired code at field; resend timer on rate limit | Account identified; source collection still selected | Signed in, collection not connected; choose next action |
| Collection list | Reserved rows, Loading your collections | On this device with Create project | Retry without replacing visible cached list | Name, destination, counts and selected mark | Cached collections available, uncached marked Connect |
| Connection preview | Checking both collections | 0 additions explicitly, no fake data | Changed data / quota explanation; refresh preview | Final result counts and Open projects | Interrupted; source intact and Retry connection |
| Local save | Saving on this device | New checkpoint hints | Not saved, retained values, retry | Saved on this device then latest slip | Text committed, optional media preparation still described accurately |
| Sync | Working count and static status | Nothing waiting | Highest-priority label and grouped remedies | Synced to account with last confirmed time | Text synced, photo/audio pending; inspect each |
| Attachment download | Reserved media box, progress if known | No attachment; Add photo/voice only in capture | Retry specific item, no whole-checkpoint failure | Photo/playback with verified local bytes | Offline missing byte placeholder; text still available |
| Conflict | Fetching current version | No conflicts | New changes arrived; review again | Selected/merged record saved and pending sync status | Decide later keeps both values pending |
| Upgrade/checkout | Loading actual price / verifying attempt | Product not available; keep using projects | Cancellation, failure or mismatch with remedy | Verified upgrade and explicit Continue original task | Pending approval; status page, no repeated charge |
| Restore purchases | Checking store/account | No purchase found and account explanation | Wrong account/store help; verified recovery case with lost-key support and no automatic transfer | Verified access, records unchanged | Provider unavailable; existing offline verified access retained |
| Complete export | Counting, downloading N/M, writing file | Valid empty export explained | Missing bytes / insufficient space; Retry | Complete verified file; export time | No full-backup success; missing item list and resume |
| Replace collection | Validating then applying | Preview says 0 projects and removal effect | Stale preview reopens with new counts; old library intact | New epoch selected, prior pending work recoverable | Recovery collection clearly listed after interrupted rebase |
| Sign-out/remove | Preparing chosen copy disposition | No pending local-only work | Removal failed; copy retained | Retained local collection selected or guest | Unique-work counts require explicit discard |
| Account delete | Disabling, then deleting | No owned records still yields receipt | Needs help with redacted support reference | Live data removed; completion follows disclosed backup expiry | Cloud disabled while object purge pending |
| QR/deep link | Checking authorized project / login continuation | Generic unavailable, no record metadata | Invalid link or reconnect help | Matching latest checkpoint | Cached project opens offline; missing media separately marked |

| Cloud usage | Loading confirmed usage and pending reservations | Zero usage with current limits | Usage unavailable; preserve local save and explain retry | Separate active access, total records, serialized bytes and device downloads | Pending uploads or budget enrollment pause have distinct counts/remedies |
| Deletion receipt | Reading protected request status | No token: explain verified support recovery without account disclosure | Expired/invalid token or needs-help; no private metadata | Live-data-removed with expiry, then complete; local-copy outcome remains visible | Pending purge/backup expiry; restart and lost-response recovery retain status |

## Journey storyboard

| Step | Maker does | Likely feeling | Specific support |
|---|---|---|---|
| 1 | Opens a paused project | Uncertain | Next instruction, tool and row first; no setup barrier |
| 2 | Adds a checkpoint | Busy, wants to stop | Prefilled tool/row, single next-step field, optional media |
| 3 | Saves while offline | Wants reassurance | Durable local-save statement independent of cloud |
| 4 | Chooses cross-device connection | Cautious | Named account and exact-result preview; source preserved |
| 5 | Opens another device | Expects familiarity | Same collection/name; loading distinct from empty; media availability honest |
| 6 | Encounters a conflict | Worries about lost work | Full labeled alternatives, nothing preselected, Decide later |
| 7 | Needs a fourth active project | Evaluates value | Clear one-time cap benefit; purchase preserves unfinished task |
| 8 | Returns a week later via bag label | Wants confidence | Authorized cached/latest record with next step foremost |
| 9 | Leaves service or changes account | Wants control | Complete export, unique-work counts, retained collection and deletion receipt |

Five seconds: the maker can identify the project and next action. Five minutes: create/save/resume and optional account connection work without a tour. Five years: old exports and readable labels still recover meaningful instructions, purchase/refund does not hide history, and account deletion is comprehensible. These are product design goals; cohort research must measure them.

## Tokens, responsive rules and accessibility

Preserve Lora headings, DM Sans interface, `--canvas`, `--surface`, `--ink`, `--clay`, `--sage-soft`, `--danger`, `--focus`, established 5–13px geometry and 120–220ms action/dialog motion. New account, conflict, purchase, destructive and recovery screens use 16 px minimum essential body/form text, 1.5 line height and at least 44 px touch hit areas including icon buttons; integrate an expanded readable-control variant without falsely claiming the old compact desktop labels already meet these sizes. Main heading remains 29–34px; latest next step 20–21px. Keep text contrast at least 4.5:1 and control/focus boundaries3:1. No new font, decorative shadow system, gradient, carousel or motion runtime. Tabler cloud/check/wifi-off/alert-triangle/arrows-exchange/credit-card/logout/trash icons are candidates; verify actual installed exports before use. Text names and status words remain primary.

At320/390 px: one column, stack version comparisons, wrap collection/account names, sticky action only when it does not cover content or keyboard, 20px side gutters; native safe-area inset pads top/bottom. At768 px: content and secondary detail remain one column unless there is at least320px per comparison column. At950 px+: existing sidebar/detail pattern, conflict two columns and max70ch explanatory text. A native bottom navigation redesign is not required; reuse labeled compact navigation and test platform Back/gesture semantics. Forms scroll to visible errors above software keyboard; focus is never trapped behind native browser sign-in, share sheet or purchase sheet. Dialog close/Escape/back restores focus; destructive dialogs default to Cancel. Back from external auth continues the original route only after session and ownership checks.

Verify keyboard-only operation, VoiceOver on iOS and TalkBack on Android, 200% text scale, 320px reflow, reduced motion, long localized prices/emails/titles, screen-reader announcements, native system text settings, denied permissions, landscape, safe areas and interrupted app lifecycle. Persist readable name/code on printed labels, black-on-white ink and QR quiet zone. Theme new focus/selection/caret/visited-link states from palette; do not hide scrollbar or selection affordances. Rendered checks and physical-device evidence are required after implementation; a textual plan is not proof of accessibility or pixel quality.

## Implementation and verification ownership

Design work changes `src/components/AccountView.tsx`, `CollectionPicker.tsx`, `SyncStatus.tsx`, `SyncDetails.tsx`, `ConflictReview.tsx`, `UpgradeView.tsx`, `AccountDeletion.tsx`, existing `Forms.tsx`, `BackupView.tsx`, `Guide.tsx`, `BagLabel.tsx`, shell/styles, design-system additions and public policy pages. Tests add exact labels/states, collection/draft continuity, missing media, destructive-copy counts, stale conflicts, login/payment return, quota specificity, deleted-session receipt and mode-dependent privacy assertions. Browser QA captures320/390/768/1440 px plus keyboard/reduced-motion/axe checks; native tests cover system sheets, Back, text scaling and screen readers on real devices. No test is counted as passing until implemented and executed.
