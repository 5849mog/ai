// Reproducible fixed-position suite and color-swapped self-play benchmark.
// Example: node scripts/strength-benchmark.js --position-budgets=100,500,1000 --match-budgets=100,500 --openings=4
import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import { createHash } from "node:crypto";
import { createFreestyleNodeEngine } from "./freestyle-node-engine.js";
import { summarizeGames, summarizePositions, summarizeSearches, gameScore } from "./strength-metrics.js";
import { TACTICS, verifyTactic } from "../tests/fixtures/tactics.js";
import { OPENINGS } from "../tests/fixtures/openings.js";
import { BLACK, WHITE, outcome, validatePosition } from "../game-rules.js";
import { APP_VERSION } from "../app-release.js";

const args = new Map(process.argv.slice(2).filter(arg => arg.startsWith("--")).map(arg => {
  const [key, ...value] = arg.slice(2).split("=");
  return [key, value.join("=") || true];
}));
const numberList = (name, fallback, max) => String(args.get(name) ?? fallback).split(",").map(Number).map(value => {
  assert.ok(Number.isInteger(value) && value >= 1 && value <= max, `${name} must contain integers from 1 to ${max}`);
  return value;
});
const positionBudgets = numberList("position-budgets", "100,500,1000", 30_000);
const matchBudgets = numberList("match-budgets", "100,500", 30_000);
assert.equal(new Set(positionBudgets).size, positionBudgets.length, "position budgets must be unique");
assert.equal(matchBudgets.length, 2, "match-budgets requires short,long");
assert.ok(matchBudgets[0] < matchBudgets[1], "match budgets must be ascending");
const openingCount = Number(args.get("openings") ?? 4);
assert.ok(Number.isInteger(openingCount) && openingCount >= 1 && openingCount <= OPENINGS.length, `openings must be 1..${OPENINGS.length}`);
const output = String(args.get("output") ?? "reports/strength-baseline-v1.json");
const resume = args.has("resume");
const digest = value => createHash("sha256").update(value).digest("hex");

const fixtures = TACTICS.map(fixture => {
  const proof = verifyTactic(fixture);
  validatePosition(fixture.board, fixture.sideToMove);
  return { ...fixture, expected: proof.expected, proofs: proof.proofs };
});
const openings = OPENINGS.slice(0, openingCount).map(opening => {
  const board = Array(225).fill(0);
  opening.moves.forEach(([x, y], index) => { board[y * 15 + x] = index % 2 + 1; });
  validatePosition(board, WHITE);
  return { id: opening.id, moves: opening.moves, board, sideToMove: WHITE, boardSha256: digest(Buffer.from(board)) };
});

