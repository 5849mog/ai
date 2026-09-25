import test from "node:test";
import assert from "node:assert/strict";
import { hasFive, SIZE } from "./engine.js";
import {
  applyPlayerMove,
  applyWhiteRemoval,
  captureTurnSnapshot,
  mirrorIndex,
  planPlayerMove,
  planWhiteRemoval,
  restoreTurnSnapshot
} from "./game-rules.js";

const index = (x, y) => y * SIZE + x;

test("double placement validates both distinct empty points before changing the board", () => {
  const board = new Uint8Array(SIZE * SIZE);
  const first = index(5, 6);
  const second = index(8, 9);

  const plan = planPlayerMove(board, "double", [first, second]);
  assert.deepEqual(plan, {
    ok: true,
    placements: [first, second],
    skipAI: false,
    consumedSkill: "double"
  });

  const samePoint = applyPlayerMove(board, "double", [first, first]);
  assert.equal(samePoint.ok, false);
  assert.equal(board[first], 0, "invalid skill use must be atomic");

  board[second] = 2;
  const occupiedPoint = applyPlayerMove(board, "double", [first, second]);
  assert.equal(occupiedPoint.ok, false);
  assert.equal(board[first], 0, "a rejected pair cannot leave a partial stone");
});

test("a legal double skill applies both stones even when they jointly finish a line", () => {
  const board = new Uint8Array(SIZE * SIZE);
  for (let x = 4; x < 8; x += 1) board[index(x, 7)] = 1;

  const winPoint = index(8, 7);
  const secondPoint = index(10, 9);
  const plan = applyPlayerMove(board, "double", [winPoint, secondPoint]);

  assert.equal(plan.ok, true);
  assert.equal(board[winPoint], 1);
  assert.equal(board[secondPoint], 1);
  assert.equal(hasFive(board, 8, 7, 1), true);
});

test("mirror mapping is rotational, symmetric, and rejects center or occupied pairs", () => {
  const center = index(7, 7);
  const target = index(2, 4);
  const opposite = mirrorIndex(target);
  const board = new Uint8Array(SIZE * SIZE);

  assert.equal(mirrorIndex(center), center);
  assert.equal(mirrorIndex(opposite), target);
  assert.equal(mirrorIndex(-1), -1);
  assert.equal(planPlayerMove(board, "mirror", [center]).ok, false);

  board[opposite] = 2;
  const rejected = applyPlayerMove(board, "mirror", [target]);
  assert.equal(rejected.ok, false);
  assert.equal(board[target], 0, "an occupied mirror point cannot consume or partially apply the skill");

  board[opposite] = 0;
  const accepted = applyPlayerMove(board, "mirror", [target]);
  assert.equal(accepted.ok, true);
  assert.equal(board[target], 1);
  assert.equal(board[opposite], 1);
});

test("freeze grants one extra player action without weakening its placement plan", () => {
  const board = new Uint8Array(SIZE * SIZE);
  const point = index(6, 7);
  const plan = applyPlayerMove(board, "freeze", [point]);

  assert.equal(plan.ok, true);
  assert.equal(plan.skipAI, true);
  assert.equal(board[point], 1);
  assert.equal(planPlayerMove(board, "freeze", [index(7, 7)]).ok, true);
  assert.equal(planPlayerMove(board, "freeze", [point]).ok, false);
});

test("white removal only accepts an AI stone and does not mutate on rejection", () => {
  const board = new Uint8Array(SIZE * SIZE);
  const black = index(3, 3);
  const white = index(4, 4);
  board[black] = 1;
  board[white] = 2;

  assert.equal(planWhiteRemoval(board, black).ok, false);
  assert.equal(applyWhiteRemoval(board, -1).ok, false);
  assert.equal(board[black], 1);
  assert.equal(board[white], 2);

  const result = applyWhiteRemoval(board, white);
  assert.equal(result.ok, true);
  assert.equal(board[white], 0);
});

test("round snapshots restore board, spent skills, and last-move marker together", () => {
  const board = new Uint8Array(SIZE * SIZE);
  board[index(7, 7)] = 1;
  const usedSkills = new Set(["mirror"]);
  const lastMove = index(7, 7);
  const snapshot = captureTurnSnapshot(board, usedSkills, lastMove);

  board[index(8, 7)] = 2;
  usedSkills.add("freeze");
  const restored = restoreTurnSnapshot(board, snapshot);

  assert.equal(board[index(8, 7)], 0);
  assert.equal(board[index(7, 7)], 1);
  assert.deepEqual([...restored.usedSkills], ["mirror"]);
  assert.equal(restored.lastMove, lastMove);
  assert.notEqual(snapshot.board, board, "snapshot owns a detached board copy");
});
