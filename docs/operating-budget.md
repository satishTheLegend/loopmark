# Cloud operating worksheet

18 October 2026. Owner: root. Supports expansion decision C19 and CEO-T2. **Illustrative, unfunded planning scenarios—not a quote, forecast, measured load test or approval to activate services.** Actual account terms, observed usage, a funding owner and a monthly ceiling remain missing. No paid provider was enabled. Currency below is USD unless explicitly marked INR; no exchange rate is assumed.

## Verified price inputs

Supabase Pro starts at $25/month. Published allowances include 100 GB object storage and 250 GB each of uncached/cached egress; overages are $0.0213, $0.09 and $0.03 per GB respectively. Paid plans include $10 compute credit. Micro/Small/Medium compute list at $10/$15/$60 per month; an additional Micro staging instance therefore adds $10 after the production credit is used. These are planning inputs, not proof that a given compute size can serve the modeled users. [Supabase pricing](https://supabase.com/pricing)

RevenueCat advertises no fee up to $2,500 monthly tracked revenue, then 1% of tracked revenue at that threshold. Confirm the account's billing definition and non-consumable transaction treatment before using a final revenue model. [RevenueCat pricing](https://www.revenuecat.com/pricing)

Razorpay's public page currently contains a temporary introductory offer, a 2.15% + GST platform-fee line, and FAQ examples using 2% + GST. Do not select a single universal rate from that page or count the promotion as permanent savings. Obtain the merchant's approved method/currency/settlement/refund schedule. [Razorpay pricing](https://razorpay.com/pricing/)

Apple lists $99 per membership year, with local currency where available. Google lists a $25 one-time Play developer registration fee. These do not include sales commissions, tax, devices or eligibility/testing obligations. [Apple enrollment](https://developer.apple.com/help/account/membership/program-enrollment/), [Google Play registration](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en)

Database backups omit Storage object bytes, so a separate recoverable object copy is an explicit cost and operational requirement. [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)

## Scenario assumptions

These inputs are invented sensitivity assumptions, **not observed maker behavior or vendor quotes**. Replace them with pilot measurements and actual terms before funding approval.

| Input | Working assumption | Required replacement evidence |
|---|---|---|
| Active cloud accounts N | 100 / 1,000 / 10,000; count free and paid | Consented pilot enrollment and actual monthly activity |
| All accounts retaining cloud data R | Twice N: one dormant account for each active account | Actual retained libraries, including inactive and deletion-retention data; inactivity does not erase storage cost |
| Mean live binary media | 20 MiB/account | Measured distribution, including p95/max; not the 48 MiB serialized quota |
| Download traffic | Two complete library equivalents/account/month | Actual downloads, recovery/export and repeated-device traffic |
| Off-site backup transfer | One further library equivalent per retained account/month | Measured immutable-object churn, initial copy, deletion retention and restore drills |
| Backup bytes retained | Two live-library equivalents in an independent recovery location | Retention/versioning policy and measured changed/deleted bytes |
| Cache assumption | All modeled downloads/backups charged as uncached | Actual provider cache/egress meters; never count a cache discount twice |
| Production compute | Micro / Small / Medium for the three scenarios | Load tests and measured CPU/DB connections/query latency; these choices are allowances only |
| Staging | One continuously running Micro instance | Actual local/hosted CI and staging topology |
| Backup storage price | $0.03/GB/month placeholder | Selected backup provider's minimum, storage, request, retrieval and transfer costs |
| Authentication email | Four messages/account/month; $5 fixed + $1/1,000 messages placeholder | SMTP account quote, resend/abuse volumes and sending limits |
| Web hosting/domain | $6/month placeholder | Actual host, domain, build and bandwidth costs |
| Monitoring/backup job allowance | $5 / $15 / $50 per month | Real logging, request, function, reconciliation and scheduled-job meters |
| Support time | Four fixed hours/month + 2% of accounts × 12 minutes | Actual requests, deletion/purchase cases and on-call responsibility |
| Time valuation | $20/hour, shown separately | Owner's actual paid labor or explicit unpaid contribution |
| Contingency | 30% of modeled recurring cash subtotal | Owner-approved reserve based on uncertainty, not a provider hard cap |

One MiB is 1,048,576 bytes; modeled billing GB uses 1,000,000,000 bytes. The 48 MiB portable-library limit includes text and base64 overhead, so it must not be substituted for a raw-media allowance. The backup multiplier is a hypothesis about incremental retention; it does not mean two snapshots satisfy the required recovery objectives.

## Monthly scenarios

| Resource or cost | 100 active accounts | 1,000 active accounts | 10,000 active accounts |
|---|---:|---:|---:|
| All accounts retaining data (active + dormant) | 200 | 2,000 | 20,000 |
| Live binary media, GB | 4.19 | 41.94 | 419.43 |
| Off-site retained media, GB | 8.39 | 83.89 | 838.86 |
| Total modeled uncached transfer, GB | 8.39 | 83.89 | 838.86 |
| Production Supabase plan + assumed compute + modeled storage/egress | $25.00 | $30.00 | $134.80 |
| Additional Micro staging | $10.00 | $10.00 | $10.00 |
| Off-site storage placeholder | $0.25 | $2.52 | $25.17 |
| Authentication email placeholder | $5.40 | $9.00 | $45.00 |
| Web hosting/domain placeholder | $6.00 | $6.00 | $6.00 |
| Monitoring/jobs placeholder | $5.00 | $15.00 | $50.00 |
| Apple membership monthly accrual ($99/12) | $8.25 | $8.25 | $8.25 |
| **Illustrative recurring cash subtotal** | **$59.90** | **$80.77** | **$279.22** |
| **Subtotal with 30% illustrative reserve** | **$77.87** | **$105.00** | **$362.98** |
| Support hours, separate | 4.4 | 8.0 | 44.0 |
| Support time value, separate | $88.00 | $160.00 | $880.00 |

The subtotal excludes transaction fees/taxes, refunds/disputes, unspecified database/function/realtime overages, backup request/retrieval fees beyond the placeholder, new hardware, initial implementation, native maintenance and compliance work. It is **not the complete payable budget**. Apple accrual is a planning allocation, not monthly billing. Add the one-time Google fee separately when needed. A 10,000-account count does not establish sufficient Medium compute capacity.

The essential formulas are reproducible without a service connection:

```text
R = 2 * N  # all retained accounts, including dormant accounts
live_GB = R * 20 * 1048576 / 1000000000
backup_GB = live_GB * 2
active_download_GB = N * 2 * 20 * 1048576 / 1000000000
uncached_GB = active_download_GB + live_GB
production = 25 + max(compute_price - 10, 0)
             + max(live_GB - 100, 0) * 0.0213
             + max(uncached_GB - 250, 0) * 0.09
backup_placeholder = backup_GB * 0.03
email_placeholder = 5 + (N * 4 / 1000)
cash_subtotal = production + 10 + backup_placeholder + email_placeholder
                + 6 + monitoring_allowance + 99/12
support_hours = 4 + N * 0.02 * 0.2
```

Root executed these formulas with Python for all three scenarios; displayed totals round only after calculation. Independent arithmetic review identified the need to account separately for dormant libraries; the revised scenarios include them through R. The reviewer independently recalculated the revised rows and returned PASS within this illustrative, unfunded scope. No provider bill or performance result was inferred. Stress tests must vary R independently of N, then add a fleet-wide restore, a sustained retry storm, abusive sign-in requests and peak concurrent reconnects. New-enrollment controls do not cap costs incurred by existing users or attackers.

## Purchase economics and funding choice

Active users are not monthly purchasers. A previously upgraded maker produces no new sale merely by continuing to sync. For each channel, model **new verified purchases × actual localized price**, then subtract applicable store/payment fees, tax handling, refunds/disputes, RevenueCat fees and operating expense in the same currency. Keep India and international experiments separate. Sandbox payments, founder-funded purchases and research rewards are not evidence of voluntary demand.

For sensitivity only, 100/1,000 new purchases at the sample test price $6.99 produce $699/$6,990 gross once, before deductions. Under the advertised RevenueCat threshold, those tracked-revenue amounts imply $0/$69.90 for its line alone, subject to actual billing terms. They do not establish net proceeds or sustainable lifetime service. For INR web sales, retain the approved gateway percentage and fee tax as explicit inputs; the contradictory public rate lines above are not resolved by guessing.

| Approach | Benefit | Obligation / decision |
|---|---|---|
| Controlled subsidized pilot, provisional recommendation | Preserves the proposed one-time offer while learning actual usage | Name funding owner, amount, duration, enrollment limit and service-continuity reserve before activation |
| Separate recurring cloud offer | Could align recurring revenue with service cost | Material commercial change; requires a user decision and new pricing validation, not silently added here |
| Broad one-time launch | Fast availability across qualified platforms | Requires demonstrated funding/cost tolerance; quota and initial purchase revenue alone are insufficient |

## Funding and activation record

**Status: NOT APPROVED / NOT FUNDED.** CEO-T2 and public-cloud activation stay open.

| Required input | Current evidence | Owner / closing action |
|---|---|---|
| Billing owner, legal entity and approved providers | No account or merchant verification performed | Product owner confirms account eligibility; no credentials in this file |
| Monthly cash ceiling and committed funding duration | Not supplied | Product owner approves amount/currency and continuity reserve |
| Actual all-in costs | Public rates + explicitly synthetic allowances only | Operations replaces placeholders, adds taxes/fees and account quotes |
| Usage and capacity | No expanded-service pilot/load measurements | Engineering runs prescribed load/recovery tests; research measures use |
| Response responsibility | No operational assignee confirmed | Name alert recipient/on-call/support owner before activation |
| Cost alert implementation | Planned, not built | Alerts at 50/80/100% of approved budget with tests; avoid private craft data |
| Ceiling behavior | Planned: pause new cloud enrollment and notify operator | Keep existing reads/export and local capture; operator must fund or communicate a service transition |
| Funding decision and date | Absent | Record explicit approval without replacing missing answers with elapsed time |

The provider spend cap and application enrollment gate are different controls. Neither is a guarantee that existing reads, reconciliation, email or backup expense becomes zero. Public launch requires a funded response to that residual obligation and a tested way for makers to retrieve complete data.
