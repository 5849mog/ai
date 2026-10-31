import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateStrengthReport, positionBudgetRows, gameOutcome,
  boardCoordinate, formatPercent
} from "../report-model.js";

const report = JSON.parse(await readFile(new URL("../reports/strength-baseline-v1-summary.json", import.meta.url), "utf8"));

test("cloud strength report validates and preserves all measured rows", () => {
  assert.equal(validateStrengthReport(report), report);
  assert.equal(report.positionRuns.length, 36);
  assert.equal(report.games.length, 8);
  assert.deepEqual(positionBudgetRows(report).map(row => row.budgetMs), [100, 500, 1000]);
  assert.equal(report.matchBudgets.shortMs, 100);
  assert.equal(report.matchBudgets.longMs, 500);
});

test("report viewer rejects malformed or internally inconsistent cloud data", () => {
  const missing = structuredClone(report);
  delete missing.summary.matches;
  assert.throws(() => validateStrengthReport(missing), /汇总/);
  const inconsistent = structuredClone(report);
  inconsistent.summary.matches.wins += 1;
  assert.throws(() => validateStrengthReport(inconsistent), /不一致/);
  const invalidCoordinate = structuredClone(report);
  invalidCoordinate.positionRuns[0].index = 225;
  assert.throws(() => validateStrengthReport(invalidCoordinate), /超出棋盘/);
});

test("paired game labels follow the long-budget color, including draws", () => {
  assert.deepEqual(gameOutcome({ winner: 1, longColor: 1 }), { key: "win", label: "长预算胜", detail: "黑方胜" });
  assert.deepEqual(gameOutcome({ winner: 1, longColor: 2 }), { key: "loss", label: "长预算负", detail: "黑方胜" });
  assert.deepEqual(gameOutcome({ winner: 3, longColor: 2 }), { key: "draw", label: "和棋", detail: "双方和棋" });
});

test("board coordinates and percentages remain readable", () => {
  assert.equal(boardCoordinate(112), "H8");
  assert.equal(boardCoordinate(0), "A1");
  assert.equal(formatPercent(0.6875, 2), "68.75%");
  assert.equal(formatPercent(null), "—");
});
