# Loopmark design system

The authoritative product design. Screen specifications, states, motion inventory, and asset provenance are in [the design document](../../docs/design-system.md). Page exceptions live in `pages/`.

## Direction: the quiet workbasket

A calm, tactile workspace for returning to something handmade. The next stitch gets more attention than project administration. Use oatmeal, walnut, clay, and sage; generous spacing; warm serif headings; practical sans-serif labels; fine borders; original flat textile illustrations. No dashboards full of decorative metrics, streaks, or urgency about unfinished work.

## Evidence and adaptation

UI/UX Pro Max was executed and persisted on 18 October 2026 using:

```sh
python3 /Users/lalaji/.codex/skills/ui-ux-pro-max/scripts/search.py 'journaling app personal productivity' --design-system --persist -p Loopmark --variance 4 --motion 2 --density 4 --output-dir /Users/lalaji/Repos/CGProjects/loopmark
```

The original output is preserved in `GENERATED-REFERENCE.md`. Its productivity-app category, flat style, fast loading, 4/8px rhythm, keyboard guidance, and avoidance of complex onboarding fit. Its marketing landing page pattern, teal theme, identical heading/body typeface, and GSAP scroll reveal do not serve the craft workspace. This master intentionally replaces those recommendations. An initial craft-journal query matched handmade typography and warm colors but returned a marketing page structure; a narrower productivity-app query confirmed applicable structural rules. No database match is claimed for custom artwork or the exact final palette.

The architecture detector found a greenfield directory. The lead selected React, TypeScript, and Vite before design execution; browser-native CSS and SVG require no animation renderer. Native mobile guidance is not a claim that native apps are being shipped.

## Semantic tokens

| Token | Value | Purpose |
|---|---|---|
| `--canvas` | `#F8F5EF` | Application canvas |
| `--surface` | `#FFFDF9` | Paper cards, panels, inputs |
| `--ink` | `#332D27` | Primary text |
| `--muted` | `#71675D` | Secondary text, hints |
| `--clay` | `#A64B31` | Primary action, active navigation, links |
| `--clay-hover` | `#8C3F29` | Hovered primary action |
| `--on-clay` | `#FFFAF1` | Primary action text |
| `--clay-soft` | `#F4E6DC` | Warm decorative surface |
| `--sage-soft` | `#E9EDDE` | Next-step note, reassuring status surface |
| `--sage` | `#56634B` | Sage text, saved status |
| `--border` | `#E2DDD3` | Decorative separators only |
| `--control-border` | `#948777` | Input/control boundaries |
| `--danger` | `#9E3C2B` | Destructive action/error text |
| `--focus` | `#637659` | 3px focus ring, 3px offset |
| `--scrim` | `rgb(51 45 39 / 38%)` | Dialog backdrop |

Calculated sRGB contrast: ink/canvas **12.49:1**, muted/canvas **5.08:1**, on-clay/clay **5.50:1**, sage/sage-soft **5.37:1**, clay/canvas **5.26:1**, input outline/paper **3.42:1**. Soft dividers are decorative; interactive inputs use the stronger control border. Browser axe checks and manual boundary inspection supplement these calculations.

## Type

- Headings and project titles: self-hosted Lora, with Georgia/Cambria/serif fallback. Use the project’s @fontsource/lora package and retain its OFL license; no network font dependency.
- Interface and body: self-hosted DM Sans through @fontsource/dm-sans, with system sans (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif) fallback. Retain its OFL license.
- Main title: 34px desktop (39px at 1550+), 29–32px on phone; Lora medium with -1px tracking.
- Section headings: 18–24px; project card titles: 16–20px. The saved next-step instruction is 20–21px with 1.65 line-height.
- Interface body: 12–14px; compact metadata: 10–11px. Tool facts and next-step card previews are 12px minimum. Decorative eyebrows may be smaller; essential instructions never use them.
- Desktop inputs: 12px; phone inputs: 16px to avoid automatic zoom. Long titles and next steps wrap naturally. Never clamp the current next-step instruction.

## Geometry

The integrated source `src/styles.css` defines the exact responsive rules. Desktop sidebar 226px, reducing to 205/190px at compact widths; phone navigation changes at 700px. Content maximum 1370px including 42px desktop gutters, 20px phone gutters. Main action buttons 42px desktop/44px in phone dialogs; icon buttons34px desktop/40px phone. All tested targets meet the WCAG 2.2 AA 24px minimum; 44px is a preferred touch goal, not a universal achieved claim.

Cards have 8px corners, dialogs 13px, inputs/buttons 5–6px; this keeps the paper/workbasket feeling restrained. Grid is 3 columns at 1181px+,2 at 481–1180px,1 at 480px and below. Resuming switches to a single main column at 950px, with responsive detail panels. Content wraps at 320px. Z-index: sidebar 20, mobile scrim 30, mobile drawer 40, mobile header 50, toast 100; native dialog uses the top layer.

Input outlines use #948777 on pale paper. Sage input border uses #7E8A6B. Sage fact labels #56634B and saved date #59634E were darkened following browser accessibility checks. Sidebar microcopy uses #6B6156; footer #716454. Decorative separators retain soft contrast. Motion is short CSS opacity/transform; no continuous animation.

## Icons and imagery

Tabler outline icons first, 20px/1.6 stroke, 24px for primary actions. Catalog-confirmed names include basket, needle-thread, camera, microphone, archive, download, upload, plus, arrow-right, search, tag, printer, check, x. Verify React package exports at implementation. Decorative icons are hidden from assistive technology; icon-only buttons require a name.

Original SVG illustrations in `public/art/`: `workbasket.svg`, `granny-square.svg`, `sage-knit.svg`, `clay-scarf.svg`. These are editable project artwork, not user photos. User photos use `object-fit: cover` on the shelf and `contain` when their details matter on the resume view. Keep the image ratio stable while loading.

## Interaction principles

One prominent action per surface. “Save checkpoint” describes the write. “Pick up where you left off” names the resume experience. A successful save is announced only after persistence succeeds. Empty states invite one small action. Sample projects require an explicit user click and a visible “Sample” label. Local storage status must distinguish “saved on this device” from a downloaded backup.

All actions have focus, hover, active, pending, disabled, and failure treatments where relevant. Use native buttons, labels, inputs, and dialog semantics. No hover-only actions. No color-only state. Escape closes non-destructive dialogs; focus returns to the opener. Destructive record deletion requires clear confirmation with the record name.

## Motion

CSS only. 120–180ms control transitions, 180–220ms dialog entry, 250–350ms one-shot save/illustration emphasis. Animate opacity and transforms; any SVG stroke animation is decorative and bounded. No essential text awaits reveal. `prefers-reduced-motion: reduce` disables translations and drawing effects and displays final states immediately. Details and omission rationale are in the screen specification.

## Quality baseline

WCAG 2.2 AA target; keyboard and visible focus; meaningful labels and errors; 320px reflow; reduced motion; readable print labels; no autoplay audio; no hidden autoplay animation; no external font/image dependency; local photo and voice privacy explained at use. This file defines acceptance targets, not proof that they have been tested.
