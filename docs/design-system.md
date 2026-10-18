# Loopmark: design and interaction specification

**Date:** 18 October 2026. **Scope:** the accepted local-first web release in [specification.md](specification.md). **Authority:** [design-system/loopmark/MASTER.md](../design-system/loopmark/MASTER.md) contains final tokens and visual rules; this document contains decisions, screens, motion, and provenance. Routine design choices are delegated by the user’s master prompt; this is an agent-reviewed design, not a claim of direct user approval.

## The job and design decision

A maker has several unfinished projects and wants to resume without decoding weeks-old memory. The interface should make leaving a useful note feel small and coming back feel welcoming. The measurable product hypothesis is repeat voluntary checkpoint capture and later successful restart, not time spent in the app.

| Direction | Composition and character | Fit and tradeoff | Decision |
|---|---|---|---|
| The quiet workbasket | Oatmeal canvas, walnut ink, clay actions, sage notes. Serif project names, sans controls. Open shelf, original textile illustrations, paper-like next-step card. | Fits hands-on craft and an unhurried return. Texture remains decorative so the app stays crisp and quick. | Selected |
| The stitch notebook | Ivory pages, ink blue, ruled separators, compact handwritten-style annotations, chronological notebook. | Strong memory metaphor and dense history, but handwriting and rules can make short instructions harder to scan. | Keep its clear timeline; reject handwriting |
| The modern notions box | Pale gray, coral/cobalt, rounded geometric tiles, bold sans typography, punchy color-coded projects. | Efficient and cheerful, but a dense board risks recreating a general project manager and encouraging administration. | Keep color identification; reject dashboard density |

Final design dials: variance 4/10, motion 2/10, density 4/10. The distinctive detail is the saved next-step slip: sage paper, an understated stitched edge or line, and a large actionable sentence. Primary copy is calm and concrete: “A little note for your future self,” “Pick up where you left off,” “Save checkpoint.” No guilt, overdue badges, streaks, fake usage counts, or confetti.

UI/UX Pro Max’s actual persistent workflow and adaptations are recorded in the master. UniversalDesigner’s architecture detector ran on the greenfield folder, then React/TypeScript/Vite and self-hosted Lora/DM Sans were verified from `package.json`. CSS and SVG are sufficient for this app. Taste guidance was used only for intentional type, composition, and avoiding generic visual defaults; its landing-page-specific patterns were not adopted.

## Information architecture and journeys

One individual maker, one browser-local collection. No account, permission roles, team switcher, or cloud status.

```text
My projects (active shelf; search and craft filter)
├── New project dialog
├── Project detail / resume, addressable by project ID
│   ├── Save checkpoint dialog
│   ├── Earlier checkpoints, newest first
│   ├── Edit project dialog
│   ├── Print bag label dialog
│   └── Finish / reopen / delete confirmation
Finished projects
Backup & restore
How it works
```

First-use path: empty shelf → create named project → save checkpoint → persisted confirmation → latest checkpoint. A secondary “Try sample projects” action creates clearly marked sample records only when invoked. It must not overwrite existing records or appear to be the maker’s real work.

Return path: select project → immediately read latest next step, tool size, and position → inspect photo or play optional voice note → resume making. History is available below, not required for the common path.

Recovery path: backup page → choose file → validated preview with counts and explicit replacement effect → confirm restore → persisted collection. A bad file leaves current data intact. Downloading and restoring all media is part of the real product, not an optional future step.

## Screen specifications

### 1. Application shell and project shelf

Wide layout: 226px left sidebar with wordmark, Projects, Finished, Backup & restore, How it works. The bottom of the sidebar can state “Saved on this device”; never “Backed up” unless a downloaded backup exists and its timestamp is known. Main content has a small eyebrow, serif “Your project shelf” heading, short explanatory text, and New project button. A slim warm welcome region provides illustration and useful microcopy without pushing projects far below the fold.

The shelf’s toolbar contains search, craft selection, and a real result count. Cards form a 3/2/1-column grid based on space. Card order is latest updated first. Each card has a stable art/photo area, craft/sample badge, project title, tool/position summary, most recent next-step preview, saved time, and a clear resume action. Use only real record data. A missing checkpoint says “Leave your first checkpoint.” Never make the entire card a nested button containing other controls.

