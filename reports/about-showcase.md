# About-page showcase (v16)

The previous about page contained a heading and five paragraphs. It now presents four editorial chapters: a wooden-board cover with a large local serif wordmark; a dark, interactive four-layer engine diagram; three product principles; and a closing return-to-game entry. The original three license paragraphs and their links are preserved verbatim as a plain text section.

The cover uses existing wood and satin-stone SVG assets, inline board artwork, and a one-time stone entrance. The engine diagram is explanatory artwork, not a live search. Touch or click selects a layer and its description. Arrow keys, Home and End support keyboard selection. The detail area reserves space for all four descriptions so selection does not change the exhibit height.

`about.css` and `about.js` load only on the about page. No game layout, engine logic or record modules are changed. The about script never reads or writes game storage. The page includes a sticky return link, a skip link, visible focus indicators, reduced-motion support and readable static descriptions when JavaScript is disabled. Content remains visible by default; entrance effects progressively enhance below-the-fold sections.

The page updates the obsolete black-only description to reflect selectable colors, and explains the cache-ready condition for offline play. It retains the current Rapfi 250615 / mix9svq implementation and source attribution. Presentation assets remain local, with no external font or animation service.

## Validation

Browser checks use the project's Playwright Chromium runtime. Full results are in `about-showcase-qa.json`.

- Eight viewports: 320 × 568, 390 × 700, 390 × 844, 667 × 375, 768 × 1024, 1024 × 768, 1440 × 900 and 1920 × 1080.
- No horizontal document overflow or out-of-bounds text; checked text at least 12 px; primary navigation and diagram controls at least 44 px high.
- All four step selections update the correct layer and description. Exactly one button remains selected. The description panel keeps the same height across all steps.
- Arrow keys, Home and End work. All entrance sections become visible through normal scrolling. No page errors, failed resource responses or external page requests in the layout checks.
- Reduced-motion preference disables entrance animation and keeps controls usable. With JavaScript disabled, all static explanations and the return link remain available.
- Existing v15 Service Worker cache upgrades to v16. The new about HTML, CSS and JS reload and work offline after the new worker takes control.
- Returning from the about page offline restores the same saved six-stone game with the main page still fitting one screen.
- Original license paragraphs and hrefs match the previous page verbatim. Local license links respond successfully.
- `npm run check` and `git diff --check` pass. This is a presentation update; no new engine-strength benchmark is required.
