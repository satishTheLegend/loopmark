# Contributing to Loopmark

Start with the [credential-free developer quickstart](docs/developer/quickstart.md), then run the [checks appropriate to your change](docs/developer/testing.md). Keep each checkout/profile isolated. Preserve uncommitted work and coordinate ownership before changing shared contracts, migrations, package scripts or UI integration.

Describe the user-visible problem, the resulting behavior and actual validation in a change description. Use stable operation IDs, exact account/collection/generation fences and numeric revision CAS. Never replace persisted attempted commands during retry. Tests should exercise a real boundary or failure mode rather than restate an implementation. Do not claim native, cloud, provider or physical-device success from mocked tests.

Use synthetic reproductions. Include commit, runtime, capability, safe error code and minimal steps. Omit personal craft content, tokens, raw provider output, receipts and recovery keys. For a security-sensitive defect, send a private report to the project owner through the already authorized private collaboration channel; if none exists, ask the owner to provide one. Do not create a public issue containing exploit data or secrets, and do not send an unsolicited report. No public security contact or hosted issue tracker has been established by this project.

Keep credentials out of source and public build variables. Local commands must stay loopback/profile scoped. Provider activation, deployment, store submission, destructive resets and external communication require their separate authorization. Do not add telemetry, an external project, a new license, a public SDK or a community channel as part of an unrelated change.

Follow [configuration](docs/developer/configuration.md), [version and rollback rules](docs/developer/migrations.md) and the [native license inventory](docs/evidence/expansion/native/licenses/inventory.json). Document new prerequisites and safe failure behavior alongside the code. A missing external prerequisite remains an explicit release condition.
