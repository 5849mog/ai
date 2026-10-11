// Paired self-play tournament: adaptive search vs a fixed search with the
// same per-turn wall-clock budget. Seeds are frozen Renju positions taken
// after formal RIF / Taraguchi openings, so this isolates normal-play search.
import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import { cpus, release } from "node:os";
import { createHash } from "node:crypto";
import { createRenjuNodeEngine } from "./renju-node-engine.js";
import { replaySession } from "../opening-session.js";
import { moveVerdict } from "../renju-rules.js";
import { thinkAdaptive, ADAPTIVE_LIMIT_MS } from "../adaptive-search.js";
import { APP_VERSION } from "../app-release.js";

const args = new Map(process.argv.slice(2).filter(a => a.startsWith("--")).map(a => {
  const [key, ...value] = a.slice(2).split("="); return [key, value.join("=") || true];
}));
const budgetMs = Number(args.get("budget") ?? ADAPTIVE_LIMIT_MS);
const output = String(args.get("output") ?? "reports/adaptive-strength-match-v1.json");
const resume = args.has("resume");
const seedNames = String(args.get("seeds") ?? [
  "rif-seat0-keep", "rif-seat0-swap",
  "taraguchi-seat0-normal-mixed", "taraguchi-seat0-ten-far-fourth"
].join(",")).split(",").filter(Boolean);
const digest = value => createHash("sha256").update(value).digest("hex");
assert.ok(Number.isInteger(budgetMs) && budgetMs >= 100 && budgetMs <= ADAPTIVE_LIMIT_MS,
  "budget must be an integer from 100 to 6000 ms");
assert.ok(seedNames.length > 0 && new Set(seedNames).size === seedNames.length, "seed names must be unique");

const sourceReportPath = new URL("../reports/formal-modes-v35.json", import.meta.url);
const sourceReportBytes = await readFile(sourceReportPath);
const sourceReport = JSON.parse(sourceReportBytes);
const seedMap = new Map(sourceReport.cases.map(item => [item.name, item.record]));
const seeds = seedNames.map(name => {
  const record = seedMap.get(name);
  assert.ok(record, `unknown frozen opening seed: ${name}`);
  const session = replaySession(record);
  assert.ok(["rif", "taraguchi10"].includes(session.rule) && session.stage === "play" && !session.winner,
    `seed must be a live Renju position after its formal opening: ${name}`);
  return {
    name, rule: session.rule, board: Array.from(session.board), sideToMove: session.color,
    openingMoves: session.moves.length, boardSha256: digest(Buffer.from(session.board)),
    recordSha256: digest(JSON.stringify(record))
  };
});

const scriptBytes = await readFile(new URL(import.meta.url));
const adaptiveBytes = await readFile(new URL("../adaptive-search.js", import.meta.url));
const protocolBytes = await readFile(new URL("../engine-protocol.js", import.meta.url));
const engineManifest = JSON.parse(await readFile(new URL("../engine/rapfi-250615/manifest.json", import.meta.url)));
const modelManifest = JSON.parse(await readFile(new URL("../engine/renju-250615/manifest.json", import.meta.url)));
const files = [
  "engine/rapfi-250615/rapfi-single-simd128.js",
  "engine/rapfi-250615/rapfi-single-simd128.wasm",
  "engine/rapfi-250615/rapfi.data",
  "engine/renju-250615/config.toml"
];
const assets = {};
for (const file of files) assets[file] = digest(await readFile(new URL(`../${file}`, import.meta.url)));
for (const model of modelManifest.models) {
  const bytes = Buffer.concat(await Promise.all(model.parts.map(name => readFile(new URL(`../engine/renju-250615/${name}`, import.meta.url)))));
  assert.equal(bytes.length, model.bytes, `Renju model size mismatch: ${model.name}`);
  assert.equal(digest(bytes), model.sha256, `Renju model checksum mismatch: ${model.name}`);
  assets[`renju-model:${model.name}`] = model.sha256;
}

const identity = {
  version: 1, appVersion: APP_VERSION,
  sourceCommit: process.env.GIT_COMMIT ?? "unrecorded",
  budgetMs, rules: "Rapfi rule 4 / Renju; exact-five black win; black forbidden moves lose",
  comparison: "thinkAdaptive 0..budgetMs vs one fixed search of budgetMs per move",
  seeds, rapfiCommit: engineManifest.sourceCommit, networksCommit: engineManifest.networksCommit,
  wasmVariant: "single-thread SIMD128", threads: 1, assets,
  sources: {
    "scripts/adaptive-strength-match.js": digest(scriptBytes),
    "adaptive-search.js": digest(adaptiveBytes),
    "engine-protocol.js": digest(protocolBytes),
    "reports/formal-modes-v35.json": digest(sourceReportBytes)
  }
};
const device = {
  cpu: cpus()[0]?.model ?? "unknown", logicalCores: cpus().length,
  os: `${process.platform} ${release()}`, arch: process.arch, node: process.version
};
let report;
if (resume) {
  report = JSON.parse(await readFile(output, "utf8"));
  assert.equal(JSON.stringify(report.identity), JSON.stringify(identity), "resume identity differs from this run");
} else {
  report = { identity, device, startedAt: new Date().toISOString(), games: [] };
}

