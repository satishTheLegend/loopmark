# Single-project workspace

Loopmark uses one repository and one active checkout. Web, backend and native applications share the same root; they are not separate sibling projects.

```text
loopmark/
  .git/                 Repository history and local branches
  src/                  Web interface and shared application/domain code
  public/               Static assets
  supabase/             Backend migrations, functions and local workers
  ios/                  iOS application and platform adapters
  android/              Android application and platform adapters
  scripts/              Build, development, verification and operations tools
  tests/                Automated verification
  docs/                 Product, developer and evidence documentation
  design-system/        Design specifications
  .github/              Repository automation
  .local/               Private archives, optional toolchains and local records
  .gstack/              Private local backend profiles and operational state
  artifacts/native/     Locally generated debug/simulator deliverables
  node_modules/         This checkout's installed dependencies
  dist/                 Generated web build
```

The last five directories contain local or generated material and are ignored by Git. A fresh clone does not include private archives, toolchains, environment files or previously generated app binaries. Run setup commands from the repository root; see [quickstart](quickstart.md) and [native setup](native.md).

## Consolidation of earlier working copies

The earlier development work used eight linked Git worktrees outside the canonical folder. They shared this repository's history. On 19 October 2026, their complete contents were archived under `.local/archives/2026-10-19/` before removing their working directories and registrations. Their branch references remain in the local repository. These local branch references are separate from which branches are published to the remote.

Each archive has a compressed file manifest recording SHA-256 content hashes, file modes and literal symlink targets. Every archived regular file and link was checked against its source before removal. The archive set also retains the staged/unstaged patches, worktree Git metadata, status records and a bundle of all repository refs. This includes unfinished backend/native edits, private runtime configuration, recovery backups and diagnostic results. Archives stay local and must not be pushed to GitHub.

The local archive index is `.local/archives/2026-10-19/archive-manifest.json`; `retirement-report.json` in the same directory records the subsequent worktree removal and preserved refs/volumes. Use it to locate a specific prior working copy. Recover an individual file into a temporary directory under `.local/` for inspection; do not extract a whole old working copy over the active checkout. Old absolute symlink targets and machine paths are preserved as historical records, not active configuration. Install dependencies in the active checkout with `npm ci`.

Historical reports in `docs/evidence/` still identify their original source locations and commit hashes. Those records were deliberately retained. Current native dependency manifests resolve to this checkout's `node_modules`, and no sibling checkout is required to build.

## Local backend data

The existing local profile `loopmark-expansi-eeac3023` and its private lifecycle/rollback state were preserved under this checkout's `.gstack/`. On the original development machine, ignored `.env.local` pins only that profile. It does not silently enable cloud frontend settings. A fresh clone should select its own local profile using the quickstart.

The four existing Docker volumes and the profile network remain in the Docker runtime. Stopped service containers with mounts pointing to the removed backend worktree are recreated from this checkout on the next deliberate `local:up`; database, object and erasure-ledger data are preserved. Consolidation does not reset or start the backend.

When ready to use the preserved local stack, run the normal commands from the root:

```sh
npm run doctor -- --capability local-sync --json
npm run local:up -- --billing-fixture
npm run local:status
```

The synthetic billing fixture is needed for the full backend/cloud test suites. Starting the local stack regenerates its public `.env.local` values. Follow the [quickstart](quickstart.md) before running browser integration tests; do not reset this profile to repair a path problem.

## Optional project-local Java

The original machine's Java 21 toolchain is preserved at `.local/toolchains/jdk-21.0.12.1+1/`. It is not part of the public repository. To use it from this checkout:

```sh
export LOOPMARK_JAVA_HOME="$PWD/.local/toolchains/jdk-21.0.12.1+1/Contents/Home"
npm run native:android:build
```

Other contributors can use their own Java 21 installation through `LOOPMARK_JAVA_HOME` or `JAVA_HOME`. Xcode, the Android SDK, Docker and their system-managed data remain normal external development tools; they are not additional Loopmark repositories.
