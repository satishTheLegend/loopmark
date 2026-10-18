# I08 purchase contract

Status: canonical client/server contract; endpoints and provider qualification are separate implementation evidence. Strict types/schemas are in `src/domain/remote-contracts.ts` and `remote-schema.ts`. All user endpoints are authenticated active-owner POSTs; ordinary safe error envelopes apply. No client/provider SDK boolean grants access.

The audited server product catalog starts empty. Local tests use explicitly synthetic INR49900 fixtures. Actual market, price, tax presentation, provider/store enrollment and retention require the selected operator accounts. Enrollment and complete credentials are independent conditions; secrets never activate a provider.

## Web checkout

`checkout` accepts these actions:

- `{action:'products'}` returns `{products:LocalizedProduct[]}` from the active server catalog.
- `{action:'prepare',attemptId,productId,collection}` binds a stable UUID attempt to the verified account/principal and exact owned collection. Returns `CheckoutPreparation`: pending while Payment Link creation is unresolved, otherwise ready with attemptId, payment environment, paymentLinkId, checkoutUrl, expiresAt and exact localized product. The client cannot supply amount/currency/account/principal. Reusing an ID with different input rejects.
- `{action:'status',attemptId}` returns `BillingStatus`.
- `{action:'verify',attemptId,paymentId,paymentLinkId,paymentLinkStatus:'paid',signature}` checks the Razorpay signature against the server-stored link and attempt reference, then requests authoritative reconciliation. Returns BillingStatus; callback data alone never grants access.

`BillingStatus` contains `{entitlement,attempt,recoveryKeyConfigured,currentRecoveryKeyHash}`. The entitlement is the exact existing EntitlementProjection, scoped to the verified account/principal. The optional attempt contains only its UUID, provider and state. The UI preserves its own account/collection/generation/draft continuation and requires explicit Continue after verified entitlement.

The web adapter navigates to the provider-hosted Standard Payment Link after durably saving the attempt and draft continuation. Only exact HTTPS `rzp.io/i/<token>` or `rzp.io/l/<token>` links are accepted; no credentials, query, fragment, HTML, or checkout JavaScript is returned. The provider return URL is fixed to the configured app origin's `/purchase/return`. The callback parser validates its exact location and unique bounded parameters, strips all provider parameters before persistence, and matches the durable attempt. Callback data has no grant authority. Without a callback the saved attempt can still request authenticated status/reconciliation. No second checkout deployment is required.

Provider creation uses the attempt UUID as unique `reference_id`, disables partial payments, notifications and reminders, and sends no craft data or supplied customer contact. Lost create responses are recovered by reference lookup, with mismatched or multiple results rejected. Link payment IDs are fetched server-side; each payment must match the link's order, configured environment, exact price/currency and captured state. Refund and dispute verification determines current access; a paid link alone is insufficient.

## Native preparation and restore

`billing-config` uses the previously frozen `{platform}` request and NativeBillingConfig response. It reveals approved public SDK configuration only when native enrollment is active. The SDK identifies the existing verified billingPrincipalId before purchase and uses approved non-consumable store products.

`purchase-restore` accepts `{action:'prepare',attemptId,productId,collection}` before native purchase and returns `{status:'pending',attemptId}`. Native admission reservations expire after 15 minutes; the immutable attempt remains reconcilable. `{action:'cancel',attemptId}` releases an unresolved native intent after SDK cancellation and returns BillingStatus. It never refunds or suppresses a later provider-verified purchase; a successful observation resolves matching native intents. `{action:'reconcile',requestId,provider}` queues bounded authoritative discovery for the caller's existing principal; it never accepts another principal ID or transfers a receipt. `{action:'status',attemptId?}` returns BillingStatus. Native restore and SDK purchase completion trigger reconcile; neither grants access directly.

## Recovery keys and deleted-account recovery

The client generates a random 256-bit lower-hex recovery key and durably saves it before sending its SHA-256 hash. `purchase-recovery` `{action:'set-key',requestId,nextRecoveryKeyHash,reauthentication?}` installs the initial key on the caller's principal; replacing an existing hash requires fresh one-use reauthentication. Exact retry is idempotent and returns `{status:'key-saved',recoveryKeyHash}`. A lost response does not lose the key because the client already saved it. Export/display of the raw key belongs to the client; the server stores only hashes.

Recovery claim is `{action:'claim',requestId,provider,evidenceId,recoveryKey?,nextRecoveryKeyHash,reauthentication}`. The client saves the next raw key before the call. Provider verification and independent ownership evidence are required in addition to the key. Only a detached/deleted principal can bind to the new account, under the same principal lock used for grants. Insufficient evidence remains `{status:'pending',caseId}` for the verified support path; a screenshot or client transaction ID is not proof. Successful recovery returns `{status:'recovered',entitlement,recoveryKeyHash}`; the client adapts this into the existing PurchaseRecoveryOutcome using its saved raw next key. `{action:'status',requestId}` recovers the durable result. Old keys cease working after rotation. No craft records or old Auth identity are recreated.

## Provider evidence reviewed

Razorpay Standard Payment Links enforce a unique reference of at most 40 characters, expose reference lookup and captured payment IDs, and reject repeated creation with an existing reference. The authoritative payment response includes captured and refund state. [Create](https://razorpay.com/docs/api/payments/payment-links/create-standard/), [reference lookup](https://razorpay.com/docs/api/payments/payment-links/fetch-all-standard), [link lookup](https://razorpay.com/docs/api/payments/payment-links/fetch-id-standard), [payment lookup](https://razorpay.com/docs/api/payments/fetch-with-id/). The official SDK defines the callback signature over link ID, reference, status and payment ID. [Official SDK](https://github.com/razorpay/razorpay-node/blob/master/lib/utils/razorpay-utils.js)

Razorpay webhook validation covers the raw request body with HMAC; events can duplicate or arrive out of order. [Webhook validation](https://razorpay.com/docs/webhooks/validate-test/)

RevenueCat REST v2 uses a server project ID and a v2 secret API key. Per-purchase reads expose canonical purchase, current/original customer, product, environment and ownership/status; customer purchase discovery is paginated. The provider product ID maps to the approved store identifier in the server catalog. [Purchase API](https://www.revenuecat.com/docs/api-v2/purchase), [customer purchase discovery](https://www.revenuecat.com/docs/api-v2/customer/resources), [API authentication](https://www.revenuecat.com/docs/api-v2)

RevenueCat webhook authorization must match the configured secret. Webhooks trigger authoritative fetches and carry no direct grant authority. Store restore must retain the original identified App User ID; actual sandbox ownership/refund/reinstall qualification remains I14. [Webhook authentication](https://www.revenuecat.com/docs/integrations/webhooks), [restore behavior](https://www.revenuecat.com/docs/projects/restore-behavior)

The authenticated status exposes only the current principal's recovery-key hash (or null), allowing a device to mark previously confirmed local key exports as superseded after rotation. Historical operation receipts remain stable. Native recovery `evidenceId` is the original Apple transaction ID or Google Play order ID, resolved server-side to exactly one canonical RevenueCat purchase before fresh verification. Pending recovery status resumes the saved evidence lookup and ownership check, so support verification and temporary lease contention can progress without resubmitting secrets.
