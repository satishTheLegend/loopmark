# Skill selection and execution record

Recorded on **18 October 2026**. The complete local metadata inventory is [skill-register.json](./skill-register.json). It contains **1,964 readable `SKILL.md` manifests**, not 1,964 executed workflows.

| Discovery root | Manifests |
| --- | ---: |
| `/Users/lalaji/.codex/skills` | 171 |
| `/Users/lalaji/.agents/skills` | 14 |
| `/Users/lalaji/.codex/skill-libraries` | 1,727 |
| `/Users/lalaji/.codex/plugins/cache` | 52 |

Discovery recursively followed directory symlinks and deduplicated resolved directories within each root to avoid loops. No read errors occurred. Every manifest exposed a description; **349** declared a version field. A missing version remains `null`; folder versions and repository commits were not substituted for an undeclared skill version. The inventory records name, description, location, availability, declared version, selected phase, invocation and disposition. It is a snapshot of these roots, not a claim about remotely available packages.

## Applied guidance for the local foundation

| Skill or selected upstream workflow | Actual use | Status |
| --- | --- | --- |
| `brainstorming` | Intent, assumptions, scope and design routing; the user's master brief delegated routine product and implementation decisions | Guidance applied |
| `gstack` | Workflow routing and scoped review selection | Router read; no shipping/telemetry operation |
| `superpowers-workflows` → `writing-plans` | Executable implementation plan and work ownership | Guidance applied |
| `superpowers-workflows` → `verification-before-completion` | Verification evidence before delivery | Guidance applied; actual results belong in delivery records |
| `universal-designer` | Design entry point and greenfield architecture assessment | Guidance applied |
| `ui-ux-pro-max` | Product design search and persisted design-system reference | **Script executed**; command below |
| `seo` | Proportionate handling of a local app and indexing/privacy boundaries | Guidance applied; no full audit or paid enrichment |
| `karpathy-guidelines` | Focused implementation and explicit success criteria | Guidance applied |
| `tabler-icons` | Icon library checked first and relevant icon names selected | Guidance applied |
| `marketing-skills` → `pricing` and `ab-testing` | Pricing hypotheses, stable field-study denominators, and limits of a 15-person study | Guidance applied; no campaign, payment, or participant action |
| `sites:sites` | Local-only delivery guidance | Read; no Sites creation or deployment |
| `gstack/office-hours` | Product reference material | **Partially read; full workflow not run** |

The design agent ran:

```sh
python3 /Users/lalaji/.codex/skills/ui-ux-pro-max/scripts/search.py \
  'journaling app personal productivity' --design-system --persist \
  -p Loopmark --variance 4 --motion 2 --density 4 \
  --output-dir /Users/lalaji/Repos/CGProjects/loopmark
```

Its output and adaptations are preserved in [the design master](../design-system/loopmark/MASTER.md) and [generated reference](../design-system/loopmark/GENERATED-REFERENCE.md). A script result supplies design guidance; it does not establish that rendered screens pass accessibility or usability checks.

For the original local foundation, the global `gstack-autoplan/SKILL.md` was discovered and its installed behavior was read by the architecture agent. Applicable product → design → engineering review order informed native coordination. The full runtime and external-model wrapper were **not invoked**; no full autoplan result or cross-model consensus is claimed. See architecture.md for the adapted review coverage.

## Skills not selected for the original local scope

Other manifests were cataloged as not selected. Their metadata was considered for routing; their workflow bodies were not interpreted as instructions or executed. The reasons are task scope and overlap:

- Cloud infrastructure, authentication, multi-tenancy, native app distribution, AI integration, email and enterprise systems do not serve the selected local release.
- Broader SEO, blog, scientific, document/spreadsheet, presentation, and connected-account workflows are outside this artifact's needs.
- Additional planning/design/review collections overlap the chosen routes; adding them would duplicate process without a specific unanswered question.
- Publishing, outreach, payment processing, telemetry, provider connections and expensive external jobs are separate actions. Discovering a skill does not authorize any of them.

The original release counts are historical; current machine-readable counts are in skill-register.json. Actual build/test commands and limitations must be read from the project delivery evidence, not inferred from this skill catalog.

## Completion cross-verification pass

Brainstorming and gstack were consulted first again for the new hardening request. Scope remained the authorized local app. Actual native product → design → engineering review stages, including decisions, failure cases, reuse, acceptance, ownership and dependency map, are in [completion-plan.md](completion-plan.md). A separate reviewer produced [completion-judge.md](completion-judge.md); data and cross-browser owners independently reproduced defects. This is real parallel work, with all agents on the same model family; no cross-model consensus is claimed.

The installed `gstack-qa` preamble was executed, its applicable full methodology sections read, and its reproduce → regression → repair → re-test approach applied through the existing Vitest and Playwright suites. The installed gstack headless browser was also started against the owned local app and its accessible navigation inspected. The native suites provide the exhaustive browser evidence. The global wrapper's onboarding/upgrade, Aside installation, external-model calls, per-probe artifact choreography and computed health score were not run in full. The referenced `gstack-qa/templates/qa-report-template.md` was absent; this project's evidence/report format is used instead. This is recorded as an adapted workflow, not a full wrapper PASS. Telemetry remained disabled and no global tool upgrade was performed.

Private-app SEO guidance preserved noindex/robots protections; the existing design system, Tabler library and no-new-animation-library choice were retained. Karpathy guidance kept repairs tied to reproduced failures. Codegraph/worktrunk guidance was inspected, but no graph/worktree was needed for these small files and disjoint owners. Installed runtime and dependency changes remained project-local.

Unrelated email, cloud, blogging, external SEO audits, paid providers, native-store, publishing and account tools were not executed merely because they exist. Applicable skill selection is not permission for those actions. The inventory distinguishes metadata discovery, reference reading, native adapted review, script execution and unselected workflows.

## Expanded scope, subsequently requested

The user subsequently selected cloud synchronization, checkout and native iOS/Android applications and requested a deep plan. The earlier local-scope exclusions above are historical, not a refusal to evaluate those capabilities now. [Platform research](expansion-platform-research.md) records official-source investigation and additional engineering/SQL guidance. [Expansion planning](expansion-plan.md) ran the actual installed gstack autoplan runtime in CEO → Design → DX → Engineering order, with immutable snapshots, phase closure, fresh native reviews, 104 decision rows and actual aggregation of 26 tasks. The 15 implementation packages map all 46 new test groups. [The review record](expansion-review.md) records exact coverage. The external Claude Code reviewer could not be resolved; no cross-model result is claimed. Design image generation lacked a configured key; screen specifications and ASCII flows are present, without a generated-mockup claim.

The user master explicitly directs implementation after planning without another routine permission check. Work proceeds under that standing delegation, not a fabricated new human approval. External activation, account setup, charges and store submission retain their separate authorization and evidence requirements. Worktrunk is used for isolated implementation with explicit revisions; no global hooks or configuration are changed. Additional engineering-practices/ADR and Copilot PostgreSQL guidance informed the plan; pstack was inspected as a router without running a duplicate architecture workflow. Planning completion does not establish runtime correctness of the new integrations.
