# Configuration boundaries

[.env.example](../../.env.example) lists supported values. Copy only needed settings into an ignored `.env.local`. Explicit process environment wins, including an empty value used to disable a setting. Unknown local overrides, duplicate ports, invalid origins and secret auth keys fail validation without printing their values.

| Public build setting | Meaning |
| --- | --- |
| `VITE_LOOPMARK_APP_ORIGIN` | Exact HTTPS app origin, or HTTP loopback for local development; no path/query/credentials |
| `VITE_LOOPMARK_SUPABASE_URL` | Exact backend origin; requires app origin and public key together |
| `VITE_LOOPMARK_SUPABASE_ANON_KEY` | Publishable or legacy anon key only; never service-role or secret key |
| `VITE_LOOPMARK_MEDIA_CONCURRENCY` | Integer 1–4, default 2; bounded media work, no quota override |

Public settings are bundled. A public key identifies a project; server authorization still verifies user identity, ownership and entitlement. Auth callback is derived as the app origin plus `/auth/callback`. Only the approved path, `code` and an optional single SDK `sb_flow_id` are accepted. Configure the exact Auth Site URL and approved callback, never a wildcard. Native callback/deep-link registration requires separate platform qualification.

| Local operator setting | Meaning |
| --- | --- |
| `LOOPMARK_DEV_PROFILE` | 1–32 lowercase letters/digits/hyphens; defaults to checkout-derived identity |
| `LOOPMARK_DEV_APP_PORT`, `LOOPMARK_DEV_API_PORT`, `LOOPMARK_DEV_DB_PORT`, `LOOPMARK_DEV_STUDIO_PORT`, `LOOPMARK_DEV_MAIL_PORT` | Distinct ports 1024–65535; reserve related database tooling ports too |
| `LOOPMARK_LOCAL_URL` | Optional HTTP loopback URL matching the selected API port; remote reset targets are refused |

Keep a profile stable while its database is in use. Worktree paths and profiles produce different defaults. Run doctor to inspect the resolved identity/ports. No local launcher command is a deployment command.

Server configuration is validated separately. `LOOPMARK_ENVIRONMENT`, `LOOPMARK_PROJECT_ID`, `LOOPMARK_APP_ORIGIN`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` belong only in the server environment. Cloud enrollment defaults off. `LOOPMARK_CLOUD_ENROLLED`, `LOOPMARK_RAZORPAY_ENROLLED` and `LOOPMARK_REVENUECAT_ENROLLED` enable capabilities independently; secret presence is insufficient. `LOOPMARK_PAYMENT_ENVIRONMENT` separates sandbox from production. The `LOOPMARK_ERASURE_LEDGER_URL` and `LOOPMARK_ERASURE_LEDGER_KEY` pair belongs to the independent erasure service. Do not place any of these in Vite variables.

Provider fields, native public SDK keys delivered by the authenticated server, and alert thresholds are documented in the env template and [provider guide](provider-sandbox.md). They never override ownership, revisions, free-project capacity, backup size or deletion generations. Expired/unavailable verification does not erase craft data; authoritative refunds revoke new paid actions when observed.

`npm run doctor -- --capability provider-sandbox --json` checks prerequisites and presence, not provider acceptance. A configured sandbox is not a live qualification result.
