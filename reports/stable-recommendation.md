# Stable recommendation layout (v18)

The recommendation legend previously added an automatic-height grid row between the board and controls. In height-constrained viewports, showing "首选 / 开局推荐天元" reduced the square board and moved its coordinates.

The legend now uses the existing header height. The board-size label moves into the record-menu summary, leaving a flexible center column for the complete recommendation text. Longer single-point text can wrap within the existing phone header height. The empty legend row is removed from the board grid. No new board overlay or reserved empty row is added.

Existing recommendation labels, explanatory text, element IDs, live announcements and recommendation/game logic are unchanged. The record menu retains import and both export actions. Stylesheet URLs and the offline cache advance to v18.

## Validation

- `npm run check` and `git diff --check` pass.
- Browser checks pass at 11 viewports: 320 × 568, 390 × 700, 390 × 844, 667 × 375, 744 × 1000, 768 × 900, 768 × 1024, 820 × 1180, 1024 × 768, 1024 × 1366 and 1440 × 900.
- A real opening recommendation, its dismissal with Esc, the existing longer single-point label, and a dual-point legend preserve the exact board x/y/width/height. The long single-point and dual-point label variations are layout stress fixtures; the opening and midgame flow use the actual app and Rapfi engine.
- Initial board geometry matches v17 at the checked phone, tablet and desktop baseline sizes. At 768 × 1024 it remains a 729.3 px square before and after recommendation display.
- Full page content fits one screen. Recommendation text stays within the header and does not overlap the brand or record-menu controls.
- The record menu still opens and exposes import, JSON export and SGF export without changing board geometry.
- A real dual recommendation, two-tap player move, AI response, undo, restart and rotation pass at 768 × 1024. Game actions clear recommendation hints as expected. No page errors.

Full measurements are recorded in `stable-recommendation-qa.json`.
