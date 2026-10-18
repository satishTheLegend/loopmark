# Workspace conventions

- Keep one active Git worktree rooted in this `loopmark` directory. Work in this checkout; do not create sibling Loopmark project folders or duplicate checkouts.
- Keep web, backend, iOS, Android, scripts, tests and documentation in their existing directories inside this repository. Native dependency paths must resolve to this checkout's `node_modules`.
- Keep machine-local archives and optional toolchains in ignored `.local/`, private backend profiles in ignored `.gstack/`, and generated native deliverables in ignored `artifacts/native/`.
- Preserve unfinished work and local state before removing any working copy. Keep historical evidence unchanged; document relocations separately.
- Use the user's configured Git author and committer identity. Keep commits scoped by module and do not add AI author or co-author attribution.
- Follow [the workspace guide](docs/developer/workspace.md) and [the contributor guide](CONTRIBUTING.md). Never publish private archives, environment files, recovery keys, raw traces or local service state.
