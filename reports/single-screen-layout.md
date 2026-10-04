# Single-screen layout regression fix (v15)

The v14 stacked settings and analysis sections made the mobile page exceed the viewport. The application now reserves the height of the header, controls, analysis and footer, then gives the board the remaining space. The board stays square and fits both available dimensions. Portrait layouts stack the board and controls; landscape layouts place controls beside the board. All controls and existing analysis text remain visible.

Compact layouts place the trend and search statistics side by side. Settings share a consistent 44 px control surface. Status text remains at least 12 px. Recommendation hints occupy their own grid row below the board, so showing them reduces available board space instead of adding page overflow. Dynamic viewport sizing responds to browser toolbar and orientation changes. The cache version advances to v15.

## Validation

- `npm run check`: passed, including JavaScript syntax and engine artifact hashes.
- `git diff --check`: passed.
- Browser layout checks: passed at all 15 viewports listed below. Waiting, long evaluation text and statistics, and visible recommendation hints fit without document overflow. Board geometry stays square; status text is at least 12 px; action and setting rows are at least 44 px.
- At 390 × 700: a real engine recommendation, player move, AI response and undo passed; resizing the viewport to 390 × 620 and back preserved the single-screen layout.
- No browser page errors. Layout stress checks use synthetic long analysis values; they do not validate win-rate calibration. Game and engine logic are unchanged.

| Viewport | Square board side |
| --- | ---: |
| 320 × 568 | 183.6 px |
| 360 × 640 | 255.6 px |
| 390 × 700 | 315.6 px |
| 390 × 844 | 378 px |
| 430 × 932 | 418 px |
| 667 × 375 | 273 px |
| 844 × 390 | 288 px |
| 768 × 1024 | 584.6 px |
| 820 × 1180 | 740.6 px |
| 1024 × 768 | 636 px |
| 1180 × 820 | 688 px |
| 1024 × 1366 | 926.6 px |
| 1280 × 900 | 768 px |
| 1440 × 900 | 768 px |
| 1920 × 1080 | 948 px |

Full measurements are recorded in `single-screen-layout.json`.
