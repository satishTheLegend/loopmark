# Authorized provider sandbox

This path is optional for contributors and requires authorized provider/store accounts. Do not substitute synthetic proof for provider qualification. Guest capture, local sync and unsigned native builds work without it.

Use a separately configured sandbox server, exact public app origin, and server-only secrets. Start with:

```sh
npm run doctor -- --capability provider-sandbox --json
```

Missing secrets/enrollment are reported as unconfigured. The doctor makes no purchase and cannot verify an account, product, webhook endpoint or store eligibility. Account approval, product review, sandbox-user creation and provider outages are external waits. Record them as blocked/unverified, not a passing implementation result.

## Web purchases

Razorpay uses hosted Payment Links. Set sandbox `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, an approved server product/price configuration, and explicit `LOOPMARK_RAZORPAY_ENROLLED`. Never put secrets in Vite variables. The client saves its attempt and original local draft before navigation; provider JavaScript does not execute on private craft routes. Only validated HTTPS `rzp.io` hosted links are opened. An expired link is not automatically replaced with a new charge. An explicit resume reuses the same attempt; return-query data never grants access.

Qualify purchase, user cancellation, lost callback, restart, duplicate/delayed webhook, refund, restore and evidence replay from another account. The server must verify authoritative provider records before publishing entitlement. A submitted SDK/hosted result remains pending until verification. Record the actual provider sandbox transaction IDs only in restricted qualification evidence, never public fixtures or logs.

## Native purchases

RevenueCat receives platform purchases, with separately enrolled iOS/Android public SDK keys and approved product IDs served by authenticated `billing-config`. Configure `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `LOOPMARK_REVENUECAT_PROJECT_ID`, `LOOPMARK_REVENUECAT_IOS_KEY`, `LOOPMARK_REVENUECAT_ANDROID_KEY`, and their product lists on the server. Test Store keys alone do not qualify real Apple/Google sandboxes.

Use real store sandbox users and the intended bundle/application IDs. Qualify purchase, cancellation, pending approval, restore, account mismatch and refund on each platform. An explicit native cancellation releases server admission; an uncertain/pending result must not be cancelled automatically. Lost callbacks retain the durable attempt for reconciliation. Purchases may unlock additional local projects while the original local collection remains local.

## Recovery and deletion

Recovery requires current account verification and fresh authorization where specified. Download the confirmed recovery key explicitly and keep it private. A saved historical key may have been superseded on another device; the current authenticated server status determines known supersession. Never transmit a key in a URL or ordinary diagnostic export. A successful recovery refreshes verified account/principal identity before caching entitlement.

Account deletion tests must use synthetic accounts and the independent erasure ledger. Preserve the chosen local copy before the barrier. An ambiguous deletion response is checked with the previously saved read-only receipt capability; it must not create a new request/key or silently log back in. Receipt and recovery-key downloads are user-owned secrets and require explicit user actions.

Read the canonical [billing wire](../../supabase/I08-wire.md) and [media/replacement/deletion wire](../../supabase/I07-wire.md). Local deterministic provider tests prove protocol behavior; only recorded real sandbox results qualify provider activation. No scripts in this guide deploy, publish or activate live billing.
