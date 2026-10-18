# Actual native rebase qualification

Source 7f21cdb implements the shared abcccea repository contract on real SQLite and immutable native files. The bundle manifest and reports bind the exact assets and installed simulator/emulator artifact hashes. Both native builds and all reported scenarios passed.

The fixture covers same-epoch retired-device recovery and changed-epoch recovery, exact active scope and newly added draft detection, unfinished candidate protection, injected SQLite transaction rollback after durable file staging, immutable pending-command/operation-plan archive, upload continuation retirement, purchase/deletion preservation, photo/draft/camera recovery, lost-completion idempotence, stale callback rejection, close/reopen durability and archive cleanup. Missing saved photos require explicit acknowledgement; missing draft media still aborts without retiring work.

The session and remote snapshot inputs are synthetic. SQLite, native file operations, corruption/failure injection and shared snapshot/state logic run in the actual iOS26.5 simulator and Android16/API36 emulator. These are functional checks under shared host load, not physical-device or provider qualification.
