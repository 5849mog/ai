import test from "node:test";
import assert from "node:assert/strict";
import { SIZE, CELL_COUNT, hasFive, outcome, validatePosition, snapshot, restore } from "./game-rules.js";
const at = (x,y) => y * SIZE + x;

test("five and overline detection works in every direction and at borders", () => {
  for (const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]) {
    for (const length of [5,6]) {
      const board = new Uint8Array(CELL_COUNT);
      for (let n = 0; n < length; n++) board[at(dx ? n : 0, dy < 0 ? 14-n : dy*n)] = 1;
      assert.ok(hasFive(board, 0, dy < 0 ? 14 : 0, 1));
      assert.equal(hasFive(board, 0, dy < 0 ? 14 : 0, 2), false);
    }
  }
  assert.equal(hasFive(new Uint8Array(CELL_COUNT), 0, 0, 0), false);
  assert.equal(hasFive(new Uint8Array(CELL_COUNT), 15, 0, 1), false);
  assert.equal(hasFive(new Uint8Array(CELL_COUNT).fill(1), 7.5, 7.5, 1), false);
});

test("a full board without five is a draw", () => {
  const board = Uint8Array.from({ length: CELL_COUNT }, (_,i) => ((i % SIZE + 2 * Math.floor(i / SIZE)) % 4 < 2 ? 1 : 2));
  for (let i = 0; i < CELL_COUNT; i++) assert.equal(hasFive(board, i % SIZE, Math.floor(i / SIZE), board[i]), false);
  assert.equal(outcome(board, CELL_COUNT - 1), 3);
});

test("validation rejects invalid cells, wrong side, terminal positions and full boards", () => {
  assert.throws(() => validatePosition([0], 1), /225/);
  const board = new Uint8Array(CELL_COUNT);
  validatePosition(board, 1);
  board[112] = 1;
  validatePosition(board, 2);
  assert.throws(() => validatePosition(board, 1), /不一致/);
  board[0] = 3;
  assert.throws(() => validatePosition(board, 2), /225/);
  const won = new Uint8Array(CELL_COUNT);
  for (let x = 0; x < 5; x++) won[at(x,7)] = 1;
  for (const x of [0,2,4,6]) won[at(x,0)] = 2;
  assert.throws(() => validatePosition(won, 2), /结束/);
  assert.throws(() => validatePosition(new Uint8Array(CELL_COUNT).fill(1), 2));
});

test("round snapshots restore before the human turn and keep an independent copy", () => {
  const board = new Uint8Array(CELL_COUNT);
  board[112] = 1; board[113] = 2;
  const saved = snapshot(board, 113);
  board[97] = 1; board[98] = 2;
  assert.equal(restore(board, saved), 113);
  assert.equal(board[97], 0); assert.equal(board[98], 0);
  board[112] = 0;
  assert.equal(saved.board[112], 1);
});
