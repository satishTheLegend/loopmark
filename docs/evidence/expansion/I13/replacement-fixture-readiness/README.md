# Replacement fixture readiness

The saved Old-only project was still being submitted when the fixture restored a separate collection. The previous current-status text had passed immediately after the local save. The interrupted push left destination work pending, so replacement correctly returned `SYNC_REBASE_REQUIRED` before showing confirmation. The original trace digest and bounded timing are in [proof.json](proof.json).

The corrected fixture observes the named project operation before creation, waits for its successful real push response and exact pulled receipt, verifies the advancing cursor, and then requires the visible current label. It switches collections only after that barrier. Backup bytes, cancellation, separate restore, consent, final account replacement and retained Previous Account assertions remain unchanged. No product or server behavior changes; actual focused execution remains pending.
