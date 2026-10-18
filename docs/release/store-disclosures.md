# Store disclosure worksheet

Status: **draft for the release owner; not submitted**. Complete this worksheet against the signed, configured build and actual provider contracts. Guest-only simulator behavior cannot justify a “no data collected” answer for an app that enables accounts, cloud or purchases. Apple requires the app's and its partners' collection practices to be represented in App Store Connect; inspect the current questionnaire before submission. [Apple app privacy](https://developer.apple.com/help/app-store-connect/reference/app-privacy/)

## Product listing and commercial terms

Describe Loopmark as a pause-and-resume craft notebook: latest photo, hook/needle size, row/repeat and next step, with optional voice note and earlier checkpoints. Three active projects are the proposed free allowance; the paid offer is a one-time capacity/history upgrade. Do not claim unlimited storage, an active subscription, proven habit improvement, customer testimonials or achieved pilot results. The documented technical ceiling remains 200 projects, 1,000 checkpoints and 48 MiB of portable content per collection.

The release owner must enter actual localized approved store/merchant prices, product IDs, refund/support policy, supported countries, seller identity and tax treatment. ₹299–₹599 and US$4.99–US$7.99 are experiment ranges, not live offers. Store products, server allowlists and displayed prices must agree; screenshots must come from the same qualified artifact and accurately show unavailable features when not enrolled.

## Data inventory to reconcile

| Data | App behavior and purpose | Disclosure decision/evidence needed |
| --- | --- | --- |
| Project names, craft details, notes, row and next step | Local by default; connected collections send saved records to the selected backend for synchronization | User content linked to the signed-in account when uploaded; identify selected cloud processors, region and retention |
| Selected/captured photos | Optional private craft checkpoint attachment; normalized before local persistence | Photo/user-content collection for connected collections; verify metadata stripping and actual network traces |
| Voice recordings | Optional local note; uploaded only as part of a connected saved checkpoint | Audio data/user content when uploaded; verify permission copy, interruption and removal behavior |
| Login email and account identifier | OTP/account verification and ownership | Contact information/account identifiers and authentication processor; inspect provider logs and retention |
| Device enrollment identifier and credential | Device-scoped synchronization identity; credential in native secure storage | Distinguish app-generated enrollment identity from advertising or hardware identifiers; verify the SDK configuration and network trace |
| Billing principal, transaction/product/environment and verified status | One-time purchase validation, refund/recovery and ownership protection | Purchase history/identifiers, provider retention and account linkage; no full payment instrument is stored by Loopmark code |
| Server operational metadata | Error codes, rate limits, queue/usage and deletion/recovery status | Inventory actual hosting/security logs, IP handling and retention before selecting diagnostics/usage categories |
| Complete exports and bag labels | User-initiated sharing through the OS; exports contain private notes and media | Warn before export; document that the selected destination controls its copy. QR code is a record shortcut, not cloud backup |

Apple explicitly categorizes free-form text and voice recordings within user-content/audio categories; map the configured behavior to the current form rather than copying the table mechanically. [Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/)

No advertising or cross-app tracking feature is implemented. RevenueCat diagnostics/device-identifier automatic collection and automatic promotional UI are disabled in the adapter, but the release owner must inspect the installed SDKs, provider documentation and signed-build traffic before asserting any tracking, sharing, encryption or diagnostic answer. Third-party processor handling cannot be inferred solely from application source.

## Permissions and privacy presentation

- Camera/photo access is for a user-requested checkpoint image. Selected-library access is sufficient; broad unrelated gallery/file access must not be added for release convenience.
- Microphone access is optional, begins through an explicit action, and is bounded to two minutes. Denial leaves text-only checkpoints usable; no background recording claim is made.
- Photos, notes, drafts and voice recordings must not appear in bridge logs, telemetry, notification previews or support bundles without an explicit reviewed action.
- Verify native privacy manifests, merged Android permissions/backup rules and each required-reason API in the actual archive. Package presence does not prove a compliant or accurate disclosure.
- Privacy and support URLs must work without login on the selected public host and name the real operating entity/contact. Account pages remain private/noindex. Do not submit placeholder contacts or a development localhost origin.

## Deletion, backups and recovery

Document both the in-app account-deletion flow and a functional external deletion-request path using the actual app/developer name. Google's account-deletion requirements include a discoverable external path when the app supports account creation. [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

Explain the distinct states: request accepted and access disabled; live craft data removed; historical recovery copies expired. Never equate uninstalling, signing out, deleting a local copy or deleting an account. Record the actual backup retention and billing/legal linkage retained by the operator/provider, and verify the receipt date against the latest retained recovery point. Existing downloaded copies, user exports and recipient-held files cannot be remotely recalled. A project-bag QR label is not a restoration source.

The current design uses seven daily service recovery points and a narrow deletion receipt/independent erasure ledger retained at least 90 days; these are implementation requirements to qualify against the selected hosting setup, not a claim of a deployed service. The local native database, media and credentials are excluded from automatic OS backup/transfer paths; users need a complete export or qualified account synchronization for intentional restoration. Physical OS backup/reinstall/key-loss tests remain required.

## Submission signoff

The release owner and privacy/security reviewer must record: exact signed artifact/hash; final app and provider identities; current permission/privacy-manifest inventory; network/SDK data inventory; completed store questionnaire exports; privacy/support/deletion URLs; precise backup/payment retention; tested deletion and ownership recovery; localized product/price screenshots; intended age rating and audience; and unresolved restrictions. Keep these evidence files private and hash them into the release manifest. No checkbox in this worksheet authorizes a submission, publication or live enrollment.
