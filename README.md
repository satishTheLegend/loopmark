# Loopmark

**A little note now. A lovely start later.**

Loopmark helps makers return to unfinished crochet, knitting and other craft projects. Save a photo, tool size, row or repeat, next step and optional voice note; open the latest checkpoint when you return.

The project contains a React/Vite web app, Capacitor iOS/Android apps, optional Supabase account sync, hosted Razorpay web checkout, and RevenueCat native purchase adapters. Guest use requires no account or backend. Hosted services, real provider purchases, signing and physical-device release qualification are not activated by this checkout. See [release readiness](docs/release-readiness.md) and the [execution ledger](docs/expansion-execution.md) for the exact verification status.

![Loopmark project shelf with optional sample projects](docs/evidence/desktop-shelf.png)

## Run locally

Requires Node.js **22.12+** and npm. The lockfile pins the installed dependencies.

```sh
npm ci
npm run doctor -- --capability guest --json
npm run dev
```

Open the URL Vite prints. Each checkout derives a separate local port; `LOOPMARK_DEV_APP_PORT` overrides it. No API key or environment file is needed for guest use.

To test offline reopening:

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

Use **http://127.0.0.1:4173**, then check **A little guide** for “Ready offline on this device.” Service workers run in production builds. Keep using the same origin: a different hostname, port, browser or profile has separate storage.

## What the app does

- Create, edit, search, finish and reopen craft projects.
- Save immutable checkpoints and resume from the latest next step; all saved history remains readable.
- Keep unfinished drafts on this device, with explicit discard and safe retry after interrupted saves.
- Export a complete portable v1 backup with verified photos and voice bytes. Restore creates a **separate recovered collection**, preserving the original collection and its drafts.
- Print readable project-bag labels with QR shortcuts. A label points to a record; it does not contain the project or replace a backup.
- Sign in optionally with an email code. Signing in leaves local projects in place; connecting them requires a destination/count preview and explicit confirmation.
- Queue connected edits offline, retry immutable operations, distinguish saved text from pending attachments, and review conflicts without silently replacing either version.
- Check whether every project attachment is available offline, download missing files, or remove eligible downloaded copies while preserving cloud data and files needed by unfinished work.
- Review backup files opened from iOS or Android before restoring them as a separate local collection. Repeated deliveries retain their original import identity.
- Review local copies before sign-out or account deletion. Keep a private deletion receipt to check progress after sign-out.
- Offer three active projects free. A verified one-time upgrade permits more active projects, within storage limits. Reaching the allowance never hides saved projects, edits, checkpoints, history or export. Eligible pre-expansion collections preserve their migration access; importing a backup does not create a purchase grant.
- Keep an upgrade-gated draft on the device through sign-in and checkout. Price comes from the configured provider. Payment returns and SDK results require server verification; Continue opens the saved action for review without automatically creating or reopening a project.
- Provide purchase restoration and recovery-key workflows separately from craft-data recovery.

First launch is empty. Optional sample projects are labeled examples. Limits are **200 projects, 1,000 checkpoints and 48 MiB of serialized portable project content per collection**. Encoded photos and audio count toward this limit. Cloud storage also counts staged uploads and replacement reservations.

## Saving and protecting your work

Before putting a project away, choose **Save a checkpoint**. The required field is **What will you do next?** On return, the latest instruction, row and tool size are shown immediately.

Photos are resized locally. Browser recordings require microphone permission and HTTPS or localhost, and stop after two minutes. Native capture uses platform permission and interruption handling. Media is uploaded only for a collection you explicitly connect. Use **Project files** to check offline availability before leaving a connection. Removing downloads affects eligible cached bytes on this device; saved text, cloud attachments, local originals and protected unfinished work stay intact.

Download a complete backup regularly. Drafts are separate and **not included**: save them as projects/checkpoints first. An export with missing attachment bytes fails with recovery guidance rather than claiming to be complete. Backups contain private notes and media and are not encrypted by Loopmark.

Browser storage can be evicted or cleared. Removing a native app can remove its local data. Sync is not an independent backup. A localhost QR points to the device on which it is scanned; cross-device labels require a stable configured HTTPS origin and access to the matching record.

## Optional services and native builds

Use [developer setup](docs/developer/quickstart.md), [.env.example](.env.example), and the [contract reference](docs/developer/contracts.md). Only explicitly allowlisted `VITE_` values may enter browser/native web assets; server credentials belong outside public configuration.

```sh
npm run doctor -- --capability local-sync --json
npm run local:up
npm run test:server -- --suite all
npm run test:sync -- --project=chromium
npm run local:down
```

The local stack requires Docker and uses a checkout-specific loopback profile with synthetic accounts and delivered local email codes. `local:down` preserves data. Reset requires the exact project confirmation described by the setup guide. Never point these fixtures at production.

```sh
npm run native:sync
npm run native:ios:build
npm run native:android:build
```

Native builds require their platform toolchains. Actual simulator/emulator tests require explicit dedicated test targets. Unsigned/debug builds and simulator results do not establish store acceptance, physical capture fidelity, signing or production associated-domain behavior. [Qualification instructions](docs/release/qualification.md) list those gates.

## Verification and project map

```sh
npm test
npx playwright install chromium firefox webkit
npm run build
npm run test:e2e
npm run test:ui
npm run test:compat
npm run test:security
npm run test:release:contracts
npm run test:sandbox:contracts
npm run format:check
```

Browser profiles cover Chromium, Firefox and WebKit desktop, plus Chromium/WebKit mobile emulation. Native persistence and production-screen tests run in actual simulators/emulators. Synthetic provider fixtures validate local authority behavior; actual provider sandbox transactions remain a separate requirement. Performance budgets are measured during isolated runs, not inferred from a busy-machine regression.

- `src/runtime.ts`, `src/App.tsx`: platform services and application journeys.
- `src/domain/`: portable, wire and policy contracts; `src/data.ts` retains the portable compatibility facade.
- `src/repositories/`, `src/services/`, `src/sync/`: scoped persistence, immutable operations, backup, media and synchronization.
- `src/auth/`, `src/billing/`, `src/platform/`: authentication and payment boundaries; browser/native adapters.
- `supabase/`: migrations, functions, policies and local authority fixtures.
- `ios/`, `android/`, `scripts/native/`: native shells, builds and device test tooling.
- `src/components/`, `public/art/`: interfaces and original editable SVG artwork.
- `docs/`, `tests/`: plans, evidence, requirements and regression suites.

[Expanded product scope](docs/expansion-plan.md) · [Architecture and failure design](docs/expansion-engineering.md) · [Interaction specification](docs/expansion-design.md) · [Design system](design-system/loopmark/MASTER.md) · [Skill inventory](docs/skills.md) · [Research and pilot](docs/expansion-research-protocol.md) · [Operating budget](docs/operating-budget.md) · [Release gates](docs/release-readiness.md)

Earlier foundation completion reports remain historical evidence for their identified revision, not proof of the expanded release. No public deployment, outreach, real purchase, paid account provisioning or store submission has been performed. The 15-maker study and its 10/8/5 criteria have not been run.
