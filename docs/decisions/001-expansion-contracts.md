# ADR 001: portable compatibility and shared command contracts

Accepted under the user's standing build-and-verify delegation on 18 October 2026.

The verified local app embeds media in portable JSON and uses timestamps/UUIDs for local compare-and-swap. Cloud synchronization needs immutable operation identity, exact server revisions, scoped media, typed conflict recovery and durable local intent. Reusing the old revision field as a server counter or copying validators would make compatibility and ownership ambiguous.

Keep the existing facade/types and portable validators, extracting them without changing their current behavior. Add provider-neutral normalized command/repository/platform contracts with strict runtime schemas, canonical hash fixtures, explicit revision targets and safe error catalog. Backend, browser and native adapters consume the same frozen definitions. Pure fixed policy retains all history/export and prevents local legacy flags from becoming server grants.

The cost is two explicitly different data representations and conversion at export/import/hydration boundaries. This is preferable to destructive legacy migration or three diverging implementations. The current 200/1,000/48 MiB envelope remains fixed. Reconsider the portable representation only through a separately tested format migration. I02 preserves source databases while copying/validating to the new store; I04 proves native durability on actual runtimes.

Independent review corrected MIME/JSON-escaping parity, PostgreSQL NUL compatibility, typed conflict propagation, command target semantics, media scope and purchase dispute states before freeze. See executable contract tests and the I01 evidence record for actual results; local types do not qualify provider transactions or native builds.