const manifestBytes = await readFile(new URL("../engine/rapfi-250615/manifest.json", import.meta.url));
const manifest = JSON.parse(manifestBytes);
const sources = {};
for (const path of [
  "scripts/strength-benchmark.js", "scripts/strength-metrics.js", "scripts/freestyle-node-engine.js",
  "tests/fixtures/tactics.js", "tests/fixtures/openings.js", "game-rules.js", "engine-protocol.js"
]) sources[path] = digest(await readFile(new URL(`../${path}`, import.meta.url)));
const assets = { "engine/rapfi-250615/manifest.json": digest(manifestBytes) };
for (const path of [
  "engine/rapfi-250615/rapfi-single-simd128.js",
  "engine/rapfi-250615/rapfi-single-simd128.wasm",
  "engine/rapfi-250615/rapfi.data"
]) assets[path] = digest(await readFile(new URL(`../${path}`, import.meta.url)));
const identity = {
  version: 1,
  appVersion: APP_VERSION,
  sourceCommit: process.env.GIT_COMMIT ?? "unrecorded",
  rule: "freestyle-15; five or more consecutive stones win",
  engineCommit: manifest.sourceCommit,
  networksCommit: manifest.networksCommit,
  variant: "rapfi-single-simd128",
  threads: 1,
  memoryMiB: 256,
  positionBudgets,
  matchBudgets: { shortMs: matchBudgets[0], longMs: matchBudgets[1] },
  fixtures: fixtures.map(({ id, kind, sideToMove, board, expected }) => ({
    id, kind, sideToMove, expected, boardSha256: digest(Buffer.from(board))
  })),
  fixturesSha256: digest(JSON.stringify(fixtures)),
  openings,
  sources,
  assets,
  statisticalClaim: "Descriptive engine measurements only. No human win-rate, general Elo, statistical superiority, or complete-solver claim follows from this finite suite."
};
const device = {
  cpu: cpus()[0]?.model ?? "unknown",
  logicalCores: cpus().length,
  ramGiB: +(totalmem() / 2 ** 30).toFixed(2),
  os: `${process.platform} ${release()}`,
  arch: process.arch,
  node: process.version
};
let report;
if (resume) {
  report = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(report.identity, identity, "resume identity differs from this run");
} else {
  report = { identity, device, startedAt: new Date().toISOString(), positionRuns: [], games: [] };
}
await mkdir(new URL("../reports/", import.meta.url), { recursive: true });
const save = async () => {
  const temporary = `${output}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2) + "\n");
  await rename(temporary, output);
};
const engine = await createFreestyleNodeEngine();
await engine.search({ board: new Uint8Array(225), sideToMove: BLACK, timeMs: 100, allowSetup: true });

function updateSummary() {
  report.summary = {
    positions: Object.fromEntries(positionBudgets.map(budget => [budget,
      summarizePositions(report.positionRuns.filter(run => run.budgetMs === budget))
    ])),
    matches: summarizeGames(report.games.filter(game => game.status === "finished")),
    search: Object.fromEntries(["short", "long"].map(method => [method,
      summarizeSearches(report.games.flatMap(game => game.moves).filter(move => move.method === method))
    ]))
  };
}
function restoreGame(game) {
  const opening = openings.find(item => item.id === game.openingId);
  assert.ok(opening, `${game.id}: unknown opening`);
  const board = Uint8Array.from(opening.board);
  let side = opening.sideToMove;
  let winner = 0;
  for (const move of game.moves) {
    assert.equal(move.color, side, `${game.id}: side-to-move mismatch`);
    assert.ok(Number.isInteger(move.index) && move.index >= 0 && move.index < 225 && !board[move.index], `${game.id}: illegal move`);
    board[move.index] = side;
    winner = outcome(board, move.index);
    side = 3 - side;
    assert.ok(!winner || move === game.moves.at(-1), `${game.id}: moves continue after game end`);
  }
  assert.equal(game.winner ?? 0, winner, `${game.id}: winner mismatch`);
  return { board, side, winner };
}

try {
  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    const orderedBudgets = positionBudgets.map((_, index) =>
      positionBudgets[(index + fixtureIndex) % positionBudgets.length]);
    for (const budgetMs of orderedBudgets) {
      const id = `${fixture.id}-${budgetMs}`;
      if (report.positionRuns.some(run => run.id === id)) continue;
      engine.clear();
      const original = JSON.stringify(fixture.board);
      const started = performance.now();
      const result = await engine.search({
        board: fixture.board, sideToMove: fixture.sideToMove, timeMs: budgetMs, allowSetup: true
      });
      const wallMs = performance.now() - started;
      assert.equal(JSON.stringify(fixture.board), original, "search mutated its fixture");
      assert.ok(Number.isInteger(result.index) && fixture.board[result.index] === 0, `${id}: illegal engine move`);
      const run = {
        id, fixtureId: fixture.id, kind: fixture.kind, budgetMs,
        index: result.index, expected: fixture.expected, correct: fixture.expected.includes(result.index),
        wallMs, result
      };
      report.positionRuns.push(run);
      updateSummary();
      await save();
      console.log(`POSITION ${report.positionRuns.length}/${fixtures.length * positionBudgets.length} ${id}: ${run.correct ? "solved" : "missed"} move=${result.index} depth=${result.depth ?? "—"} wall=${Math.round(wallMs)}ms`);
    }
  }

  for (const opening of openings) {
    for (const longColor of [BLACK, WHITE]) {
      const id = `${opening.id}-long-${longColor === BLACK ? "black" : "white"}`;
      let game = report.games.find(item => item.id === id);
      if (game?.status === "finished") continue;
      if (!game) {
        game = { id, openingId: opening.id, longColor, status: "running", winner: 0, moves: [], startedAt: new Date().toISOString() };
        report.games.push(game);
        await save();
      }
      let { board, side, winner } = restoreGame(game);
      while (!winner) {
        const method = side === longColor ? "long" : "short";
        const budgetMs = identity.matchBudgets[`${method}Ms`];
        engine.clear();
        const started = performance.now();
        const result = await engine.search({ board, sideToMove: side, timeMs: budgetMs, allowSetup: true });
        const wallMs = performance.now() - started;
        assert.ok(Number.isInteger(result.index) && result.index >= 0 && result.index < 225 && !board[result.index], `${id}: illegal engine move`);
        board[result.index] = side;
        winner = outcome(board, result.index);
        game.moves.push({
          ply: 3 + game.moves.length + 1, color: side, index: result.index, method, budgetMs,
          wallMs, engineElapsedMs: result.elapsed ?? null, depth: result.depth ?? null,
          nodes: result.nodes ?? null, nps: result.nps ?? null, mate: result.mate ?? null,
          evaluation: result.assessment?.evaluation ?? null, winRate: result.assessment?.winRate ?? null
        });
        side = 3 - side;
        game.winner = winner;
        game.status = winner ? "finished" : "running";
        if (winner) game.finishedAt = new Date().toISOString();
        updateSummary();
        await save();
      }
      console.log(`GAME ${report.games.filter(item => item.status === "finished").length}/${openings.length * 2} ${id}: winner=${winner} score=${gameScore(game)} plies=${game.moves.length}`);
    }
  }
  report.finishedAt = new Date().toISOString();
  report.complete = true;
  updateSummary();
  await save();
  console.log("FINAL", JSON.stringify(report.summary));
} catch (error) {
  report.failure = error.stack;
  await save();
  throw error;
}
