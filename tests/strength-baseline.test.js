import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TACTICS, verifyTactic } from "./fixtures/tactics.js";
import { summarizeGames } from "../scripts/strength-metrics.js";

test("frozen strength summary preserves every tactical answer and paired outcome", async () => {
  const report = JSON.parse(await readFile(new URL("../reports/strength-baseline-v1-summary.json", import.meta.url)));
  assert.equal(report.complete, true);
  const fixtures = new Map(TACTICS.map(fixture => [fixture.id, { ...fixture, ...verifyTactic(fixture) }]));
  for (const budget of [100, 500, 1000]) {
    const runs = report.positionRuns.filter(run => run.budgetMs === budget);
    assert.equal(runs.length, fixtures.size);
    const expected = report.summary.positions[budget];
    assert.equal(expected.solved, runs.filter(run => run.correct).length);
    assert.equal(expected.successRate, runs.filter(run => run.correct).length / runs.length);
  }
  for (const run of report.positionRuns) {
    const fixture = fixtures.get(run.fixtureId);
    assert.ok(fixture);
    assert.equal(run.correct, fixture.expected.includes(run.index));
    assert.equal(fixture.board[run.index], 0);
  }
  assert.equal(report.games.length, 8);
  assert.equal(new Set(report.games.map(game => game.id)).size, 8);
  for (const opening of new Set(report.games.map(game => game.openingId))) {
    assert.deepEqual(report.games.filter(game => game.openingId === opening).map(game => game.longColor).sort(), [1, 2]);
  }
  assert.ok(report.games.every(game => [1, 2, 3].includes(game.winner)));
  assert.deepEqual(report.summary.matches, summarizeGames(report.games));
});
