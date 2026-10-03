import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import { createDevServer } from "./dev-server.js";
import { validatePosition } from "../game-rules.js";
import { TACTICS, verifyTactic } from "../tests/fixtures/tactics.js";

const history = JSON.parse(await readFile("reports/benchmark.json", "utf8"));
const fixtures = history.games.filter(game => Number(game.opening.slice(-2)) <= 6).map(game => {
  const count = game.rapfiColor === 1 ? 12 : 13;
  const moves = game.moves.slice(0, count);
  const build = length => { const board = Array(225).fill(0); for (const move of moves.slice(0, length)) board[move.index] = move.color; return board; };
  return { id: game.id, sideToMove: game.rapfiColor, board: build(count), parent: build(count - 1), seed: build(count - 2),
    humanMove: moves.at(-1).index, sourcePlies: count };
});
assert.equal(fixtures.length, 12);
const tactical = TACTICS.map(fixture => {
  const parent = [...fixture.board], humanMove = parent.findLastIndex(color => color === 1); parent[humanMove] = 0;
  const seed = [...parent]; seed[seed.findLastIndex(color => color === 2)] = 0;
  return { ...fixture, parent, seed, humanMove, expected: verifyTactic(fixture).expected };
});
for (const fixture of [...fixtures, ...tactical]) {
  validatePosition(fixture.board, fixture.sideToMove); validatePosition(fixture.parent, 3 - fixture.sideToMove);
  validatePosition(fixture.seed, fixture.sideToMove);
  assert.equal(fixture.parent[fixture.humanMove], 0);
}
await mkdir("reports", { recursive: true });
const digest = value => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(await readFile("engine/rapfi-250615/manifest.json", "utf8"));
const identity = { engine: manifest.sourceCommit, networks: manifest.networksCommit, variant: "rapfi-single-simd128", threads: 1,
  memoryMiB: 256, foregroundMs: [1000, 5000], backgroundWindowMs: 5000, seedSearchMs: 1000,
  repetitions: 3, referenceMs: 30000, orderingSeed: 20261003, fixturesSha256: digest(JSON.stringify({ fixtures, tactical })),
  implementationSha256: digest((await Promise.all(["engine.js", "engine-jobs.js", "engine.worker.js", "engine-protocol.js"].map(file => readFile(file)))).map(data => digest(data)).join("")) };
const path = "reports/ponder-benchmark.json";
let report = { identity, fixtures, tacticalFixtures: tactical, startedAt: new Date().toISOString(),
  device: { cpu: os.cpus()[0]?.model, logicalCores: os.cpus().length, ramGiB: +(os.totalmem() / 2**30).toFixed(2), os: `${os.platform()} ${os.release()}`, node: process.version },
  references: [], pairs: [], tactics: [] };
