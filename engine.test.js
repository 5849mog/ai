import test from "node:test";
import assert from "node:assert/strict";
import { chooseMove, findImmediateWins, hasFive, LEVELS, SIZE } from "./engine.js";

const index = (x, y) => y * SIZE + x;

test("the engine takes an immediate winning point", () => {
  const board = new Uint8Array(SIZE * SIZE);
  for (let x = 4; x <= 7; x += 1) board[index(x, 7)] = 2;

  const wins = findImmediateWins(board, 2);
  const result = chooseMove(board, 1);

  assert.ok(wins.includes(result.index));
  assert.equal(result.reason, "win");
  assert.equal(board[result.index], 0, "search must leave the input board unchanged");
});

test("the engine blocks a single immediate opponent win", () => {
  const board = new Uint8Array(SIZE * SIZE);
  for (let x = 5; x <= 8; x += 1) board[index(x, 6)] = 1;
  board[index(4, 6)] = 2;

  const threats = findImmediateWins(board, 1);
  const result = chooseMove(board, 1);

  assert.equal(threats.length, 1);
  assert.ok(threats.includes(result.index));
  assert.equal(result.reason, "block");
});

test("the opening move is the center and all returned moves are legal", () => {
  const empty = new Uint8Array(SIZE * SIZE);
  const opening = chooseMove(empty, 4);
  assert.equal(opening.index, index(7, 7));

  const board = new Uint8Array(SIZE * SIZE);
  board[index(7, 7)] = 1;
  board[index(8, 7)] = 2;
  const reply = chooseMove(board, 4);
  assert.ok(reply.index >= 0 && reply.index < SIZE * SIZE);
  assert.equal(board[reply.index], 0);
});

test("five-in-a-row detection works in all four directions", () => {
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const board = new Uint8Array(SIZE * SIZE);
    for (let step = 0; step < 5; step += 1) {
      board[index(5 + dx * step, 7 + dy * step)] = 1;
    }
    assert.equal(hasFive(board, 5 + dx * 2, 7 + dy * 2, 1), true);
  }
});

test("difficulty tiers are monotonic and keep the same engine stack", () => {
  assert.equal(LEVELS.length, 12);
  for (let i = 1; i < LEVELS.length; i += 1) {
    assert.ok(LEVELS[i].ms > LEVELS[i - 1].ms);
    assert.ok(LEVELS[i].root > LEVELS[i - 1].root);
    assert.ok(LEVELS[i].branch >= LEVELS[i - 1].branch);
    assert.ok(LEVELS[i].depth >= LEVELS[i - 1].depth);
    assert.ok(LEVELS[i].extensions >= LEVELS[i - 1].extensions);
  }
});

test("the engine recognizes a forcing four with a single required block", () => {
  const board = new Uint8Array(SIZE * SIZE);
  board[index(4, 7)] = 1;
  board[index(5, 7)] = 2;
  board[index(6, 7)] = 2;
  board[index(7, 7)] = 2;
  const result = chooseMove(board, 8);

  assert.equal(board[index(8, 7)], 0);
  assert.ok(result.index >= 0 && result.index < SIZE * SIZE);
  assert.equal(board[result.index], 0);
});