Empty: original workbasket artwork, “Every project deserves a good place to pause,” one short sentence, primary New project, secondary Try sample projects. No-results: preserve query and filters, say “No projects match,” offer clear filters. Finished-empty: explain that finished work appears here with an action back to active projects.

Mobile: top brand row and compact labeled navigation, no offscreen desktop sidebar. Main heading and action wrap; toolbar becomes a vertical stack when necessary. Artwork heights reduce; content remains readable at 320px. Forms scroll while the keyboard is open and the page can scroll naturally.

### 2. Project detail and resume

Back to projects appears first. Header contains craft/sample marker, project name, short yarn description, edit/label controls, and Save checkpoint. The current checkpoint takes priority: timestamp, large next-step sentence, tool size, row/repeat, optional notes. Use a sage note region and a small saved-place motif. Place the latest useful photo beside the instructions on wide screens and below on narrow screens. No required instruction should depend on a cropped image. Play local voice explicitly with native controls; never autoplay.

A project without a checkpoint explains exactly what to capture and offers Save checkpoint. Earlier checkpoints appear newest first with timestamp and their complete next step; photo/voice can be expanded. Current and earlier states must be distinct in text as well as position. If imported long text is present, wrap it rather than overflow or silently truncate it.

Finishing a project moves it to Finished and can be reversed via Reopen. Deletion confirmation names the project and explains that its checkpoints and media will be removed. QR IDs missing on the current browser show a helpful explanation: “This project isn’t on this device. Open it in the browser where you saved it, or restore a backup.”

### 3. Project editor dialog

Title “Start a project” or “Edit project.” Fields: name, craft (Crochet/Knitting/Other), tool size, yarn, color, optional project notes. Name is required, labels always visible. Use realistic example hints without pre-populating fake content. Advanced/optional fields can remain modestly grouped rather than hidden behind several steps. Color choices need text names and selected state, not color alone.

Footer: Cancel and Create project / Save changes. Pending state prevents duplicate writes. Inline validation describes the fix and focus goes to the first error. Storage failure retains the form and user input. Dirty modal dismissal should not accidentally throw away substantial input; if a close confirmation is added, it must work for close icon and Escape consistently.

### 4. Checkpoint capture dialog

Title “Leave a checkpoint”; brief helper: “Just enough to make the next stitch easier.” Start with “What will you do next?” (required, large textarea), then Current row or repeat and Tool size (prefilled from the latest saved context). Optional: photo, voice note, notes/modifications. Required information is visually ahead of optional media. Saving should be a few focused interactions.

Photo control has a named input, accepted type/size guidance, preview, and remove action. Invalid/unreadable image errors preserve the rest of the checkpoint. Voice control starts only on click, explains local microphone use, shows textual recording status and elapsed time, Stop, Delete, and playback. Denied or unsupported recording offers the text note alternative and does not block saving. Stop streams on close, unmount, and timeout.

Footer primary Save checkpoint. Save announces success only once the storage write completes. Keep error and retry available without closing the dialog. A saved record updates the resume screen immediately. Do not overwrite previous checkpoints as an edit shortcut.

### 5. Backup & restore

A short leading explanation: “Your projects live in this browser. A backup keeps a copy you can restore later.” Restore preview shows real project/checkpoint counts; export offers Download backup. Say the file contains notes, photos, and voice recordings so the maker can store it appropriately. Storage persistence request may improve eviction resistance but is never described as a backup guarantee.

Restore accepts the versioned JSON file. Display validated project/checkpoint counts, then require a specific Replace my projects confirmation explaining the effect. Parse/validation/size failures show a useful message and preserve current data. In-progress actions are disabled with visible progress text. On success show the imported collection; on atomic failure keep the previous collection. No fabricated sync status.

### 6. Bag label preview and print

A compact printable label with wordmark, project name, readable project code, craft, tool size, position, latest next step, and QR. Adjacent UI copy explains that scanning is a shortcut to a record already in this browser/site and is not a transfer or backup. Primary Print label; secondary Close. Missing checkpoints show known project facts and a useful blank/unsaved status rather than fabricated instructions.

