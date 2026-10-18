# Sync-status locator ambiguity

The Firefox project-link test failed before any bag-link navigation. Its owner-device checkpoint saved, then the exact-text locator for “Synced to your account” matched both the visible status label and the intentional screen-reader live announcement. Playwright reported a strict-mode violation; it did not reach the 20-second assertion deadline.

The [exact error extraction](strict-mode-error.txt) records both matched elements. [metadata.json](metadata.json) binds it to the original trace/context hashes, frozen product source `a1a3b72`, test source blobs, and assertion timing. The assertion began at 6.812s and failed at 7.472s relative to Before Hooks. No link-opening behavior was exercised before failure.

The correction changes only two test locators: `project-links.cloud.ts:27` and the same ambiguous pattern in `accounts.cloud.ts:139`. Both now assert visibility and exact expected text on `.sync-status > span:not(.sr-only)`, selecting the visible label. The screen-reader announcement can briefly retain its previous text and cannot satisfy these assertions. The visible label, live announcement, all other assertions, and existing timeouts remain unchanged.

No browsers or tests ran during this correction. The root agent owns the focused four-journey, five-profile check after the active matrix completes. This evidence does not claim that follow-up result.
