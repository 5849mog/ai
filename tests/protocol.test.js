import test from "node:test";
import assert from "node:assert/strict";
import { boardCommand, searchCommands, parseOutput } from "../engine-protocol.js";

test("BOARD alternates actual colors even when the first row-major stone is white", () => {
  const board = new Uint8Array(225);
  board[0] = 2; board[112] = 1; board[114] = 1;
  const copy = board.slice();
  assert.equal(boardCommand(board, 2), "BOARD\n7,7,2\n0,0,1\n9,7,2\nDONE");
  assert.deepEqual(board, copy);
  board[114] = 0;
  assert.equal(boardCommand(board, 1), "BOARD\n7,7,1\n0,0,2\nDONE");
});
test("empty-board search fully resynchronizes BOARD, time control uses milliseconds", () => {
  assert.equal(boardCommand(new Uint8Array(225), 1), "BOARD\nDONE");
  const commands = searchCommands(new Uint8Array(225), 1, 3400);
  assert.ok(commands.includes("INFO timeout_turn 3400"));
  assert.throws(() => searchCommands(new Uint8Array(225), 1, 0));
});

test("recommendations sync without starting a single-PV search and explicitly request two alternatives", () => {
  const board = new Uint8Array(225); board[112] = 1;
  const original = board.slice();
  assert.deepEqual(searchCommands(board, 2, 2000, 2).slice(-2), ["YXBOARD\n7,7,2\nDONE", "YXNBEST 2"]);
  assert.deepEqual(searchCommands(new Uint8Array(225), 1, 2000, 2).slice(-2), ["YXBOARD\nDONE", "YXNBEST 2"]);
  assert.equal(searchCommands(board, 2, 1000).at(-1), "BOARD\n7,7,2\nDONE");
  assert.throws(() => searchCommands(board, 2, 2000, 3), /推荐数量/);
  assert.deepEqual(board, original);
});
test("output parsing accepts only complete legal coordinates and recognizes diagnostics", () => {
  assert.deepEqual(parseOutput("14,0"), { type: "move", index: 14, x: 14, y: 0 });
  assert.equal(parseOutput("15,0").type, "error");
  assert.equal(parseOutput("1,2 trailing").type, "message");
  assert.equal(parseOutput("ERROR missing model").type, "error");
  assert.deepEqual(parseOutput("INFO TOTALNODES 310"), { type: "stats", stats: { nodes: 310 } });
});

test("mate and numeric evaluations clear each other's stale state", () => {
  let stats = {};
  for (const line of ["INFO EVAL 320", "INFO EVAL -M18"]) stats = { ...stats, ...parseOutput(line).stats };
  assert.equal(stats.mate, "-M18"); assert.equal(stats.evaluation, null);
  stats = { ...stats, ...parseOutput("INFO EVAL -140").stats };
  assert.equal(stats.mate, null); assert.equal(stats.evaluation, -140);
});

test("arbitrary setups sync every actual color and chosen next side without consecutive passes or invented stones", () => {
  for (const [blacks, whites] of [[0, 0], [0, 6], [9, 0], [9, 5], [5, 9], [7, 7]]) for (const side of [1, 2]) {
    const board = Array(225).fill(0);
    for (let i = 0; i < blacks; i++) board[i * 2] = 1;
    for (let i = 0; i < whites; i++) board[195 + i * 2] = 2;
    const before = [...board], decoded = Array(225).fill(0);
    let color = 1, wasPass = false;
    for (const line of boardCommand(board, side, true).split("\n").slice(1, -1)) {
      const [x, y, owner] = line.split(",").map(Number);
      assert.equal(owner, color === side ? 1 : 2);
      const pass = x === -1 && y === -1;
      assert.equal(pass && wasPass, false);
      if (!pass) { const index = y * 15 + x; assert.equal(decoded[index], 0); decoded[index] = color; }
      wasPass = pass; color = 3 - color;
    }
    assert.equal(color, side); assert.deepEqual(decoded, board); assert.deepEqual(board, before);
    assert.equal(searchCommands(board, side, 1000, 2, true).at(-1), "YXNBEST 2");
  }
  const board = Array(225).fill(0); board[112] = 2;
  assert.throws(() => boardCommand(board, 1), /不一致/);
});
