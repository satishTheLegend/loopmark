# Start locally

## 1. Guest web, no accounts

Open a terminal in this project directory with a compatible Node/npm installation:

```sh
npm ci
npm run doctor -- --capability guest --json
npm run dev
```

Open the loopback URL printed by Vite. The port derives from this checkout's path and stays fixed for that path. Create a project such as “Synthetic scarf”, add a checkpoint with “Row 12” and “Turn and begin repeat 3”, then reload. Open the project and verify the saved next step. Add a small test photo and use Backup to export and restore into a separate local collection. This is the first meaningful success, not merely the page loading.

No `.env.local` is needed for guest use. If reusing a cloud-configured checkout, explicitly blank `VITE_LOOPMARK_SUPABASE_URL` and `VITE_LOOPMARK_SUPABASE_ANON_KEY` in the process environment; environment values override the file. The app origin alone may remain configured. A malformed partial cloud configuration fails validation instead of silently selecting a different backend.

`doctor` is read-only. Exit 0 means the requested prerequisites are ready; 2 means missing configuration/tools; 3 means an unhealthy or occupied local resource. It does not certify application behavior. If the app port is occupied, stop your known server or choose a new `LOOPMARK_DEV_APP_PORT`. It never takes over an unknown process. Stop Vite with Ctrl-C. Export before clearing browser site data; clearing it erases this browser's local work.

First dependency downloads depend on the network. The five-minute contributor target assumes Node/npm are installed, includes a cold install, and remains unmeasured until a human walkthrough is recorded.

## 2. Isolated local sync

Use a unique profile for this checkout. Start a local Docker-compatible runtime with a local socket, then:

```sh
export LOOPMARK_DEV_PROFILE=craft-dev
npm run doctor -- --capability local-sync --json
npm run local:up
npm run local:status
npm run dev
```

The initial doctor may report the local project is not prepared. `local:up` creates this profile's isolated configuration, uses the pinned CLI, downloads cold images when necessary, applies migrations, and writes only public browser settings plus the profile to `.env.local`. It also starts the independent local erasure ledger. Cold images can take several minutes. The scripts refuse occupied ports and remote operator endpoints. Generated diagnostics under `.gstack/local/<profile>` are private and may contain provider output; redact before sharing.

Use synthetic email addresses. Read OTP codes in the profile's local Mailpit, at the `mail` port shown by doctor. Sign in, explicitly connect a local collection after reviewing the preview, then open a second independent browser profile and sign in. Save a checkpoint offline on the first, reconnect, and verify it appears exactly once on the second. Text and attachment status are separate; wait for attachment completion before claiming the photo is available on both devices.

```sh
npm run local:up -- --billing-fixture
npm run test:server -- --suite all
LOOPMARK_SYNC_PUBLIC_ENV="$PWD/.env.local" npm run test:sync
```

Stop the interactive Vite server before running these checks; the sync runner starts its own server on that exact app port. The `--billing-fixture` flag enables the isolated synthetic payment provider required by the full backend and cloud purchase suites. It does not enroll a merchant, contact a real payment provider or qualify real purchases. The public env path must be explicit; only the three public Vite values are read. The sync runner uses the selected profile, validates the public API/app origin and requires the local stack. It fails when prerequisites are absent. Never point it at a shared or production account. Do not run it while another operator is resetting the same profile.

Stop this profile without erasing data:

```sh
npm run local:down
```

For a deliberate reset, obtain `projectId` from doctor, export any useful synthetic data, then substitute that exact value:

```sh
npm run local:reset -- --confirm-project <exact-local-project-id>
```

Reset erases only that local database; it does not clear browser databases or the independent erasure ledger. A mismatched ID is refused. Never borrow another worktree's profile or reset while another contributor is testing. Native setup and real provider setup are separate paths below, not prerequisites for guest use.

Continue with [native setup](native.md) or [provider sandbox](provider-sandbox.md).
