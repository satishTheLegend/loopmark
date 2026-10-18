# Operations and recovery

## Local environments

Development: `npm ci && npm run dev`. Production behavior: `npm run build && npm run preview -- --port 4173 --strictPort`. Node >=22.12.0, npm lockfile. Development omits the service worker so edits are immediately visible. Production uses a generated, content-addressed cache. Do not use `file://` for the application.

All app dependencies are local build inputs; no secret configuration is needed. CI uses Node 24 LTS, `npm ci`, `npm run build`, `npm test`, `npx playwright install --with-deps chromium`, and `npm run test:e2e`. The local validation environment is recorded separately; do not infer a hosted CI run from a workflow file.

## Optional static deployment (prepared, not performed)

Upload the complete `dist/` to a static HTTPS host at the root of a stable origin. No server, DB service, function, or paid account is intrinsically required. Hosting cost depends on provider/traffic and was not measured. A custom subdirectory is unsupported until Vite base, manifest, SW scope and QR path are changed together. Serve unknown navigation paths as index.html; current routes use hashes and do not need server routing.

Set the proper MIME types for JavaScript/CSS, `application/manifest+json` for the manifest and JavaScript for sw.js. Cache hashed assets as immutable. Serve index.html/sw.js/manifest with no-cache so updates can be discovered. Prefer headers `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: microphone=(self), camera=(self)` and a CSP allowing only same-origin scripts/styles/fonts, same-origin/data/blob images and media, no object/frame embeds. Preview may send `Vary: Origin`; immutable precache matching intentionally ignores Vary to match module-script requests offline.

No public indexable marketing routes exist: app shell has noindex/nofollow, robots disallows crawling, and no sitemap/canonical fake production URL or public project schema is emitted. Indexing rules are not authentication. A separate future public marketing page can have its own indexability policy.

## Service-worker lifecycle

Build script precaches all shipped assets and uses an asset-content hash for cache identity. Install fails atomically if required assets fail to fetch. The new worker waits for old tabs to close; no forced skipWaiting reload can destroy an unsaved form. On activation, only older `loopmark-` caches are removed. Navigation attempts network then falls back to cached index; immutable assets use cache-first matching. No user data enters CacheStorage: craft data remains in IndexedDB.

Keep previous hashed build assets available during deployment if existing tabs are expected to remain open. New users need one successful online load. If offline setup failed, reopen online before relying on it. Existing app windows may need to be closed and reopened to receive a new version. The SW cache is not a media backup.

Rollback: restore the previous complete static build at the same origin. Database schema version remains 1; deployment changes must never remove IndexedDB. Before a future schema migration, require a backup/recovery test and preserve old data until migration commit. Browser cache changes do not change craft data.

## Storage failure

UI reports failed reads/writes instead of claiming success. Quota errors preserve previous committed state and form values. Export a backup, then remove an unneeded project if necessary. Limits: 200 projects, 1,000 checkpoints, 48 MiB serialized library, 50 MiB imported file. Cross-tab checkpoint appends compose transactionally; stale metadata/deletion edits are rejected with reopen guidance. A monotonic persisted token prevents restored data accepting old open forms even across clock rollback.

Storage protection uses the browser's optional persistent-storage request. Never instruct a user to clear site data to fix an error without first obtaining a restorable backup. No server-side repair copy exists. Logs intentionally do not capture craft content; errors remain local, no analytics endpoint. This build has no centralized observability because there is no service.

## Backups and labels

Download current backup before restore. Validate backup on a separate browser profile if the original is especially valuable. Restore checks the entire envelope, IDs, content limits and permitted local media before mutation. A transaction failure rolls back the clear and every inserted record. Newest checkpoint ordering is normalized. Restored project update tokens refresh; original notes/media/IDs/checkpoint timestamps are preserved. Audio codecs may not play across all browser combinations, although bytes remain in the backup.

A bag label's next step is a printed snapshot; print another after a material change. QR same-origin lookup needs the project data in that browser/profile. A readable code remains useful when QR is unavailable. Actual printer dimensions/contrast and scanners on physical devices need manual device testing before wider distribution.

## Pilot, support and future work

Use the protocol in product.md, including the no-reminder week. The app deliberately has no hidden tracking; collect consented observations manually. Pricing is unvalidated and checkout is not implemented. Future scope: real device matrix, autosaved unfinished form drafts, optional encrypted sync, native distribution and an independently tested paid upgrade that never locks reading or export. Third-party libraries and browser compatibility need periodic review; the lockfile and dependency audit are point-in-time evidence.
