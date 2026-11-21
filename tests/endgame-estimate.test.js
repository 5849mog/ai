import test from "node:test";
import assert from "node:assert/strict";
import { endgameEstimate, immediateEnding, tacticalPosition, explainMove } from "../endgame-estimate.js";
import { PositionAnalysis } from "../position-analysis.js";

test("terminal estimates follow the current principal variation and never follow its old count onto another board", () => {
  const analysis = new PositionAnalysis([112], 1);
  const estimate = (overrides = {}) => endgameEstimate({ available: true, point: analysis.current, emptyCount: 220, ...overrides });
  const submit = (requestId, depth, mate) => analysis.accept({ requestId, sideToMove: 2,
    stats: { assessment: { depth, bestIndex: 113, winRate: .99, mate } } });
  analysis.begin(1, 2);
  submit(1, 9, null); assert.equal(estimate().text, "暂无明确终局");
  submit(1, 10, "-M4"); assert.equal(estimate().text, "约4 手 · 黑胜");
  assert.equal(estimate().source, "engine");
  submit(1, 11, "+M3"); assert.equal(estimate().text, "约3 手 · 白胜");
  submit(0, 12, "+M1"); assert.equal(estimate().short, "约3 手");
  assert.equal(estimate({ emptyCount: 2 }).short, "");
  analysis.advanceAi([112, 113], 113, { bestIndex: 113, depth: 11 });
  assert.equal(estimate().short, "");
  analysis.setPosition([112], 1); assert.equal(estimate().short, "约3 手");
  assert.equal(estimate({ winner: 2 }).text, "已结束");
  assert.equal(estimate({ available: false }).short, "");
  assert.equal(estimate({ immediate: { plies: 1, winner: 1 } }).source, "board");
});

test("live tactical labels distinguish a legal win, a needed block, and two remaining win points", () => {
  const board = new Uint8Array(225), allowed = [...board.keys()];
  for (const index of [111,112,113,114]) board[index] = 2;
  let summary = tacticalPosition(board, 1, "freestyle", allowed);
  assert.deepEqual(summary, { wins: [], threats: [110, 115] });
  assert.equal(explainMove(board, 110, 1, "freestyle", summary), "对手仍有胜点");
  board[110] = 1;
  summary = tacticalPosition(board, 1, "freestyle", allowed);
  assert.deepEqual(summary.threats, [115]);
  assert.equal(explainMove(board, 115, 1, "freestyle", summary), "挡下一手即胜点");
  assert.equal(explainMove(board, 85, 1, "freestyle", summary), "未挡对手胜点");
  const wins = tacticalPosition(board, 2, "freestyle", allowed);
  assert.equal(explainMove(board, 115, 2, "freestyle", wins), "落下即胜");
  board.fill(0);
  for (const index of [111, 112, 114]) board[index] = 1;
  summary = tacticalPosition(board, 1, "renju", allowed);
  assert.equal(explainMove(board, 113, 1, "renju", summary), "形成多个胜点");
  board[110] = board[115] = 1;
  assert.ok(!tacticalPosition(board, 1, "renju", allowed).wins.includes(113));
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
