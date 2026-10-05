# Recommendation introduction (v19)

The about page now includes a dedicated `#recommendation` chapter. Its cover provides a direct chapter link; the game retains its existing about-page footer link, board dimensions and controls. Warm paper, ink, moss green, thin rules and the existing candidate-ring colors carry the site's visual language into a side-by-side search comparison, three explanatory steps and readable answers.

## Claims and source boundaries

- Both roles use the same persistent Rapfi 250615 / mix9svq engine. `app.js` calls recommendation search from `playerColor` with `RECOMMENDATION_MS = 2000` and `multiPV: 2`; opponent search uses the opposite color, the selected 1000/5000/10000 ms budget, and the default single candidate. The default selected budget is 10000 ms in `index.html`.
- Candidate descriptions follow `RecommendationCollector`: completed same-depth MultiPV output, legal distinct current-move candidates, and validated direct-win / single-result fallbacks. One displayed point does not prove there is only one good move.
- Recommendation display does not place a stone or add a history entry. The text describes the existing clearing and cancellation behavior for actual moves, undo, restart, color changes and record import; this release does not change that logic.
- There is no measured match-series win rate for following the first recommendation against the current AI. The introduction explicitly says so. It does not extrapolate from search-time ratios, claim 50% for equal engine identity, or reuse the prior 40-game comparison against the legacy engine.
- The win-rate strip represents the engine's current-position estimate. It is distinct from a recommendation-versus-current-AI match-series win rate. No matches were run for this presentation change.

## Validation

- JavaScript syntax, pinned engine / source patch SHA-256 checks and `git diff --check` pass.
- Focused browser checks cover 320 × 568, 390 × 844, 768 × 1024 and 1440 × 900. The introduction has no horizontal overflow, its checked text is at least 12 CSS px, and its anchor lands below the sticky header.
- Navigation from the game's existing footer to the new chapter and back preserves board geometry. The existing engine-step click and keyboard interactions continue to work. The about page does not change stored game or analysis data and launches no game engine Worker.
- The complete introduction remains available with JavaScript disabled. A separate fresh browser session confirms that the v19 cache includes `about.html` and `about.css?v=2`; cached offline reload shows the new content and stylesheet. Layout contexts use blocked Service Workers to isolate presentation checks from cache installation.
- No page errors. The original license section is byte-for-byte unchanged. The game HTML, shared game CSS, engine and all game/search logic are unchanged.

Measurements are recorded in `recommendation-guide-qa.json`. Screenshots were visually reviewed at phone, tablet and desktop sizes; generated captures remain local QA artifacts.