Print exceptions are defined in [pages/print.md](../design-system/loopmark/pages/print.md). White background, black text, no app shell, no print controls. Ensure text remains legible and long instructions wrap. QR retains quiet zone. Label can still be used physically when digital access is unavailable.

### 7. Guide

Three short steps: make a project, leave a checkpoint, come back to the next step. Explain local data, full backups, same-device QR limitations, mic support/permission, and optional samples. Keep practical guidance close to corresponding actions as well; this page must not become required onboarding.

## Layout sketches

```text
Desktop shelf                       Desktop resume
┌────────────┬───────────────────┐  ┌────────────┬─────────────────────┐
│ loopmark.  │ YOUR WORKBASKET    │  │ loopmark.  │ ← Projects          │
│            │ Your project shelf│  │            │ Meadow cardigan     │
│ Projects   │ intro    [+ New]  │  │ Projects   │          [+ Pause]  │
│ Finished   │                   │  │ Finished   │ ┌──────────┬───────┐│
│ Backups    │ [search] [craft]  │  │ Backups    │ │ NEXT STEP│ photo ││
│ Guide      │ ┌─────┬─────┬────┐│  │ Guide      │ │ ...      │       ││
│            │ │ art │ art │ art││  │            │ │ tool/row │       ││
│ local note │ │ name│ name│name││  │ local note │ └──────────┴───────┘│
└────────────┴───────────────────┘  │            │ Earlier checkpoints │
                                    └────────────┴─────────────────────┘
Mobile: brand → nav → heading/action → toolbar → single card column.
Detail mobile: title → latest next step → tool/row → media → history.
```

## Reusable components and state ownership

| Component | Input / behavior | Semantics and states |
|---|---|---|
| Brand | Compact brand mark/wordmark | Logo image decorative beside name; link/button only if navigation works |
| Dialog | title, children, onClose, optional wide | Native modal dialog, heading label, initial focus, Escape, focus restoration |
| Button/icon button | action, variant, pending, disabled, name | Native button, visible focus, icon-only accessible name |
| Project card | Project record, resume action | Article with heading and separate explicit open control; Sample marker |
| CraftArt | Project, size | Current local photo or identified illustration; stable dimensions |
| Badge | content, semantic tone | Text state; color is supplementary |
| Checkpoint slip | immutable Checkpoint, current flag | Date/time, next-step text, definition list for tool/position |
| Photo input | local file/preview, change/remove | Label, error description, loading state |
| Voice note | local recorded media, record/remove/play | Explicit permission, live recording text, native audio controls |
| ErrorMessage | message | Alert only on new meaningful error; preserve context |
| Empty | title, description, action | Heading, concise explanation, real next action |
| Search/filter | query, craft, change | Labeled input/select; no results state |
| Restore preview | validated Backup, onConfirm | Named destructive replacement; counts from parsed data |

UI renders domain state and invokes persistence operations; it must not claim success from local optimistic state alone. Domain/media validation is separate from presentation. Do not use animation to drive record state.

## State and accessibility coverage

| State | Required presentation |
|---|---|
| First load | Brief non-flickering loading indicator; usable layout space reserved |
| Empty collection | Workbasket + create action + opt-in samples |
| Populated collection | Real cards/counts/timestamps |
| No search results | Keep filter values; clear-filters action |
| Validation failure | Error near field; useful correction; focus first error |
| Storage read/write failure | Actionable message, preserve input/data, no success claim |
| Offline | Core saved data remains usable after shell is cached; offline status where useful |
| Unsupported or denied microphone | Explain and allow text/photo checkpoint |
| Pending write/import | Button disabled, concise progress text, no duplicate mutation |
| Destructive action | Record name, explicit effect, Cancel available |
| Missing local record | Same-browser limitation and backup recovery path |
| Import failure | Current collection unchanged; validation message |
| Large text/long titles | Wrap, natural height, no clipping or overlapping fixed controls |

Target WCAG 2.2 AA. Validate keyboard traversal, modal focus trap/return, names, error announcements, 24px minimum targets (44px preferred), 200% zoom and 320px reflow, color contrast, file inputs, and playback. Decorative illustration SVGs may have internal title/description for standalone use but use empty alt when embedded decoratively beside equivalent text. State must be conveyed by words. No hover-only controls. Respect safe-area insets on mobile. Native controls are preferred where they carry useful semantics.

