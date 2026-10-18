# Platform research for cloud, purchases and native apps

Research inputs for the expansion plan, accessed **18 October 2026**. These are proposed decisions, not implemented integrations or accepted commercial terms. Official provider documentation supports the factual statements below; architectural recommendations and cost scenarios are explicitly identified as our analysis. No account, subscription, installation, deployment, payment or external publication was performed.

## Recommendation and decision-changing findings

Retain the tested React interface, package it with Capacitor, and use Supabase Auth/Postgres/private Storage behind an explicit durable sync protocol. Prefer RevenueCat's official Capacitor SDK for native purchases if its account-transfer behavior and commercial terms are accepted. Use an activated Razorpay merchant account for web checkout if eligible; use Stripe only after actual India account eligibility is confirmed. Keep guest capture, local drafts and independent export available.

The release cannot treat realtime events as offline sync, a checkout return URL as purchase verification, or a native wrapper as store acceptance. The most consequential constraints are:

- **Backup capacity:** the current app permits a 48 MiB serialized collection and a 50 MiB backup file. A proposed 100 MiB cloud allowance exceeds the current full-export contract. Either retain the current serialized-equivalent envelope and record limits initially, or require a new scalable export/import format before larger collections are accepted. Binary media expands by approximately four thirds in base64, before JSON overhead. This is a local implementation finding, not a provider limit.
- **Cloud recovery:** Supabase database backups contain Storage metadata, not the stored object bytes. Production recovery needs a separate object backup and a restore drill that checks every referenced media hash. [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- **Deletion:** deleting a Supabase auth user does not immediately invalidate an already-issued access JWT; an auth user owning Storage objects cannot be deleted until those objects are removed or reassigned. [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data)
- **India checkout:** Stripe's India offering remains invite-only. Its export flow requires a registered Indian business, not an individual account. Razorpay international acceptance also requires eligibility and activation; neither provider is an assumed available credential. [Stripe India exports](https://docs.stripe.com/india-accept-international-payments), [Razorpay international payments](https://razorpay.com/docs/payments/international-payments/)
- **Native purchases:** a permanent digital upgrade maps to a non-consumable product. Web checkout and native store billing are separate purchase channels, even when they confer the same application entitlement. Regional external-payment exceptions exist and must be checked for the actual storefronts at submission. [Apple product types](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-types/), [Google Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)
- **RevenueCat delivery:** webhook retries are finite, and duplicate delivery is possible. A durable event inbox and reconciliation are required; a webhook handler alone is insufficient recovery. [RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks)

## Repository baseline and guidance actually used

Read `docs/specification.md`, `docs/requirements.md`, `docs/architecture.md`, `docs/expansion-plan.md`, `package.json`, `src/types.ts` and the current backup/data contracts. The app is a React/Vite PWA with IndexedDB, local media, immutable checkpoints, local revision checks, and a separate unfinished-draft database. It has no cloud/auth/billing/native SDK implementation. Browser tests do not establish native WebView storage, microphone, lifecycle or purchase behavior.

Applied the already-loaded brainstorming and gstack routers for scoped planning, and the SEO router for the distinction between private project content and future public support/privacy/deletion pages. Read the engineering-practices and copilot-skills routers, then selected `documentation-and-adrs/SKILL.md` from the Addy Osmani collection and `postgresql-code-review/SKILL.md` from the GitHub Copilot collection. Used their guidance on decision rationale, alternatives, schema constraints, grants and RLS. This was not a SQL implementation audit or a completed gstack phase review; root coordinates those reviews. No skill telemetry or optional provider action was run by this research task.

## Three viable approaches

| Approach | What it preserves | Added work and limitations | Recommendation |
|---|---|---|---|
| React + Capacitor + Supabase durable sync + RevenueCat | Current DOM UI, validation, tested product behavior; one shared purchase entitlement contract | Native bridges/storage proof, server sync engineering, vendor purchase mapping and fees | Smallest credible extension; preferred |
| React + Capacitor + Supabase + direct StoreKit/Play verification | Same interface reuse; ownership of billing implementation | Two native purchase integrations, signed transaction/token verification, notification pipelines, acknowledgements, restore and reconciliation maintenance | Viable if reducing purchase-vendor dependence outweighs engineering/operations cost |
| Expo/React Native + Supabase, with incremental DOM screens where useful | Domain logic and some existing web screens | New Expo/Metro integration, native layout/persistence/media work, mixed DOM/native accessibility and keyboard boundaries | Consider if measured native interaction needs exceed wrapper capabilities |

Capacitor supports adding native projects to an existing modern JavaScript app with `package.json`, a built web-assets directory and `index.html`; its sync step copies built assets and native dependencies. The current repository has the required web shape. This establishes feasibility, not a working native build. [Capacitor overview](https://capacitorjs.com/docs), [adding Capacitor](https://capacitorjs.com/docs/getting-started)

Expo now supports incremental DOM components through `'use dom'`, so a statement that Expo necessarily requires a complete immediate rewrite would be inaccurate. Those components run through its WebView integration; adopting this still introduces Expo's toolchain and another boundary to test. [Expo DOM components](https://docs.expo.dev/guides/dom-components/)

Our assessment: begin with a small Capacitor feasibility slice covering process death during capture, a real microphone recording, file export/import, secure session storage and a purchase sandbox. Choose a transactional native store and media-file adapter only after this proof. Do not assume Safari/PWA IndexedDB is shared with a packaged app; plan explicit backup or cloud migration. Native camera/microphone permission descriptions, keyboard/safe areas, Back behavior, accessibility, deep links and durable file paths remain release work.

## Supabase feasibility and the offline boundary

Supabase Auth supplies managed authentication; Postgres can own transactional operations, constraints and per-user records. Enable RLS and minimum grants together in migrations. A public/publishable client key does not make ownership checks optional. Policies must cover reads and writes with the authenticated owner, including related checkpoint/media rows. [Supabase Auth](https://supabase.com/docs/guides/auth), [Postgres RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

Storage authorization uses policies on `storage.objects`; uploads require suitable policies, and service credentials bypass RLS. Keep buckets private and service secrets only on the server. [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

Realtime supplies WebSocket broadcast/presence/database change mechanisms. Its architecture describes connected replication and finite retention for broadcast messages. **Inference:** these capabilities do not by themselves specify Loopmark's durable offline queue, conflict resolution, replay cursor or media commit semantics. Use realtime only to trigger a durable pull. [Realtime architecture](https://supabase.com/docs/guides/realtime/architecture)

Recommended application protocol:

1. Commit the local domain change and outbox operation in the **same local database transaction**. Keep draft autosave separate and local. A network failure must not change a successful local-save result.
2. An authenticated RPC accepts operation ID, payload hash, schema version, entity ID and expected server revision. Derive owner from the verified session; never trust client `accountId`. Write the operation receipt and domain effect atomically. Repeating an ID with the same payload returns its committed result; a different payload is rejected.
3. Use server revisions for concurrency and a durable ordered change cursor for catch-up. Client capture timestamps remain display metadata. Concurrent checkpoints append; conflicting metadata edits show both versions instead of silently overwriting one.
4. Record deletion tombstones and collection epochs. Reject stale operations against a deleted project or replaced collection. A device older than the retained cursor boundary must rebase before uploading. Local draft receipts are not a replacement for permanent server operation deduplication.
5. Apply a pulled page and its cursor atomically. Scope outbox workers, caches, listeners and auth refresh to an account generation; account switching must cancel or reject prior-account completions. Coordinate browser tabs so retries do not create competing sync loops.
6. Upload media to private staged paths, validate bytes/hash/type/quota server-side, then attach it to an accepted checkpoint. Keep incomplete attachments visibly pending. Garbage-collect only unreferenced staging objects after a retention window. Never store signed URLs as the permanent media value or in exported backups.
7. Import/restore must state whether it affects a local collection or the connected cloud collection. Use an explicit collection-replacement command with a revision/epoch check for cloud replacement. An offline restore should remain a separate recovered local collection until the user chooses its destination.

These are proposed invariants, not claims that Supabase implements them automatically. RPCs need safe privileges and search paths; owner foreign keys, unique operation receipts, quota counters and indexes belong in migrations. Test policies using ordinary user tokens for two accounts, not only administrator credentials.

Export remains a first-class consistency operation. Capture a stable manifest, obtain all required media, and verify hashes before reporting a full backup. An offline device with only partial cloud media cannot claim that its metadata-only file is a full backup. Preserve v1 imports. If raising capacity, specify a bounded-memory archive format, media manifest, migration/version limits and atomic restore behavior before accepting larger data.

For deletion, mark the account disabled in a server-authoritative row checked by policies/RPCs, stop synchronization, revoke sessions, delete media and owned records in an idempotent job, then delete the auth user. Test the old unexpired JWT against every data path. Already-issued signed media URLs require a defined expiry/deletion treatment. Object backups and legally retained payment records need disclosed retention rules; do not promise immediate disappearance from every backup.

## Store rules and account requirements

Apple normally requires IAP for digital feature unlocks and a restore mechanism for restorable purchases. Its multiplatform rule permits access to purchases made elsewhere subject to its conditions. The US storefront has a specific external-link exception; other storefronts have different entitlement/program conditions. Apple also evaluates whether an app provides sufficient utility beyond a repackaged website. Default to native IAP for this release and review market-specific exceptions separately rather than embedding Razorpay checkout universally inside the native shell. [Apple review guidelines, 3.1 and 4.2](https://developer.apple.com/app-store/review/guidelines/)

Google normally requires Play Billing for digital features in Play-distributed apps, with stated exceptions/programs. A non-consumable upgrade must be acknowledged after entitlement is granted; failing to acknowledge within three days can cause automatic refund and revocation. Consuming a product enables repurchase, so do not consume the permanent upgrade. [Google Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738), [Play Billing integration](https://developer.android.com/google/play/billing/integrate)

Account creation brings deletion obligations. Apple requires initiating account deletion inside the app. Google requires an in-app path and an accessible external deletion request resource; optional account creation still counts. Build a public deletion page and a retriable in-app flow, and distinguish deletion from sign-out/deactivation. These are platform requirements, not a legal opinion on all applicable retention or tax law. [Apple account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion), [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111)

Proposed identity rule: require a Loopmark account before a cross-platform purchase, while leaving ordinary guest capture available. Use a stable internal UUID for purchase identity, not an email address. Explain account binding before payment. A restore can reinstate an entitlement; it must never transfer project ownership. Define the support path for store-account/Loopmark-account mismatch, deleted-account purchases, reinstall and device changes before launch.

## RevenueCat versus direct store validation

RevenueCat has an official `@revenuecat/purchases-capacitor` SDK that wraps native store purchases. Its setup still requires native capabilities, keys, configured store products and Android lifecycle configuration. The SDK is not currently installed in this repository. [RevenueCat Capacitor installation](https://www.revenuecat.com/docs/getting-started/installation/capacitor)

RevenueCat tracks one-time purchases and supports non-consumable lifetime entitlements. Its non-subscription guide has a broad Android table followed by a more specific note: Android SDK 7.11.0+ supports non-consumables; older versions consumed purchases. Verify the selected Capacitor SDK's bundled Android version and product configuration in the feasibility test. Configure platform server notifications so refunds are observed. [RevenueCat non-subscription purchases](https://www.revenuecat.com/docs/platform-resources/non-subscriptions)

Provide a user-triggered Restore purchases action. RevenueCat warns that `restorePurchases` can prompt for OS sign-in, and that its configured transfer behavior governs purchases already associated with another app user. Programmatic sync can also alias/transfer anonymous users. This makes identity and transfer configuration a product/security decision, not a harmless SDK default. [RevenueCat restore purchases](https://www.revenuecat.com/docs/getting-started/restoring-purchases)

Its current webhook documentation supports an authorization header and optional HMAC signing of the timestamp plus raw body. Retries reuse the event ID, may duplicate delivery, and stop after five retries over approximately 80 minutes. **Design:** authenticate, durably enqueue, acknowledge promptly, deduplicate by event ID, and reconcile authoritative customer state after processing or missed delivery. Acknowledge only after the inbox write is durable. Separate sandbox and production grants. [RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks)

Direct integration is viable: StoreKit exposes current non-consumable entitlements and omits refunded/revoked purchases; Apple's server API returns signed transaction information independently of whether the app is installed. A direct implementation owns signed-data verification, transaction/account mapping, notifications and reconciliation, plus Google's verification and acknowledgement flow. [StoreKit current entitlements](https://developer.apple.com/documentation/storekit/transaction/currententitlements), [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi), [Play Billing integration](https://developer.android.com/google/play/billing/integrate)

Recommendation: choose RevenueCat if reducing platform maintenance is worth the service dependency and accepted data processing. Keep a provider-neutral entitlement ledger so Razorpay purchases and verified native purchases resolve to the same account permissions. RevenueCat does not replace Razorpay merchant activation, server access control or Loopmark's account recovery policies. Do not assume a Razorpay-to-RevenueCat integration without separate verified support; our ledger can combine the independent sources.

## India and international web checkout

| Provider | Verified constraint | Proposed use |
|---|---|---|
| Razorpay | International methods require eligibility/activation; requirements differ for registered businesses and individual freelancers. Supported currencies have differing minor-unit rules. | First candidate if the user's actual merchant account and required payment methods are approved; server creates and binds an order before opening checkout. |
| Stripe India | Invite-only. Export onboarding requires a registered business, service description and required customer details; purpose codes and, in applicable cases, IEC are relevant. India documentation describes INR settlement. | Alternative only if the user has or obtains an eligible activated account; do not design launch around an assumed new signup. |

[Razorpay international payments](https://razorpay.com/docs/payments/international-payments/), [Stripe India exports](https://docs.stripe.com/india-accept-international-payments/)

Razorpay requires server-side checkout-signature verification using the server's stored order ID, and payment status must be checked for capture. Its webhooks can duplicate and arrive out of order; signatures cover the raw request body. [Razorpay checkout verification](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test/)

If Stripe is selected, its fulfillment guidance likewise requires server fulfillment that tolerates concurrent/repeated calls, with webhooks to handle customers who never reach the return page. [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment.md?payment-ui=stripe-hosted)

Recommended shared contract: the server allowlists product, market, currency and amount; stores a stable account-bound purchase attempt; verifies provider signatures and authoritative payment state; and records one entitlement transition per verified transaction. The browser callback only starts verification. Handle cancelled, pending, captured, refunded and disputed states. A delayed old paid event must not resurrect a refunded grant; reconcile provider state when ordering is ambiguous. Never calculate taxes, currency conversion, provider fees or merchant eligibility from an unverified assumption.

The existing ₹299–₹599 / US$4.99–US$7.99 ranges remain demand-testing hypotheses. Native localized prices come from store product metadata, while web prices come from the server's configured catalogue. Avoid claiming a universally identical charge or settlement amount across currencies, storefronts, tax treatments and providers.

## Costs and the one-time promise

Sell a one-time project/history feature upgrade with explicit technical limits. State cloud storage allowance and service terms separately. A one-time payment cannot fund an unspecified infinite stream of new media, traffic, email and support by assumption. Do not remove access to saved notes or exports when a user reaches quota or loses a verified entitlement; restrict new over-limit actions with clear recovery options.

Verified public pricing at the access date: Supabase Pro starts at **US$25/month**, with one project included, 100 GB file storage, 250 GB uncached egress and 250 GB cached egress. Published overages include **$0.0213/GB storage**, **$0.09/GB uncached egress**, and **$0.03/GB cached egress**. Additional compute/projects and other metered services can add cost. [Supabase pricing](https://supabase.com/pricing)

RevenueCat advertises a free tier up to **US$2,500 monthly tracked revenue**, then **1% of tracked revenue**. Confirm the exact invoice treatment for one-time products, all tracked channels and the threshold with the selected account/terms before budgeting; the public FAQ body was not exposed in the retrieved page. Store commissions/payment processing are additional. [RevenueCat pricing](https://www.revenuecat.com/pricing)

| Cost item | Planning formula / input | Illustrative assumption, not a forecast |
|---|---|---|
| Stored media | accounts × cloud adoption × mean stored binary GB, plus retained recovery copies and staging | 1,000 cloud accounts × 20 MiB ≈ 20.97 decimal GB; 10,000 ≈ 209.72 GB |
| Media transfer | new uploads + downloads per device + reinstall/recovery/export traffic; split cached and uncached provider meters | Two full downloads/month of a 20 MiB library for 1,000 accounts ≈ 41.94 GB, excluding changes and other traffic |
| Backend | selected base plan + compute + storage/egress overages + database + functions/realtime/auth overages | One Pro project has a $25/month published starting point; staging, backup copies and email are additional inputs |
| Purchase handling | verified native tracked revenue × contracted RevenueCat rate, plus applicable store fees; web revenue × activated merchant quote | No universal 15%/30% store fee or fixed India processing rate assumed |
| Operations | email delivery, independent object backups, monitoring, domain, developer memberships, support/refunds | Obtain current account-specific prices; not included in the base hosting figure |

Net one-time contribution equals collected price minus taxes borne, store/processor/service fees, refunds and acquisition/support costs. Compare that contribution with expected retained-user hosting cost over an explicitly chosen horizon. Use measured media size, retention and transfer distributions before setting quota or claiming profitability. Revisit the cloud funding model if that budget does not close.

## Required prerequisites and proof before implementation claims

| Area | User/provider prerequisites | Evidence required |
|---|---|---|
| Backend | Owned Supabase account/project, region and spending decision, secret ownership, email delivery and redirect domain | Local migration and RLS tests; actual staging auth; full database-and-object recovery drill |
| Web payment | Actual business/entity/country details, activated merchant account, supported markets, settlement/KYC/tax configuration, refund/support policy | Provider test order, verified webhook, refund and delayed-payment recovery; live availability reported separately |
| Native distribution | Apple/Google developer accounts and agreements, app/bundle IDs, signing/provisioning, products, sandbox testers, build toolchain and physical devices | Reproducible platform builds; real store sandbox purchase/restore/refund; physical media and lifecycle tests |
| RevenueCat, if chosen | Owned project, store credentials/integration, stable account IDs, transfer policy, commercial/privacy acceptance | Correct non-consumable purchase and restored account behavior; webhook failure/reconciliation proof |
| Privacy/operations | Public support, privacy and deletion pages; contact/retention decisions; release owner | Account deletion, old-token rejection, backup retention wording and operational runbooks reviewed |

These are prerequisites to verify, not requests to paste secrets into chat or the repository. Local interface work and deterministic contract tests can proceed without live credentials, but cannot be reported as live billing, production sync or accepted store distribution.

Root's local preflight on this date found Xcode 27.1 (build 27A9275), a reachable Docker engine 29.8.0, adb 37.0.1 on Darwin arm64, and Bun installed. This is reported local-tool evidence, not an independently repeated check by this researcher. It establishes neither signing identities nor physical-device access or provider accounts. The actual gstack preflight did not resolve a Claude Code CLI; no Claude-driven review is implied by this research report.

## Failure cases that must shape the plan

| Failure | Required outcome / test |
|---|---|
| Kill immediately after local save or before sync acknowledgement | Local item and outbox recover together; retry produces one server effect |
| Two devices append or edit while offline | Both checkpoints survive; stale metadata becomes an explicit conflict |
| Delete/restore on one device, then reconnect an old device | Tombstone/epoch prevents resurrection; user may deliberately recover a copy |
| Account A request completes after switching to B | No A record, media, draft or entitlement appears in B; old session completion rejected |
| Upload succeeds but metadata commit fails | Retry uses verified staged content; later cleanup removes only true orphans |
| Quota or signed URL expiry during export | Local saves remain; export states missing content and never claims a complete backup |
| Clock skew, duplicate ID or old client schema | Server revisions/receipts/version validation prevent overwrites and duplicate effects |
| Payment succeeds but browser/app closes | Server reconciliation grants once; reopening shows verified state |
| Pending/cancelled purchase, acknowledgement failure or refund | No premature grant; retry/reconcile converges without deleting user content |
| Webhook outage beyond retry window, duplicate or reversed order | Durable inbox/reconciliation converges; stale events cannot reinstate revoked access |
| Restore under a different app/store account | Explicit account resolution; no silent purchase transfer or project merge |
| Delete account with unexpired JWT and existing media | Access stops promptly; staged deletion completes idempotently with visible status |
| Native background recording, permission denial or process death | Draft recovery and playable media proven on physical iOS/Android devices |
| Backend disaster with only a database restore | Missing objects detected; independent media recovery restores referenced hashes |

## Amendments to feed into the main plan

The current `docs/expansion-plan.md` aligns with the recommended React/Capacitor, explicit outbox, RPC, revision, tombstone and entitlement approach. During research the root corrected the proposed 100 MiB cloud allowance to the existing 48 MiB serialized envelope and added immediate disabled-account authorization and durable webhook reconciliation. The phase review must retain those repairs and add explicit database-plus-object recovery. Record the native purchase selection and restore-transfer policy after the feasibility slice. Keep public store/support/deletion pages indexable as appropriate while project/account routes and personal metadata remain private and excluded from indexing.

All linked official sources above were accessed on 18 October 2026. Provider terms, prices, SDK support and storefront exceptions must be rechecked at the implementation/submission gate; these findings do not establish account activation, legal compliance or store acceptance.
