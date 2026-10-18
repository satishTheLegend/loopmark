# Developer guide

Keep all modules in the single root checkout described in the [workspace guide](workspace.md). Start with the [guest quickstart](quickstart.md). It needs Node and npm, has no account or Docker dependency, and reaches a saved checkpoint before cloud setup.

| Path | Meaningful success | Additional prerequisites |
| --- | --- | --- |
| Guest web | Save a checkpoint, reload, then reopen the same next step and photo | Node/npm and a browser |
| Local sync | Two independent browser profiles converge on the checkpoint after an offline retry | Local Docker runtime; project-pinned Supabase CLI |
| Unsigned native | Save, force-stop, reopen and export through actual SQLite and filesystem bridges | Xcode/macOS or Java/Android SDK; test-owned simulator/emulator |
| Provider sandbox | Server verifies a sandbox purchase, then reconciles a refund or restoration | Authorized provider/store accounts, product configuration and callback setup |

Use [configuration](configuration.md), [tests and executable examples](testing.md), [native setup](native.md), [provider sandbox](provider-sandbox.md), and [migration/version policy](migrations.md). The [frozen domain contracts](contracts.md) are the API source of truth; these examples are internal contributor material, not a published SDK.

The baseline is Node 22.12 or newer; Node 24 LTS is the recommended contributor version. Exact dependency resolution is in [package-lock.json](../../package-lock.json). OS-specific runtime evidence and missing human walkthroughs are listed in [DX evidence](../evidence/expansion/dx/README.md). Passing a browser suite does not qualify a physical phone, provider account or production deployment.

Private craft routes must retain their indexing protections. Public help/marketing pages may be indexable. Do not put project names, notes, photos, tokens, recovery keys or deletion receipt tokens in analytics, logs or URLs.
