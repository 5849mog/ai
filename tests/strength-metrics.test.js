import test from "node:test";
import assert from "node:assert/strict";
import { gameScore, quantile, summarizeGames, summarizePositions, summarizeSearches } from "../scripts/strength-metrics.js";

test("search metrics keep wall time, engine nodes and depth separate", () => {
  const rows = [
    { wallMs: 100, result: { elapsed: 90, nodes: 1000, depth: 8 } },
    { wallMs: 300, result: { elapsed: 250, nodes: 3000, depth: 10 } },
    { wallMs: 200, result: { elapsed: 180, nodes: 2000, depth: 9 } }
  ];
  assert.deepEqual(summarizeSearches(rows), {
    searches: 3, meanWallMs: 200, medianWallMs: 200, p90WallMs: 300,
    maxWallMs: 300, meanEngineMs: 520 / 3, totalNodes: 6000,
    meanNodes: 2000, meanDepth: 9, completeNodeStats: true
  });
  assert.equal(quantile([], .5), null);
  assert.equal(summarizeSearches([{ wallMs: 20, result: {} }]).totalNodes, null);
});

test("position metrics distinguish tactical proof success from search volume", () => {
  const rows = [
    { kind: "win", correct: true, wallMs: 10, result: { nodes: 10 } },
    { kind: "vcf", correct: false, wallMs: 20, result: { nodes: 20 } },
    { kind: "block", correct: true, wallMs: 30, result: { nodes: 30 } }
  ];
  const summary = summarizePositions(rows);
  assert.equal(summary.cases, 3);
  assert.equal(summary.solved, 2);
  assert.equal(summary.successRate, 2 / 3);
  assert.equal(summary.mateCases, 2);
  assert.equal(summary.mateSolved, 1);
  assert.equal(summary.byKind.vcf.successRate, 0);
  assert.equal(summary.byKind.block.successRate, 1);
});

test("paired-match scoring swaps colors and counts draws as half", () => {
  const games = [
    { winner: 1, longColor: 1 },
    { winner: 2, longColor: 1 },
    { winner: 3, longColor: 2 }
  ];
  assert.deepEqual(games.map(game => gameScore(game)), [1, 0, .5]);
  assert.deepEqual(summarizeGames(games), {
    games: 3, wins: 1, draws: 1, losses: 1, points: 1.5, winRate: 1 / 3, scoreRate: .5
  });
  assert.equal(gameScore({ winner: 0, longColor: 1 }), null);
});
