# Gomoku Studio · 五目

**English** · [简体中文](README.zh-CN.md)

[Play online](https://5849mog.github.io/ai/) · [Compact board](https://5849mog.github.io/ai/?view=simple) · [About & credits](https://5849mog.github.io/ai/about.html) · [Match data](https://5849mog.github.io/ai/report.html)

Gomoku Studio is an open-source Gomoku and Renju board for phones, tablets, and desktops. Play against Rapfi, share a board with someone next to you, or enter a game played elsewhere and analyze it in your browser. The web app is hosted on GitHub Pages and runs the engine locally by default.

## Play a game

Open the board and choose **对局设置** (Game settings) or **对局** (Game) in the compact view. Pick a rule and mode, then choose **开始新局** (Start a new game). The board asks which side starts when the rule requires it. The interactive board currently uses Simplified Chinese. This README and the About page are available in both languages.

| Rules | What changes |
| --- | --- |
| Freestyle Gomoku | Free opening and no forbidden moves |
| Free-opening Renju | Free opening with black's forbidden-move rules |
| RIF | A three-stone opening, color swap, and two fifth-move proposals |
| Taraguchi-10 | Keeping or swapping colors during the opening, with an option to propose ten fifth moves |

| Mode | Who plays |
| --- | --- |
| Play against AI | You play one side and Rapfi plays the other. AI can take over your side for a self-play match. |
| Same-device play | Two people share the board, including swaps, proposals, and selections. AI hints stay hidden. |
| Manual recording | Enter both sides of a game and request analysis when you need it. |
| AI-assisted external play | Enter your opponent's moves from another board. The engine plays your side after you hand it over. |

On touchscreens, tap an intersection to preview the move, then tap it again to place the stone. Choose **棋盘显示** (Board display) for the aiming magnifier, board rotation, coordinates, or tactical markers. Full and compact layouts share the same current game.

## Analysis, sharing, and offline play

- **Analysis.** Ask for ranked move suggestions, inspect estimated win probability, or follow a forced finish when the engine finds one. Automatic play offers fixed thinking times or an adaptive search budget.
- **Game links and files.** Share an in-progress game with a link that opens a preview before loading. The native JSON format retains opening decisions and proposals. Freestyle SGF carries the played stones. Export a board image or use a screenshot to set up a new position with manual correction.
- **Local storage.** Recent games and preferences live in the current browser. Export a backup from Recent games to keep a separate copy. After the app and engine finish caching, you can reload and play offline.
- **Optional desktop engine.** You can use Rapfi running on your own computer for search. See the [desktop engine guide in Chinese](remote/README.md).

The [match report](https://5849mog.github.io/ai/report.html) compares 1-, 5-, and 10-second settings in complete, color-swapped self-play games. It identifies the opponents and sample sizes. The in-game probability is the engine's position estimate. The [raw game records](reports/real-games-latest.json) contain the moves and timings behind the report.

## Develop locally

Use Node.js 24 LTS. GitHub Pages serves the static files in this repository. npm is used for local development and verification.

```sh
git clone https://github.com/5849mog/ai.git gomoku-studio
cd gomoku-studio
npm ci
npm run dev
```

Open [localhost:4187](http://127.0.0.1:4187/). The default server supplies cross-origin isolation for threaded WASM. Use `npm run dev -- --plain` to run without those headers.

| Area | Start here |
| --- | --- |
| Game UI and state | [index.html](index.html), [opening-app.js](opening-app.js) |
| Rules and formal openings | [opening-session.js](opening-session.js), [opening-flow.js](opening-flow.js), [renju-rules.js](renju-rules.js) |
| Board rendering and preferences | [board-view.js](board-view.js), [board-preferences.js](board-preferences.js) |
| Engine and model assets | [engine.js](engine.js), [engine.worker.js](engine.worker.js), [engine/](engine/) |
| Offline updates and release notes | [sw.js](sw.js), [app-release.js](app-release.js), [content/feed.json](content/feed.json) |
| Tests and published evidence | [tests/](tests/), [scripts/](scripts/), [reports/](reports/) |

Run `npm run sync:pages` after editing `index.html` and commit the generated `renju.html`. That compatibility route keeps its own default rule. For About changes, update the English and Simplified Chinese pages together, preserving their shared section links.

```sh
npm run check
npm test
npx playwright install chromium
npm run test:navigation
npm run test:opening-dock
npm run test:upgrade
```

Set `CHROME_PATH` to use an existing Chromium installation. The upgrade test accepts `GOMOKU_UPGRADE_FROM` to start from a specific commit. For an app release, update the app and service worker versions, bump the shell cache generation, and add the entry to `content/feed.json`. For a release-notes-only change, update the feed and increment its revision.

The [Chinese documentation](README.zh-CN.md) also covers the engine API, reproducible engine builds, and benchmark commands. Bug reports are welcome in [Issues](https://github.com/5849mog/ai/issues). Include the browser, the selected rules and mode, and the steps needed to see the problem.

## License

The application and Rapfi are available under GPL-3.0-or-later. The network weights use CC0-1.0, and the bundled Noto Serif SC subset uses SIL OFL 1.1. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY.md) for the corresponding sources and build details.
