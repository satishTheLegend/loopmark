# Loopmark product brief

> Historical foundation record: this document describes the earlier browser-local release. The accepted cloud, purchase and native expansion is tracked in [the expansion plan](expansion-plan.md), [execution ledger](expansion-execution.md) and [release readiness](release-readiness.md). Its earlier PASS labels do not qualify the expanded release.

Version: initial local research release · 18 October 2026

## Purpose and audience

**Help a maker leave enough information now to restart confidently later.**

The first audience is people with several unfinished crochet, knitting, or similar craft projects. Their difficult moment is returning after days or weeks and needing to reconstruct the tool, row/repeat, modification, and next action. The product should make the pause brief and the return clear.

This is a product contract and field-test plan. Executed software checks and known implementation limitations belong in the delivery/testing documentation; this brief does not claim that a cohort or paid test has occurred.

## Product decisions

- Work in a separate `loopmark` project directory.
- Deliver a responsive local browser app for the first release. Store project content on the user's browser/device without an account.
- Place the newest checkpoint and its **next step** at the center of the return experience.
- Keep row or repeat position as text so makers can write “row 24 complete,” “repeat 3, row 2,” or “left sleeve.” Avoid implying that every craft can be represented by one integer.
- Treat a checkpoint as a dated record. A later checkpoint can reflect changed tools, position, or instructions without destroying the older record.
- Offer one photo per checkpoint and an optional local voice note. Text remains sufficient when media permissions are unavailable.
- Include full export and restore before calling the tool useful for long pauses. A local save or a QR label is not a backup.
- Include a printable bag label with a readable project code, essential restart facts, and a QR shortcut to the record.
- Keep this research build unrestricted. Three free active projects and a one-time upgrade are future pricing experiments, not a working payment system.

Evidence and alternatives are in [research.md](./research.md). The main distinction to test is habit and speed, not the uniqueness of feature inventory.

## Primary journeys and acceptance criteria

| ID | Journey | Acceptance criteria |
| --- | --- | --- |
| P01 | Make a project | A maker can create a named project and distinguish its craft; empty or invalid required input is explained beside the relevant control. The project persists after reload. |
| P02 | Put work away | From a project, capture tool size, current position, and a short next action; add a current photo and optional voice note if useful. Save creates a dated checkpoint and clearly reports success only after storage succeeds. |
| P03 | Come back | Opening a project immediately shows its newest checkpoint, including next step, tool, position, media and saved date when present. The maker does not have to search history to see where to begin. |
| P04 | Reconstruct a change | Earlier checkpoints are available in reverse chronological order. A new tool or modification is represented by a new checkpoint; older values remain available. |
| P05 | Find the right project | The project collection supports finding a name/code and distinguishes unfinished work from completed work. Completing a project preserves its checkpoints, and reopening it is possible. |
| P06 | Keep a portable copy | Export includes every project, checkpoint, supported photo and voice note. The download is an actual file the maker can keep elsewhere. |
| P07 | Recover from a backup | Restore validates the file before changing data, explains its effect, and reconstructs the exported content. Malformed or unsupported files show a useful error and preserve current records. The overwrite/merge policy must be explicit in the interface. |
| P08 | Put a label on the bag | Print a readable name/code and essential facts, plus a QR shortcut. The label still has useful text when scanning is unavailable. The UI explains that the record must exist in the browser that opens the link. |
| P09 | Use without a connection | After the app's initial load/install preparation, the main project/checkpoint flows can operate without the network. Failed network access must not imply that locally saved work was lost. |
| P10 | Use with accessible controls | Labeled fields, keyboard operation, visible focus, usable touch targets and reduced-motion behavior are provided. Empty, error, and unsupported-media states offer a usable next action. |

## Information model

**Project:** stable internal ID, readable bag code, name, craft, current completion state, creation/update times, and its checkpoint history. Supplemental context such as yarn can be present if it does not slow the central flow.

**Checkpoint:** stable ID, parent project, saved time, tool size, position, next step, optional photo, and optional audio. If a form starts with facts from the last checkpoint, clearly present them as editable carry-forward values; saving must make a new record rather than silently mutate the old one.

**Backup:** a versioned, self-contained representation of projects, checkpoints and media. Restore is a data-recovery operation and must fail safely. A backup may contain personal photos or voice, so the user must understand what is included before sharing it.

The app must not pretend that a successful download proves the user has safely stored the file. The bag code and QR identify a record; neither contains a complete recovery copy.

## Core screens

1. **Project shelf:** unfinished projects with recognizable names/images, recent checkpoint context, search/filter controls, and a clear create action. A genuine empty state guides the first project; sample data must be identified as sample data.
2. **Resume view:** latest checkpoint first, with a prominent next step and a clear action to leave another checkpoint. History and project management are secondary.
3. **Checkpoint form:** a compact composition with tool, position, next step, photo and optional audio. Explain microphone permission or unsupported recording without blocking a text save. Prevent accidental double saves and preserve user input after a failed save.
4. **Project form:** the minimum facts needed to recognize and revisit the project. Keep details short and optional where possible.
5. **Backup/restore:** explain local storage, export all content, choose a file, validate it, and make any replacement consequence clear before applying it.
6. **Bag label:** a print-friendly view with readable facts and a scannable code. Long names and instructions should wrap without clipping the critical content.

## Quality and trust targets

These are acceptance targets, not results. Actual measurements must identify device, browser, dataset and build.

| Area | Target and measurement |
| --- | --- |
| Capture effort | In a small usability session, aim for a median under 30 seconds for a subsequent text checkpoint with unchanged tool size. Measure from opening capture to successful save; report media separately. |
| Recovery | A participant can find the correct project and explain the next physical action without researcher help. The field study requires a pause of at least seven days. |
| Data integrity | Reload persistence and export-to-clean-browser restore must preserve a representative set of projects, checkpoints and both media types. Invalid import must not alter current content. |
| Accessibility | Aim for WCAG 2.2 AA; combine automated checks with keyboard, focus, text zoom, narrow layout and reduced-motion inspection. Do not equate a clean automated scan with full conformance. |
| Performance | Core actions should remain responsive with a representative collection of 50 projects and 500 checkpoints. Measure storage/capture latency and identify media sizes; avoid unsupported universal device claims. |
| Privacy | No account, remote project upload, third-party analytics, or cloud transcription is required by this release. Browser permissions are requested only for the related optional action. |
| Recovery clarity | Explain that clearing site data, changing browser/device/origin, or losing the device can remove access. Provide the export action where a maker can find it. |

## Deliberately outside this release

Cloud sync/accounts; pattern marketplace or PDF reader; advanced live counters; inventory and business costing; social feeds; AI-generated craft instructions; automatic voice transcription; push reminders; app-store release; checkout, purchase receipts and paid entitlements. These can be reconsidered after the checkpoint habit is demonstrated. The build must not display fake purchase success or claim paid conversion evidence.

## Validation and next release gate

Use the 15-person study defined in [research.md](./research.md), with the user's thresholds of **10 voluntary checkpoint users, 8 successful week-later resumers, and 5 actual purchasers**. Record prompting and technical support. Ship additional organizational features only when observed failures show they are needed for capture or recovery.

Before a public paid release, complete real device checks, durable hosting/origin decisions, a tested backup compatibility policy, actual purchase/entitlement operations, clear support terms, and name clearance. No conclusion about product-market fit follows from completing this local build.