## Motion inventory

These effects are implemented in src/styles.css. Browser checks exercise reduced motion and dialog operation; no physical-device frame-rate claim is made.

| ID | Surface / purpose | Trigger and properties | Duration / easing | Interruption and repetition | Mobile / reduced motion | Fallback / cleanup / budget |
|---|---|---|---|---|---|---|
| M01 | Action feedback | Hover/focus/press: color, opacity, optional 1px transform | 140ms ease-out | Reversible immediately; repeat only on interaction | No hover dependency; reduce removes transform | Native CSS final styles; no JS loop |
| M02 | Dialog entry / spatial continuity | Open: opacity + translateY(8px) | 180ms ease-out | Closing cancels; never delay close for exit | Same on mobile; reduce: immediate final state | Native dialog remains usable if animation fails; no observers |
| M03 | New checkpoint success | Newly saved slip/toast: opacity + translateY(4px); check mark final state | 200ms ease-out, once | New save replaces previous effect; no looping | Reduced: static check + live saved text | Announcement independent of motion; clear any toast timer on unmount |
| M04 | Project card affordance | Pointer hover: subtle translateY(-2px), border tint | 200ms ease-out | Reverses on leave; keyboard gets visible focus instead | No translation on coarse pointer; reduce removes transform | CSS only, no layout shift, no animation on unseen cards |
| M05 | Hero stitch/text emphasis | Initial render: one decorative underline/needle SVG emphasis via scaleX/opacity | 350ms ease-out, once | No repeated typewriter effect | Reduced: static underline; essential text always visible | CSS final state fallback; no requestAnimationFrame loop |

Use CSS for all listed effects, one animation owner per property, no delayed content. Lottie/dotLottie was evaluated and omitted because there is no authored multi-frame sequence whose benefit justifies a player or extra asset request. The original SVG illustrations provide craft texture with bounded CSS motion. No GSAP, Motion, Rive, 3D, parallax, or text-splitting runtime is required for these interactions. A static final state is the fallback for every decorative effect. No continuous animation needs a pause control; voice audio has native pause/stop playback.

Performance targets: all original illustration files together <25 KB uncompressed; zero animation runtime bytes; no image/font requests to third parties; transform/opacity effects short and one-shot. Profile in integrated browser tests; do not claim a measured frame rate without a trace. SVG pattern/paths remain static; avoid animating their filter or per-stitch geometry.

## Asset provenance and licensing

| Asset | Source / editable source | Permission and attribution |
|---|---|---|
| `public/art/workbasket.svg` | Original project vector artwork authored in this implementation | No third-party source; project may use/edit/redistribute; no attribution requirement imposed |
| `public/art/granny-square.svg` | Original programmatic SVG with individually composed stitch/petal motifs | Same; not a copied pattern chart or instructions |
| `public/art/sage-knit.svg` | Original programmatic SVG cardigan illustration | Same; decorative illustration, not a knitting pattern |
| `public/art/clay-scarf.svg` | Original programmatic SVG scarf illustration | Same |
| Tabler UI icons | Installed `@tabler/icons-react` package; catalog checked | MIT; retain package license in dependency distribution |
| Lora fonts | Installed `@fontsource/lora`; locally served WOFF2 | SIL Open Font License; retain upstream font license |
| DM Sans fonts | Installed `@fontsource/dm-sans`; locally served WOFF2 | SIL Open Font License; retain upstream font license |

All four original illustration XML files were parsed successfully at creation. Sizes: workbasket 3,092 B; granny square 12,026 B; sage knit 2,268 B; clay scarf 2,167 B (approximately 19.6 KB total). They contain no scripts, external URLs, embedded raster photos, or third-party imagery. Their SVG files are their editable source. User-supplied photos and recordings belong to the user and are stored locally; samples must be explicitly identified.

## Verification checklist and handoff

The implementation owner must inspect the rendered shelf, detail, every dialog, backup states, missing record, and print preview at 1440px, 768px, 390px, and 320px. Exercise keyboard, reduced motion, long content, empty/sample/real data, and media failures. Check that the same latest checkpoint is shown after reload and offline, and that replacing data requires the validated confirmation. Record actual outcomes in the project’s verification report; do not mark design targets as tested merely because they appear here.
