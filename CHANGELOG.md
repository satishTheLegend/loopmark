# Changelog

## Unreleased expansion

- Added normalized local repositories, durable checkpoint/media drafts, verified legacy migration and separate recovered collections for imports.
- Added optional accounts, fenced offline sync, explicit connection previews, conflict recovery, complete media export and account deletion receipt continuation.
- Added native SQLite/filesystem/secure-storage bridges and separate unsigned iOS/Android verification paths.
- Added hosted web and native purchase coordination, verified entitlement caching, original-draft continuation and purchase recovery. Provider activation still requires real sandbox qualification.
- Added project file availability, protected download removal, and reviewed iOS/Android backup-file intake with durable repeated-file handling.
- Fixed first-install update-banner movement, unchanged sync polls invalidating reviews, and obsolete sync completions replacing a newly selected collection.
- Fixed initial sync scheduling after delayed sign-in recovery while preserving queued action order and account ownership.
- Invalidated the previous cloud acknowledgement immediately after local changes while their new sync state is being checked.
- Added public help and explicit account/storage states while preserving private-route indexing protections.
- Added executable contributor examples and separate guest, local backend, native and provider setup guides.

These entries describe source changes, not a published release or live deployment. Consult [release readiness](docs/release-readiness.md) for actual evidence and remaining external gates.

## 1.0.0 foundation

Local craft projects, checkpoint photos/voice notes, resume/history, readable bag labels and portable JSON v1 export/restore form the preserved foundation. No historical public release date or store availability is asserted.
