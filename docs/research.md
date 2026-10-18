# Loopmark research and validation

Research date: **18 October 2026**. Status: desk research and a proposed field study; **no participants recruited, interviews conducted, purchases recorded, or market demand measured** during this build.

## Decision

Build a small craft checkpoint tool around the moment of putting work away and picking it up again. The opportunity to test is whether a maker will repeatedly leave a useful next step with little effort. Existing apps already cover much of the information storage. Offline storage, photos, and backup are useful requirements, but current research does not establish them as unique advantages.

## Evidence ledger

All sources below were accessed on **2026-10-18**. Product descriptions are vendor claims; we did not install or benchmark competing apps. None of these sources establishes willingness to pay for Loopmark.

| ID | Source and observed evidence | What it supports | Limits |
| --- | --- | --- | --- |
| S1 | [Supplied r/crochet discussion](https://www.reddit.com/r/crochet/comments/1998vwp/anyone_restart_a_project_they_put_down_for_a/): the author cannot remember their hook size after a pause. Replies describe losing row/repeat context, remembering changes, taking hook photos, keeping notebooks, texting themselves, and attaching inexpensive tags. | The proposed problem exists for some makers; people already solve it with low-effort methods. | A self-selected discussion, historical rather than a fresh interview study. No incidence rate, market size, geographic demand, or causal product evidence. |
| S2 | [Pocket Crochet's Google Play listing](https://play.google.com/store/apps/details?hl=en_IN&id=com.rfsp.pocketcrochet): advertises multiple counters, imported patterns, remembered pattern position, reference photos, yarn details, and archiving. The fetched listing showed an update dated 23 September 2026. | There is a direct, maintained competitor with substantial overlap. | Availability and experience were not tested on devices. Regional ratings and search snippets differed, so ratings are omitted rather than treated as a stable comparison. |
| S3 | [Pocket Crochet official site](https://pocketcrochet.app/): describes free core features, optional paid cloud storage/sync, manual backup/restore, and optional business tiers. | Manual recovery and optional cloud are already supplied elsewhere. A generic project tracker faces free alternatives. | The source was readable through the search index; the direct page extractor returned an empty body. Exact regional purchase prices were not verified. |
| S4 | [My Row Counter official feature guide](https://rowcounterapp.com/counter.html): documents row/repeat counters, reminders at selected rows, pattern drawing/annotations, and pattern imports. | Makers who want ongoing counting and pattern interaction have a specialized alternative. | Documentation review only; no comparison of capture speed, reliability, or usability. |
| S5 | [Ravelry's official overview](https://www.ravelry.com/about): describes a personal notebook for projects, stash, tools and pattern library, connected with patterns and community. | A broader existing craft notebook is another substitute. | We did not audit accounts, privacy settings, or the project-creation experience. |

## Alternatives and positioning

| Alternative | Why someone may prefer it | Loopmark must prove |
| --- | --- | --- |
| Paper tag or stitch marker in the project bag | Immediate, tangible, inexpensive, no phone or setup | Additional context/history is worth the extra recording step. |
| Photo album or existing notes app | Already installed; familiar capture and search | A project-specific next-step view makes later recovery meaningfully easier. |
| Pocket Crochet | Broad craft information and free core features | The pause/resume interaction is sufficiently easier for a focused use case. |
| My Row Counter | Active-session row/repeat tracking and pattern tools | A separate app is worthwhile for makers who chiefly need to restart. |
| Ravelry | Existing project notebook and connected craft reference | A local checkpoint is useful alongside the maker's existing system. |

The proposed message is: **“Leave yourself a good place to begin.”** Describe the saved tool, position, photo, and next step. Avoid claims such as “the first,” “the only,” “never forget,” or “faster than Pocket Crochet” until tested.

## Three product approaches considered

| Approach | Strength | Cost or tradeoff | Decision |
| --- | --- | --- | --- |
| Printable restart tags plus a notes template | Cheapest experiment; puts facts beside the craft | Weak history/search; tags can be lost; does not test a complete digital workflow | Keep as the baseline substitute and offer a printable label in the app. |
| Local browser app with quick checkpoints | One accessible implementation across desktop and phone; no account needed; can test the complete loop | Storage belongs to that browser/site; media and microphone behavior vary; users must export a backup | **Selected first release.** Focus on capture, recovery, and portability. |
| Native craft organizer with cloud sync | Stronger distribution/device integration and possible cross-device continuity | Store release, accounts, sync conflicts, operational costs, and much more overlap with incumbents | Defer until use and payment evidence justify those commitments. |

This is a product judgment based on the narrow job and delivery constraints, not a measured winner between variants.

## Assumptions to falsify

| Assumption | Smallest useful evidence | Failure signal |
| --- | --- | --- |
| Makers remember to capture at a natural pause | A participant saves a checkpoint without a researcher prompt after onboarding | Most saves follow reminders or happen only during observed sessions |
| A compact checkpoint contains enough context | After at least seven days, the maker can identify the tool, position, and next physical action | They must reconstruct missing instructions or seek help |
| Keeping a next step is worth switching behavior | Repeated voluntary use alongside or instead of the existing method | The maker consistently returns to a tag or their notes app |
| Multiple unfinished projects create a paid need | Qualified participants purchase a clearly stated capacity upgrade | Positive comments and upgrade clicks fail to become purchases |
| Manual export is understandable | A participant restores their own file into a clean test browser | They mistake a QR label or local save for a backup |

## First cohort: 15 makers

Recruit **15 people with at least four unfinished crochet, knitting, or closely related projects**, including one they realistically expect to pause and resume during the study. Record craft, device/browser, project count, current recording method, recent restart difficulty, and recruitment channel. Do not recruit only friends or people who have already praised the idea.

Run a **21-day feasibility study**. This is a small, purposive cohort with go/no-go criteria; it is not a statistically powered price or conversion A/B test.

1. **Day 0:** show a short example once, obtain consent to the study, observe a first checkpoint, and test that the participant can find it again. Record every instruction or rescue. The onboarding checkpoint does not count as voluntary use.
2. **Days 1–14:** let participants use their own projects. Do not send behavior reminders. Provide technical support only when requested and log it. A brief scheduled study check-in can collect facts but must not tell people to make a checkpoint or restart.
3. **Days 8–21:** count a restart only when at least seven full days have elapsed since its saved checkpoint. Ask the maker what they actually did next, whether the saved details were sufficient, and what other source they needed. A button press alone is insufficient evidence.
4. **After demonstrated value:** present one honest, deliverable paid offer at a preset price. Keep the same price and terms within that cohort. Record actual settled purchases and refunds separately from stated interest. This needs real payment and entitlement operations before the paid criterion can be evaluated.
5. **Day 21:** close the cohort as planned and report all 15 participants, including dropouts, support burden, and missing data. Do not quietly extend until thresholds pass.

### Prespecified decision thresholds

Continue exploration only if all three user-proposed thresholds are met:

- **10 of 15** save at least one useful checkpoint voluntarily after onboarding.
- **8 of 15** use a saved checkpoint to restart after at least seven days.
- **5 of 15** make an actual purchase under the stated offer.

Keep these denominators at 15. Report whether purchasers are also successful resumers. If fewer than eight people have a natural restart opportunity, report the cohort as inconclusive for that measure, with the original denominator and counts visible. A subsequent study can recruit for a better observation window.

Track secondary measures without substituting them for the thresholds: median and range of capture time; missing tool/position/next-step facts; confidence before and after reading; voluntary saves per person; number of researcher reminders; help minutes per person; failed restores; and reasons for choosing a paper tag or another app. Any apparent improvement over a participant's prior method is exploratory because this design does not isolate causality.

### Data collection and privacy

Use a separate consented study sheet with anonymous participant codes. Record event dates and summarized outcomes; avoid collecting project photos or voice recordings unless specifically needed and consented to. The local app need not send telemetry. Ask participants to report use or voluntarily share an export after they understand that it may contain all their project media. Keep research results separate from demo fixture data.

## Pricing hypotheses

The user's proposed package is **three active projects free**, with a **one-time upgrade** for more projects and additional history. Proposed ranges are **₹299–₹599 for India** and a **separate US$4.99–US$7.99 international test**. These are hypotheses supplied with the brief, not validated willingness-to-pay estimates or currency conversions.

For an initial Indian cohort, a practical preset is **₹399 one time**; for a later separate international cohort, **US$5.99 one time**. These midpoint choices are experiments, not optimized prices. Do not split only 15 participants among several prices and claim a winning price. Capacity is easier to explain than charging per checkpoint, but free alternatives may still make the offer unattractive.

The research build has unrestricted projects and history so evaluation is possible without a pretend checkout. A future paid implementation must keep existing records readable and exportable. Do not remove saved history when a plan changes. Full backup/restore is a baseline data-ownership requirement. Define whether “one time” covers the purchased release, future updates, and device restoration before selling; no cloud service is included in this proposed offer.

## Initial acquisition experiment

Prepare a 45–60 second demonstration with one real project: pause, save a checkpoint, return at least a week later, and follow the next step. Show capture time honestly and disclose any time jump. Use this artifact in opt-in recruitment through a craft teacher, a small workshop, or a creator who discusses unfinished projects. A printable tag can be the invitation's useful takeaway.

Before any community post, read that community's current promotion/research rules and use its permitted channel; contact moderators when required. No posts, creator messages, email outreach, or campaigns were sent in this build. Track recruitment source and qualification rate manually before spending on ads. A channel is useful only if it brings eligible makers who use the tool without continuous founder prompting.

## Research gaps and next decisions

- No interviews, observed craft sessions, week-later restarts, or payments have been conducted.
- No exact competitor regional purchase prices, native device trials, or timed competitor comparisons were obtained.
- The supplied discussion is useful qualitative evidence, not a representative sample or a recent trend study.
- The working name **Loopmark** has not undergone trademark, app-store name, or domain clearance.
- Test real phone storage retention, microphone permissions, and backup restoration before asking makers to trust the app with their only record.
- Broader organizing, pattern import, cloud sync, reminders, and subscriptions should wait for evidence that they improve the central loop.

