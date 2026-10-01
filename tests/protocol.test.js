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
test("empty-board search uses BEGIN, time control uses milliseconds", () => {
  assert.equal(boardCommand(new Uint8Array(225), 1), "BEGIN");
  const commands = searchCommands(new Uint8Array(225), 1, 3400);
  assert.ok(commands.includes("INFO timeout_turn 3400"));
  assert.throws(() => searchCommands(new Uint8Array(225), 1, 0));
});
test("output parsing accepts only complete legal coordinates and recognizes diagnostics", () => {
  assert.deepEqual(parseOutput("14,0"), { type: "move", index: 14, x: 14, y: 0 });
  assert.equal(parseOutput("15,0").type, "error");
  assert.equal(parseOutput("1,2 trailing").type, "message");
  assert.equal(parseOutput("ERROR missing model").type, "error");
  assert.deepEqual(parseOutput("INFO TOTALNODES 310"), { type: "stats", stats: { nodes: 310 } });
});
