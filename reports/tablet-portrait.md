# Portrait tablet layout (v17)

Portrait tablets previously stacked actions, settings and all analysis sections across the entire page width. At 768 × 1024, that auxiliary region occupied about 315 px of height and constrained the visible board to a 584.6 px square.

Portrait viewports 641–1199 CSS pixels wide now place a two-column dock below the board. Actions and settings occupy the left column; judgment, the win-rate bar, trend and search statistics occupy the right. The dock occupies about 170 px in the initial layout. The board remains a square sized by both remaining container dimensions, so a shorter browser viewport still fits the complete page.

All controls and original text remain visible. Action and select text on this tablet layout is 14 px, other status text remains at least 12 px, and controls remain at least 44 px high. The trend has 56 px of plot height. Phone and landscape rules are unchanged. Game, engine and record logic are unchanged. Stylesheet URLs and the offline cache advance to v17; the existing about-page assets remain in the cache.

## Measured improvement

Measurements use the visible board SVG, excluding frame padding, in CSS pixels. Before and after use the same restored six-stone position and initial waiting assessment.

| Viewport | Before side | After side | Board area increase |
| --- | ---: | ---: | ---: |
| 768 × 900 | 460.6 px | 605.8 px | 73.0% |
| 768 × 1024 | 584.6 px | 729.3 px | 55.6% |
| 820 × 1050 | 610.6 px | 755.8 px | 53.2% |
| 820 × 1180 | 740.6 px | 779.2 px | 10.7% |
| 1024 × 1165 | 725.6 px | 870.8 px | 44.0% |
| 1024 × 1366 | 926.6 px | 975.1 px | 10.7% |

At 768 × 1024, 820 × 1180 and 1024 × 1366 the board frame reaches the available content width, with the page's existing edge padding. More height produces breathing room rather than an oversized board. Shorter viewports constrain board height while keeping controls and analysis visible.

## Validation

- Browser checks pass at 15 viewports: 320 × 568, 390 × 700, 390 × 844, 641 × 800, 744 × 1000, 768 × 900, 768 × 1024, 820 × 1050, 820 × 1180, 834 × 1112, 1024 × 1165, 1024 × 1366, 1199 × 1500, 1024 × 768 and 1440 × 900.
- Waiting assessment, long synthetic assessment/statistics and visible recommendation hints fit without horizontal or vertical document overflow. Synthetic analysis values stress layout only; they are not engine benchmark evidence.
- The board stays square and is larger in area than the auxiliary dock on all checked portrait tablet sizes. Primary control rows remain at least 44 px, and visible text is at least 12 px.
- Phone and landscape geometry matches the baseline for the board, sidebar, settings and analysis sections in the checked unaffected sizes.
- At 768 × 1024, real Rapfi recommendation, two-tap player move, AI response, undo, portrait-to-landscape rotation and back, browser-height changes, pondering toggle, color changes and AI opening pass. The six-stone game survives rotation. No page errors.
- `npm run check` and `git diff --check` pass.

Full measurements are recorded in `tablet-portrait-qa.json`.
