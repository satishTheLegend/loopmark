# Skill selection and execution record

Recorded on **18 October 2026**. The complete local metadata inventory is [skill-register.json](./skill-register.json). It contains **1,964 readable `SKILL.md` manifests**, not 1,964 executed workflows.

| Discovery root | Manifests |
| --- | ---: |
| `/Users/lalaji/.codex/skills` | 171 |
| `/Users/lalaji/.agents/skills` | 14 |
| `/Users/lalaji/.codex/skill-libraries` | 1,727 |
| `/Users/lalaji/.codex/plugins/cache` | 52 |

Discovery recursively followed directory symlinks and deduplicated resolved directories within each root to avoid loops. No read errors occurred. Every manifest exposed a description; **349** declared a version field. A missing version remains `null`; folder versions and repository commits were not substituted for an undeclared skill version. The inventory records name, description, location, availability, declared version, selected phase, invocation and disposition. It is a snapshot of these roots, not a claim about remotely available packages.

## Applied guidance

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

The global `gstack-autoplan/SKILL.md` was discovered and its installed behavior was read by the architecture agent. Applicable product → design → engineering review order informed native coordination. The full runtime and external-model wrapper were **not invoked**; no full autoplan result or cross-model consensus is claimed. See architecture.md for the adapted review coverage.

## Skills not selected

**1,948** other manifests were cataloged as not selected. Their metadata was considered for routing; their workflow bodies were not interpreted as instructions or executed. The reasons are task scope and overlap:

- Cloud infrastructure, authentication, multi-tenancy, native app distribution, AI integration, email and enterprise systems do not serve the selected local release.
- Broader SEO, blog, scientific, document/spreadsheet, presentation, and connected-account workflows are outside this artifact's needs.
- Additional planning/design/review collections overlap the chosen routes; adding them would duplicate process without a specific unanswered question.
- Publishing, outreach, payment processing, telemetry, provider connections and expensive external jobs are separate actions. Discovering a skill does not authorize any of them.

Counts by status are **13 guidance applied**, **1 script executed**, **1 partial reference**, **1 reference inspected**, and **1,948 not selected**. Actual build/test commands and limitations must be read from the project delivery evidence, not inferred from this skill catalog.
