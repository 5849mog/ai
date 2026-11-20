import test from "node:test";
import assert from "node:assert/strict";
import { endgameEstimate, immediateEnding } from "../endgame-estimate.js";
import { PositionAnalysis } from "../position-analysis.js";

test("terminal estimates follow the current principal variation and never follow its old count onto another board", () => {
  const analysis = new PositionAnalysis([112], 1);
  const estimate = (overrides = {}) => endgameEstimate({ available: true, point: analysis.current, emptyCount: 220, ...overrides });
  const submit = (requestId, depth, mate) => analysis.accept({ requestId, sideToMove: 2,
    stats: { assessment: { depth, bestIndex: 113, winRate: .99, mate } } });
  analysis.begin(1, 2);
  submit(1, 9, null); assert.equal(estimate().text, "暂无明确终局");
  submit(1, 10, "-M4"); assert.equal(estimate().text, "约4 手 · 黑胜");
  submit(1, 11, "+M3"); assert.equal(estimate().text, "约3 手 · 白胜");
  submit(0, 12, "+M1"); assert.equal(estimate().short, "约3 手");
  assert.equal(estimate({ emptyCount: 2 }).short, "");
  analysis.advanceAi([112, 113], 113, { bestIndex: 113, depth: 11 });
  assert.equal(estimate().short, "");
  analysis.setPosition([112], 1); assert.equal(estimate().short, "约3 手");
  assert.equal(estimate({ winner: 2 }).text, "已结束");
  assert.equal(estimate({ available: false }).short, "");
});

test("one-move wins honor the current rules and do not modify the board", () => {
  const board = new Uint8Array(225);
  for (const index of [0, 1, 2, 3, 5]) board[index] = 1;
  const before = board.slice();
  assert.deepEqual(immediateEnding(board, 1, "freestyle", [4]), { plies: 1, winner: 1 });
  assert.equal(immediateEnding(board, 1, "renju", [4]), null);
  board[5] = 0;
  assert.deepEqual(immediateEnding(board, 1, "renju", [4]), { plies: 1, winner: 1 });
  board[5] = 1; assert.deepEqual(board, before);
});
