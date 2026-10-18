# Loopmark Implementation Plan

> Historical foundation record: this document describes the earlier browser-local release. The accepted cloud, purchase and native expansion is tracked in [the expansion plan](expansion-plan.md), [execution ledger](expansion-execution.md) and [release readiness](release-readiness.md). Its earlier PASS labels do not qualify the expanded release.

> Execution: native integration owner with parallel independent research/design/data packages and fresh review. Equivalent host-native controlled workflow; no unsupported slash-command invocation claimed.

**Goal:** A verified offline pause/resume craft utility.
**Architecture:** React + TypeScript + Vite; IndexedDB repository, strict backup validation, local media and generated service-worker precache. No backend.
**Spec:** [specification.md](specification.md)

## Global constraints
User requested isolated directory. All work remains in loopmark. Root owns contracts/config/dependencies/integration. Shared filesystem uses disjoint file ownership, not parallel branches. No existing repo or worktree to preserve. Browser data private, no telemetry/deployment. Contract version 1. User delegated routine decisions; build continues after explicit review checks.

## Review focus
Malformed backup must never overwrite data; two tabs must not lose checkpoints; media permissions/cancellation must release microphone; origin-based QR must not pretend to transfer data; offline refresh must work on built assets, not only dev server.

## Task DAG and packages
| ID | Requirements | Owner/permitted files | Prerequisites | Checks/reviewer | Status |
|---|---|---|---|---|---|
| T1 discovery | R9 | research: docs/product.md, research.md; design: docs/design-system.md, public/art; architecture: docs/architecture.md, technical-research.md | none | lead reconciles scope | VERIFIED |
| T2 foundation/data | R1–R5 | root: manifest/config/types; data worker: src/data.ts, src/data.test.ts | contract v1 | unit validation/transaction tests; independent judge | VERIFIED |
| T3 core journey | R1–R4,R8 | root: App.tsx, components, media.ts, styles.css | T2 types; design brief | UI create→checkpoint→reload→resume | VERIFIED |
| T4 backup/label/offline | R5–R7 | root integration + designated worker if available | T2/T3 | export→restore media, QR decode, offline reload | VERIFIED |
| T5 audits | R1–R9 | fresh reviewer tests and docs/review.md | integrated build | Playwright, axe, security, performance; lead fixes | VERIFIED |
| T6 delivery | R9 | root README, runbook, evidence, ledgers, CI | checks pass | reproducible npm ci/build/test | VERIFIED |

Base revision: new empty directory; local git baseline will be created after initial docs. Shared contract changes require owner notification. Each package returns changed files, commands, observations, risks. Blocking conditions: host tools or real device-only behavior; continue all independent work. No external services required.

## Steps
- [x] Establish intent, alternatives, requirements and module ownership; metadata skill inventory.
- [x] Create typed contract and strict atomic data repository. Write meaningful import/transaction regression tests then verify.
- [x] Implement project shelf/editor and latest-checkpoint journey; verify persistence in browser.
- [x] Implement local photo/voice, history, finish/reopen/delete and all failure states.
- [x] Implement export/restore preview confirmation, bag label and production offline shell.
- [x] Inspect desktop/mobile/keyboard/reduced motion; resolve independent findings.
- [x] Record measured build/tests and exact limitations; finalize docs and local reproducible delivery.

## Plan review
Product: focused restart differentiation; no artificial paywall. Architecture: IDB transactional ownership, validated atomic replacement and explicit origin limitations. Design: next step dominant, no feature overload; restrained CSS/SVG motion rather than player payload. All R1–R9 map to tasks. No cyclic dependencies. Price/retention are research hypotheses; human field test remains future work.

## Final integration result

All R1–R9 accounted for in requirements.md. Production build, 21 data tests, 18 Chromium browser tests, format check and dependency audit passed. Independent judge evidence is in review.md. There is no production deployment or physical-device verification. Runtime defect corrections are recorded in verification.md.

Final visual regression: sample checkpoint text after font load is covered at 320/390px; all 18 browser tests passed on cache 4d77b5f3b157. See final evidence and independent review.