if (process.argv.includes("--resume")) {
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(saved.identity, identity, "Cannot resume a different implementation or fixture set"); report = saved;
}
await writeFile("reports/ponder-fixtures.json", JSON.stringify({ sha256: identity.fixturesSha256, fixtures, tactical }, null, 2) + "\n");
const save = () => writeFile(path, JSON.stringify(report, null, 2) + "\n");
const server = await createDevServer({ port: 0, isolated: false });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage(); const errors = [];
page.on("pageerror", error => errors.push(error.message));
report.device.browser = browser.version();
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/ai/tests/engine-harness.html`);
  assert.equal(await page.evaluate(() => crossOriginIsolated), false);
  // One page, one active engine at a time; only completed pairs are resumable.
  const run = (fixture, budget, enabled) => page.evaluate(async ({ fixture, budget, enabled }) => {
    const { GomokuEngine } = await import("../engine.js");
    const slices = [];
    const engine = new GomokuEngine({ variant: "rapfi-single-simd128", onPonderSlice: slice => slices.push(slice) });
    try {
      await engine.init();
      const seeded = await engine.search({ board: fixture.seed, sideToMove: fixture.sideToMove, timeMs: 1000, requestId: 1 });
      const windowStart = performance.now();
      if (enabled) await engine.ponder({ board: fixture.parent, sideToMove: 3 - fixture.sideToMove, requestId: 2 });
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 5000 - (performance.now() - windowStart))));
      const submitted = performance.now();
      const original = [...fixture.board];
      const result = await engine.search({ board: fixture.board, sideToMove: fixture.sideToMove, timeMs: budget, requestId: 3 });
      const endToEndMs = performance.now() - submitted;
      if (JSON.stringify(fixture.board) !== JSON.stringify(original)) throw new Error("Search mutated its fixture");
      return { enabled, result, endToEndMs, seed: seeded, slices,
        backgroundSearchMs: slices.reduce((sum, slice) => sum + slice.elapsed, 0),
        backgroundNodes: slices.every(slice => Number.isFinite(slice.nodes)) ? slices.reduce((sum, slice) => sum + slice.nodes, 0) : null,
        backgroundNodesKnown: slices.reduce((sum, slice) => sum + (slice.nodes ?? 0), 0), windowMs: submitted - windowStart };
    } finally { engine.dispose(); }
  }, { fixture, budget, enabled });

  for (const fixture of fixtures) {
    if (report.references.some(row => row.id === fixture.id)) continue;
    const result = await page.evaluate(async fixture => {
      const { GomokuEngine } = await import("../engine.js"); const engine = new GomokuEngine({ variant: "rapfi-single-simd128" });
      try { return await engine.search({ board: fixture.board, sideToMove: fixture.sideToMove, timeMs: 30000, requestId: 1, multiPV: 2 }); }
      finally { engine.dispose(); }
    }, fixture);
    report.references.push({ id: fixture.id, result }); await save(); console.log(`REFERENCE ${report.references.length}/12 ${fixture.id} depth=${result.depth ?? "—"} mate=${result.mate ?? "—"}`);
  }
  for (let index = 0; index < fixtures.length; index++) {
    const fixture = fixtures[index];
    for (const budget of identity.foregroundMs) for (let repetition = 0; repetition < 3; repetition++) {
      const id = `${fixture.id}-${budget}-${repetition}`;
      if (report.pairs.some(row => row.id === id)) continue;
      const onFirst = (identity.orderingSeed + index + repetition + (budget === 5000 ? 1 : 0)) % 2 === 0;
      const first = await run(fixture, budget, onFirst), second = await run(fixture, budget, !onFirst);
      report.pairs.push({ id, fixtureId: fixture.id, budgetMs: budget, repetition, order: onFirst ? "on-off" : "off-on",
        on: onFirst ? first : second, off: onFirst ? second : first });
      await save(); console.log(`PAIR ${report.pairs.length}/72 ${id} moves=${first.result.index}/${second.result.index}`);
    }
  }
  for (let index = 0; index < tactical.length; index++) {
    const fixture = tactical[index]; if (report.tactics.some(row => row.id === fixture.id)) continue;
    const firstOn = index % 2 === 0;
    const first = await run(fixture, 1000, firstOn), second = await run(fixture, 1000, !firstOn);
    const on = firstOn ? first : second, off = firstOn ? second : first;
    report.tactics.push({ id: fixture.id, expected: fixture.expected, on, off, onCorrect: fixture.expected.includes(on.result.index), offCorrect: fixture.expected.includes(off.result.index) });
    await save(); console.log(`TACTIC ${report.tactics.length}/12 ${fixture.id}: on=${fixture.expected.includes(on.result.index)} off=${fixture.expected.includes(off.result.index)}`);
  }
  assert.deepEqual(errors, []); report.completedAt = new Date().toISOString(); report.browserErrors = errors; report.complete = true; await save();
  console.log("COMPLETE fixed-position background comparison");
} catch (error) { report.failure = error.stack; await save(); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
