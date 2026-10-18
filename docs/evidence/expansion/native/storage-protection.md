# Native device protection boundary

The native SQLite database is in the application's private OS sandbox and is explicitly opened with `no-encryption` in `src/platform/native/database.ts`. Project metadata, workflow metadata, a pending deletion receipt capability and a locally generated purchase recovery key use that database. They are not stored in a hardware-backed credential vault. This is the protected-device-storage minimum used for D09, not a claim that a rooted device, device forensic access or a compromised app process cannot read them.

The iOS database is under `Library/Loopmark/Databases`. `ios/App/App/DurableFiles.swift` marks its `Library/Loopmark` parent excluded from backup before opening the database. Android uses `android:allowBackup="false"` plus explicit database, private media and secure-storage preference exclusions in both `backup_rules.xml` and `data_extraction_rules.xml`; the latter covers cloud backup and device transfer. Native media also uses the excluded private directory. These are configuration/runtime exclusion checks, not physical backup/restore qualification.

Authentication refresh credentials use `NativeCredentialStore` and the secure-storage plugin. The web implementation cannot silently substitute plaintext storage for that native vault. Purchase recovery key export is a separate, explicit user action; it does not enter a craft backup, URL, diagnostics or ordinary logs. A deletion receipt permits only the narrow deletion-status workflow and is not a general account credential.

Physical-device backup/transfer behavior and signing remain external release checks in `docs/release/qualification.md`. The stronger promise “all workflow capabilities are hardware-vault protected” is not implemented or advertised.