const save = async () => {
  const temp = `${output}.tmp`;
  await writeFile(temp, JSON.stringify(report, null, 2) + "\n");
  await rename(temp, output);
};
const engine = await createRenjuNodeEngine();
await engine.search({ board: new Uint8Array(225), sideToMove: 1, timeMs: 100, allowSetup: true });

function scoreFor(game) {
  if (game.winner === 3) return 0.5;
  if (game.winner === 0) return null;
  return game.winner === game.adaptiveColor ? 1 : 0;
}
function restoreGame(game) {
  const board = Uint8Array.from(game.startBoard);
  let side = game.startSide, winner = 0;
  for (const move of game.moves) {
    assert.equal(move.color, side, `${game.id}: recorded side-to-move mismatch`);
    assert.ok(Number.isInteger(move.index) && move.index >= 0 && move.index < 225 && !board[move.index],
      `${game.id}: illegal occupied or out-of-board point`);
    const verdict = moveVerdict(board, move.index, side, game.rule);
    assert.equal(verdict.forbidden, "", `${game.id}: recorded forbidden move`);
    board[move.index] = side;
    winner = verdict.winner;
    side = 3 - side;
    assert.ok(!winner || move === game.moves.at(-1), `${game.id}: moves continue after game end`);
  }
  assert.equal(game.winner ?? 0, winner, `${game.id}: winner does not match replay`);
  return { board, side, winner };
}
function updateSummary() {
  const done = report.games.filter(game => game.status === "finished");
  const scores = done.map(scoreFor);
  report.summary = {
    games: done.length,
    adaptiveWins: scores.filter(score => score === 1).length,
    draws: scores.filter(score => score === 0.5).length,
    adaptiveLosses: scores.filter(score => score === 0).length,
    adaptiveScoreRate: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    completedPairs: seeds.filter(seed => [1, 2].every(color => done.some(game => game.seed === seed.name && game.adaptiveColor === color))).length,
    totalExpectedPairs: seeds.length,
    statisticalClaim: "Descriptive self-play only; the same engine weights face each other. No human win-rate, Elo, or proof of superiority follows from these games."
  };
}

try {
  for (const seed of seeds) {
    for (const adaptiveColor of [1, 2]) {
      const id = `${seed.name}-adaptive-${adaptiveColor === 1 ? "black" : "white"}`;
      let game = report.games.find(item => item.id === id);
      if (game?.status === "finished") continue;
      if (!game) {
        game = {
          id, seed: seed.name, rule: seed.rule, openingMoves: seed.openingMoves,
          startBoard: seed.board, startSide: seed.sideToMove, adaptiveColor,
          status: "running", winner: 0, moves: [], startedAt: new Date().toISOString()
        };
        report.games.push(game);
        await save();
      }
      const state = restoreGame(game);
      let { board, side, winner } = state;
      while (!winner && board.some(value => value === 0)) {
        const adaptiveTurn = side === game.adaptiveColor;
        engine.clear();
        const started = performance.now();
        let result, method;
        if (adaptiveTurn) {
          method = "adaptive";
          result = await thinkAdaptive({ board, sideToMove: side, rule: game.rule, allowSetup: true },
            options => engine.search(options), { budgetMs });
        } else {
          method = "fixed";
          result = await engine.search({ board, sideToMove: side, timeMs: budgetMs, allowSetup: true });
        }
        const elapsedMs = Math.round(performance.now() - started);
        assert.ok(Number.isInteger(result.index) && result.index >= 0 && result.index < 225 && !board[result.index],
          `${id}: ${method} returned an illegal point`);
        const verdict = moveVerdict(board, result.index, side, game.rule);
        assert.equal(verdict.forbidden, "", `${id}: ${method} returned a forbidden move`);
        board[result.index] = side;
        winner = verdict.winner;
        game.moves.push({
          ply: game.openingMoves + game.moves.length + 1,
          color: side, index: result.index, method, elapsedMs,
          engineElapsedMs: result.elapsed ?? null, depth: result.depth ?? null,
          nodes: result.nodes ?? null, nps: result.nps ?? null,
          evaluation: result.assessment?.evaluation ?? null,
          winRate: result.assessment?.winRate ?? null,
          adaptiveStatus: result.adaptive?.status ?? null,
          adaptiveSearches: result.adaptive?.searches ?? null
        });
        side = 3 - side;
        game.winner = winner;
        game.status = winner ? "finished" : "running";
        if (winner) game.finishedAt = new Date().toISOString();
        updateSummary();
        await save();
        console.log(`${report.games.filter(item => item.status === "finished").length} finished | ${id} ply ${game.openingMoves + game.moves.length}: ${colorLabel(side === 1 ? 2 : 1)} ${method} ${result.index} ${elapsedMs}ms${winner ? ` winner=${winner}` : ""}`);
      }
      if (!winner && !board.some(value => value === 0)) {
        game.winner = 3; game.status = "finished"; game.finishedAt = new Date().toISOString();
        updateSummary(); await save();
      }
    }
  }
  report.finishedAt = new Date().toISOString();
  updateSummary();
  await save();
  console.log("FINAL", JSON.stringify(report.summary));
} finally {
  if (typeof engine.dispose === "function") engine.dispose();
}

function colorLabel(color) { return color === 1 ? "black" : "white"; }
