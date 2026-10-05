# One-second recommendations (v20)

Recommendations now use a 1000 ms search budget instead of 2000 ms, prioritizing responsiveness. The Rapfi / mix9svq engine and dual-candidate search remain unchanged. Complex positions can receive less search than under the old budget; no playing-strength or match win-rate improvement is claimed.

The initial button title, runtime title, about-page comparison and explanation, README and existing recommendation QA script agree on the new budget. The runtime title derives its time from the actual budget constant. The opponent still uses the existing 1/5/10-second setting, defaulting to 10 seconds. The offline cache advances to v20 so cached clients receive the new application and introduction.

Game layout, candidate collection, single-candidate fallback, touch confirmation, cancellation and history logic are unchanged. The game HTML differs only in the recommendation time label. The v19 recommendation-guide report remains a historical record of that release's 2-second budget.

## Focused validation

- JavaScript syntax, pinned engine and source patch SHA-256, and `git diff --check` pass.
- All 17 existing recommendation, engine-job and protocol unit tests pass.
- A 390 × 844 touch viewport under header-free `/ai/` hosting uses real single-thread Rapfi WASM, with background thinking enabled. The Worker message is observed without substituting engine responses: opening, black midgame and white response requests all send `timeMs: 1000`, the correct player color, and `multiPV: 2`.
- The opening returns one center candidate; the two nonempty positions return two candidates. Hints preserve the board's dimensions and placed stones. Touch placement still requires two taps.
- Undo during an active recommendation restores the prior board; no stale candidate appears after the canceled search's old budget has elapsed.
- Button titles and about text show 1 second. The original opponent options and selected default remain present.
- A fresh browser session caches the v20 application with the 1000 ms budget and reloads the revised introduction while offline. No page errors.

Observed click-to-visible timings were 150 ms for the opening, 1057 ms for black midgame and 904 ms for white response in this runtime. These are individual observations, not a device-independent latency guarantee or a comparison benchmark. Initialization, background-task handoff, scheduling and UI observation are outside the search-budget figure.

Measurements are recorded in `one-second-recommendation-qa.json`. The full pre-existing Chrome/Edge recommendation suite was updated to use 1000 ms but was not rerun; validation for this small change uses the focused checks above.
