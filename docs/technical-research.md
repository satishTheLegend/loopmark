# Technical research

Reviewed 18 October 2026. These are source-backed constraints and engineering decisions, not results of device testing. Product research is maintained separately.

| Question | Primary evidence | Consequence for Loopmark |
|---|---|---|
| Can media stay entirely local? | [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) supports structured values and files/blobs. | Store projects and bounded media in IndexedDB. No account, server database, analytics or upload is needed for the accepted journey. |
| Is localStorage sufficient? | [MDN storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) documents approximately 5 MiB per origin for localStorage, browser-specific IndexedDB quotas, quota errors and eviction. | A few photos exhaust localStorage. Use it only for optional tiny preferences. Catch failed writes and offer export. Persistence requests improve retention but do not replace backups. |
| When is a save successful? | [MDN Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) explains request/transaction events, upgrades and shutdown limitations. | Await transaction completion. Do not display “saved” after only a successful put request. Keep read/modify/write inside one transaction and handle version changes. |
| Can recording be guaranteed everywhere? | [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) requires permission and a secure context. [MDN isTypeSupported](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static) provides MIME capability checks but recording can still fail. | Record only after an explicit click. Use HTTPS or localhost; keep a typed next step usable if recording is unavailable or denied. Select a supported MIME at runtime and preserve its real type. |
| Can the app work without the network? | [MDN service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) documents installation, cache lifecycle and waiting updates. | Precache the complete built app shell. Offline availability begins only after successful installation. Avoid forcing a reload while a checkpoint is being written. |
| How do tabs learn about changes? | [MDN BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) describes communication among contexts in the same origin/storage partition. | Publish an invalidation after commit, then reread IndexedDB. Refresh on window focus as fallback. Notifications are not locks. |
| Is Vite a supported setup? | [Vite guide](https://vite.dev/guide/) specifies Node 20.19+ or 22.12+. [React setup guidance](https://react.dev/learn/creating-a-react-app) generally recommends frameworks but supports from-scratch build tools for constraints that warrant them. | A static browser-only app has no server rendering or server data requirement. Vite + React + TypeScript keeps deployment and operation small; record the actual resolved versions in the lockfile. |

## Alternatives and recommendation

1. **Paper bag tag / phone note:** lowest setup and strong portability; weak photo/history organization. This remains a valid user alternative and the printed label preserves its benefit.
2. **Static offline web app with IndexedDB — selected:** instant private capture, no credentials or service cost; data belongs to a browser origin/profile and must be exported before moving environments.
3. **Cloud-synced application:** multi-device recovery and sharing; introduces identity, authorization, storage bills, network failures and conflict resolution. Reconsider only after users demonstrate restart value and ask for sync.

Local media is not encrypted by this application. Device access and browser profile security remain relevant. A downloaded backup contains the complete project data and media in readable form. Do not imply a QR code transfers records or grants cloud recovery.

## Review workflow availability

The installed [`gstack-autoplan` manifest](/Users/lalaji/.codex/skills/gstack-autoplan/SKILL.md) is available as a sibling registry directory, rather than the router's nested path. Its inspected behavior coordinates CEO → Design (for UI) → DX (for developer-facing products) → Engineering, with engineering last. It requires full phase methodologies, decision records, immutable review snapshots, completed native/outside-review statuses and a final approval gate. Its six principles favor complete coverage, bounded fixes, practical decisions, reuse, explicit code and action. Routine delegated decisions can use the user's authorization; original user requirements retain priority.

This work uses the applicable concerns to coordinate product/design evidence before the final engineering review: scope and simpler alternatives; data ownership; mutation atomicity; stale edits; restore validation; media and storage limits; graceful permission failure; offline installation and update lifecycle; measurable budgets; and negative-path tests. DX product review is inapplicable to this consumer tool, while reproducible developer setup is still verified. The project does not claim the full gstack runtime, immutable-packet workflow or outside Claude Code review completed. Native reviews are attributed independently, with no fabricated cross-model consensus or telemetry.

## Remaining evidence limits

- Desktop browser tests cannot establish iOS/Safari retention or real microphone quality. Test a real Android and iPhone before a paid public release.
- Localhost testing does not establish HTTPS hosting headers, install prompts, stable production origin or cross-version service-worker updates on a deployment.
- Quota availability is dynamic. Size limits are safeguards, not storage guarantees.
- Dependency licenses must be verified from the resolved installed packages; these browser documents do not establish a dependency's license.
