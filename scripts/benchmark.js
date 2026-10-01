import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { cpus, totalmem, release } from "node:os";
import { createHash } from "node:crypto";
import { createDevServer } from "./dev-server.js";
import { chooseMove } from "../tests/fixtures/legacy-engine.js";
import { OPENINGS } from "../tests/fixtures/openings.js";
import { SIZE, CELL_COUNT, BLACK, WHITE, outcome, validatePosition } from "../game-rules.js";

const budget = 3400;
await mkdir("reports", { recursive: true });
const reportPath = "reports/benchmark.json";
const server = await createDevServer({ port: 0, isolated: false });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.goto(`${origin}/tests/engine-harness.html`);
const ready = await page.evaluate(async () => {
  const { GomokuEngine, detectCapabilities } = await import("../engine.js");
  const capabilities = detectCapabilities();
  globalThis.matchEngine = new GomokuEngine({ variant: capabilities.simd ? "rapfi-single-simd128" : "rapfi-single" });
  return await matchEngine.init();
});
const legacySource = await readFile("tests/fixtures/legacy-engine.js");
const manifest = JSON.parse(await readFile("engine/rapfi-250615/manifest.json", "utf8"));
const identity = { budgetMs: budget, variant: ready.variant, threads: ready.threads,
  legacyCommit: "0184240a0f3b84b56faba14c86e38697e9c828ce",
  legacySha256: createHash("sha256").update(legacySource).digest("hex"),
  rapfiCommit: manifest.sourceCommit, weightsCommit: manifest.networksCommit,
  openingsSha256: createHash("sha256").update(JSON.stringify(OPENINGS)).digest("hex") };
let report = { identity, startedAt: new Date().toISOString(),
  device: { cpu: cpus()[0]?.model, logicalCores: cpus().length, ramGiB: +(totalmem() / 2**30).toFixed(2),
    os: `${process.platform} ${release()}`, node: process.version, browser: browser.version(), headless: true },
  games: [] };
if (process.argv.includes("--resume")) {
  const saved = JSON.parse(await readFile(reportPath, "utf8"));
  if (JSON.stringify(saved.identity) !== JSON.stringify(identity)) throw new Error("Resume identity differs");
  report = saved;
}

try {
  let requestId = 0;
  for (const opening of OPENINGS) {
    for (const rapfiColor of [BLACK, WHITE]) {
      const gameId = `${opening.id}-rapfi-${rapfiColor}`;
      if (report.games.some(game => game.id === gameId)) continue;
      // Clear persistent TT state by recreating the worker between games.
      // Weight resources are cached by the browser; ordinary turns reuse it.
      await page.evaluate(async () => { matchEngine.dispose(); await matchEngine.init(); });
      const board = new Uint8Array(CELL_COUNT);
      const moves = opening.moves.map(([x,y], i) => ({ index: y * SIZE + x, color: i % 2 + 1, engine: "opening" }));
      for (const move of moves) { if (board[move.index]) throw new Error("Duplicate opening point"); board[move.index] = move.color; }
      let side = WHITE;
      let winner = 0;
      validatePosition(board, side);
      while (!winner && moves.length < CELL_COUNT) {
        let result;
        if (side === rapfiColor) {
          result = await page.evaluate(async job => await matchEngine.search(job),
            { board: Array.from(board), sideToMove: side, timeMs: budget, requestId: ++requestId });
        } else {
          const legacyBoard = side === WHITE ? board : board.map(c => c ? 3 - c : 0);
          result = chooseMove(legacyBoard, 15);
        }
        if (!Number.isInteger(result.index) || result.index < 0 || result.index >= CELL_COUNT || board[result.index]) {
          throw new Error(`Illegal move in ${gameId}: ${JSON.stringify(result)}`);
        }
        board[result.index] = side;
        moves.push({ index: result.index, color: side, engine: side === rapfiColor ? "rapfi" : "legacy",
          elapsed: result.elapsed, nodes: result.nodes, depth: result.depth });
        winner = outcome(board, result.index);
        side = 3 - side;
      }
      const score = winner === 3 ? .5 : winner === rapfiColor ? 1 : 0;
      report.games.push({ id: gameId, opening: opening.id, rapfiColor, winner, score, moves });
      const points = report.games.reduce((sum, game) => sum + game.score, 0);
      console.log(`${report.games.length}/40 ${gameId}: ${score === 1 ? "Rapfi win" : score === 0 ? "Legacy win" : "draw"}, ${moves.length} plies, score ${points}/${report.games.length}`);
      await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    }
  }
  report.completedAt = new Date().toISOString();
  report.artifacts = { emscripten: manifest.emscripten, files: manifest.files, patches: manifest.patches };
  report.summary = { games: report.games.length,
    wins: report.games.filter(g => g.score === 1).length,
    draws: report.games.filter(g => g.score === .5).length,
    losses: report.games.filter(g => g.score === 0).length,
    scoreRate: report.games.reduce((sum,g) => sum + g.score, 0) / report.games.length,
    acceptance: .75, browserErrors: errors };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log("FINAL", JSON.stringify(report.summary));
  if (report.summary.games !== 40 || report.summary.scoreRate < .75 || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
