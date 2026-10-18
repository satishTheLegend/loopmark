# Navigation race regression evidence

These results were observed during the implementation session that produced
`feb71f4ba27f23cbbc1935f976618633bbf3d5c8` (2026-10-18).

The test commands were run directly through the terminal tool without redirecting
stdout to a file. No separate saved `app-navigation` stdout log was found under
`.gstack`. The adjacent text files preserve the exact test-result lines and final
totals from the tool transcript, excluding Node color warnings, failure stack
traces, and attachment paths. **They are transcript excerpts, not original raw
process logs.** No tests were rerun to create this evidence.

| Run | Command | Observed result | Tool output reference |
| --- | --- | --- | --- |
| Before repair | `npx playwright test -c playwright.ui.config.ts app-navigation.ui.ts --project=chromium --workers=1` | 3 failed, 1 passed; 28.9 seconds | exec session `56272`, completion chunk `a99bb9` |
| After repair | `npx playwright test -c playwright.ui.config.ts app-navigation.ui.ts --workers=1` | 20 passed; 18.4 seconds | exec session `4521`, completion chunk `81d295` |

Both commands ran in `/Users/lalaji/Repos/CGProjects/loopmark-expansion-integration`.
The UI configuration started Vite on port 4184. No backend was used. The fixture
mounted the real App, forms, and browser repository through `createRuntime({})`;
only URL completion and hash-event delivery were deliberately gated.

Source identity:

- Before-repair `src/App.tsx` Git blob: `e3603ba5cb7761260822397180d6d809946d223f`.
- After-repair `src/App.tsx` Git blob: `5119c1fb5e435af35a385194e04348213a637979`.
- Repaired App and final fixture source: commit `feb71f4ba27f23cbbc1935f976618633bbf3d5c8`.
- Fixture files: `tests/ui/app-navigation.html`, `tests/ui/app-navigation.tsx`,
  and `tests/ui/app-navigation.ui.ts`.
- The before-repair fixture was uncommitted and not yet formatted; its full
  worktree hash was not captured. This explains the differing test line numbers
  in the two excerpts. The tests were then formatted, without changing their
  assertions, before the after-repair run.
- `npx tsc -b --pretty false` also completed with exit code 0 after the repair
  (tool completion chunk `037f8b`).

The three controlled failures were disappearance of a newly opened form after a
late initial project-link result, a late platform-link result, and delayed
equivalent/obsolete hash events. The positive control, opening a current project
link with no newer interaction, passed before and after repair. After repair all
four cases passed in Chromium, Firefox, WebKit, Chromium mobile, and WebKit mobile.

The original Firefox guest-test failure at `/` remains unexplained by this
evidence. Its recorded URL never changed and that route does not invoke the
initial project-link handler. It must not be attributed to the confirmed
saved-link race. The parent agent separately reported 15/15 affected production
checks and 10/10 fresh-context Firefox repetitions passing; those are separate
runs and are not included in these transcript excerpts.
