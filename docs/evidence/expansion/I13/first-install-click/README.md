# First Firefox project click: cause and regression

Fixed in `a07b014`: `useOfflineSupport` now requires both an active worker and a
waiting worker before reporting an update. The first installation also briefly
enters the waiting state; it is not an update to an existing worker. The native
early-return branch, App navigation, dialog implementation, and styles are unchanged.

## Observed cause

A diagnostic run against the unchanged production bundle reproduced the original
symptom in 1 of 21 fresh Firefox contexts. Pointerdown targeted the existing New
project button at y=307.13. Before pointerup, that same button moved to y=343.95;
pointerup and click therefore targeted the header. The native dialog was never
opened. The button's React click handler, collection generation, and DOM identity
were unchanged, and the fonts were loaded.

An additional diagnostic run observed a false “An update is ready” banner in 21
of 30 fresh contexts. Its height was 37px. Those 30 clicks happened to succeed;
they establish the first-install banner behavior rather than additional failures.

The deterministic regression uses the actual production App and service worker
on a disposable loopback origin. A test-only HTTP gate holds first installation
until mouse-down, then holds the worker's activation chain before `clients.claim()`
until after mouse-up. This exposes the same lifecycle interval reliably. Before
the fix it reproduces the 37px shift, pointerup/click on HEADER, and missing form.
After the fix the first physical click opens the form and no update banner is
inserted. The test does not force a click, retry a click, or delay the original
application interaction until the installation completes.

## Evidence

- `natural-failure.pointer-events.json`: selected failed attempt from the diagnostic
  probe. Opaque device identifiers were omitted; source and omission are labeled.
- `red.pointer-events.json`: unchanged JSON attachment from the deterministic
  failing run, showing BUTTON → HEADER and y=307.13 → y=344.13.
- `red.stdout.log`: real redirected stdout, one Firefox regression failed.
- `green.stdout.log`: real redirected stdout, 20/20 checks passed in 22.4 seconds.
  This includes the new regression plus failed-precache recovery, cache repair,
  and genuine waiting-update/draft preservation on all five browser profiles.
- `build.stdout.log`: actual successful production build output. Its existing
  bundle-size warning is retained.
- `metadata.json`: exact commands, source commit/blob identities, artifact hashes,
  and probe counts.

Absolute project-root paths in stdout logs were replaced with `<project-root>`.
The raw deterministic failing trace and screenshot remain locally under
`.gstack/first-install-red-evidence/`. These files are observed run artifacts,
not reconstructed transcript summaries. The original guest-suite traces lacked
pointer-event instrumentation; the new natural and controlled reproductions
provide the evidence that was missing during the earlier navigation-only review.
