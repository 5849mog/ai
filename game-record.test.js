import test from "node:test";
import assert from "node:assert/strict";
import { createRecord, replayRecord, serializeRecord, parseRecord, exportSgf, loadGame, saveGame, RECORD_KEY, MAX_RECORD_BYTES } from "./game-record.js";
import { restore } from "./game-rules.js";

const won = [0, 30, 1, 32, 2, 34, 3, 36, 4];
test("chronological records reconstruct both roles, AI turns and independent undo snapshots", () => {
  for (const color of [1, 2]) {
    const record = createRecord([112, 113, 97, 98, 82], color);
    const original = structuredClone(record);
    const game = replayRecord(record);
    assert.equal(game.currentColor, 2); assert.equal(game.lastMove, 82);
    assert.equal(game.rounds.length, color === 1 ? 3 : 2);
    const saved = game.rounds.pop(); restore(game.board, saved);
    assert.equal(saved.moveCount, color === 1 ? 4 : 3);
    assert.equal(game.board.filter(Boolean).length, saved.moveCount);
    game.board.fill(0); assert.equal(saved.board.filter(Boolean).length, saved.moveCount);
    assert.deepEqual(record, original);
    assert.deepEqual(parseRecord(serializeRecord(record)).record, record);
  }
});

test("ended games and a full draw replay correctly; persisted state cannot override rules", () => {
  const game = replayRecord({ ...createRecord(won, 2), winner: 2, board: [3], currentColor: 1 });
  assert.equal(game.winner, 1); assert.equal(game.currentColor, 2);
  assert.equal(game.board.filter(Boolean).length, 9);
  const black = [], white = [];
  for (let i = 0; i < 225; i++) ((i % 15 + 2 * Math.floor(i / 15)) % 4 < 2 ? black : white).push(i);
  assert.equal(black.length, 113);
  const draw = black.flatMap((index, ply) => ply < white.length ? [index, white[ply]] : [index]);
  assert.equal(replayRecord(createRecord(draw, 1)).winner, 3);
  assert.deepEqual(parseRecord(exportSgf(createRecord(draw, 1))).record.moves, draw);
});

test("invalid histories are rejected before replacement", () => {
  for (const moves of [[0, 0], [-1], [225], [1.5], ["1"], [...won, 40], new Array(226).fill(0)]) {
    assert.throws(() => replayRecord(createRecord(moves, 1)));
  }
  for (const patch of [{ version: 2 }, { size: 19 }, { rule: "renju" }, { playerColor: 0 }, { moves: {} }, { format: "other" }]) {
    assert.throws(() => replayRecord({ ...createRecord([], 1), ...patch }));
  }
  assert.throws(() => parseRecord(" "), /无法读取/);
  assert.throws(() => parseRecord(" ".repeat(MAX_RECORD_BYTES + 1)), /过大/);
});

test("SGF round trips corners, both roles and results without trusting declared winners", () => {
  for (const color of [1, 2]) {
    const record = createRecord([0, 224, 14, 210, 112], color);
    const sgf = exportSgf(record, new Date("2026-10-03T00:00:00Z"));
    assert.match(sgf, /;B\[aa\];W\[oo\];B\[oa\];W\[ao\];B\[hh\]/);
    assert.deepEqual(parseRecord(sgf).record, record);
  }
  const result = parseRecord("(;FF[4]GM[4]SZ[15]RE[W+R];B[hh])", 2);
  assert.equal(replayRecord(result.record).winner, 0);
  assert.equal(result.record.playerColor, 2); assert.ok(result.notices.length);
  assert.match(exportSgf(createRecord(won, 1)), /RE\[B\+\]/);
});

test("SGF scanner handles escaped comments and first variations without regex-extracting fake moves", () => {
  const result = parseRecord("\uFEFF(;FF[4]GM[4]SZ[15]C[fake ;B[oo\\] escaped\\\\ \\n text];B[hh](;W[ih](;B[hi])(;B[aa]))(;W[aa]))");
  assert.deepEqual(result.record.moves, [112, 113, 127]);
  assert.match(result.notices.join(), /主线/);
});

test("unsupported SGF rules, setup, pass, wrong order, duplicate properties and malformed collections are rejected", () => {
  const prefix = "(;FF[4]GM[4]SZ[15]";
  for (const tail of ["RU[Renju];B[hh])", "RU[Swap2];B[hh])", "AB[hh])", ";B[hh];PL[B])", "HA[2])", ";B[])" , ";B[pp])", ";W[hh])", ";B[hh];B[ih])", ";B[hh]W[ih])", ";B[hh][ih])", ";B[hh];W[hh])", "C[unfinished)", ";B[hh])garbage", ")".repeat(2)]) {
    assert.throws(() => parseRecord(prefix + tail), tail);
  }
  for (const root of ["(;FF[3]GM[4]SZ[15])", "(;FF[4]GM[1]SZ[15])", "(;FF[4]GM[4]SZ[19])", "(;FF[4]FF[4]GM[4]SZ[15])", "(;FF[4]GM[4]SZ[15])(;FF[4]GM[4]SZ[15])"]) assert.throws(() => parseRecord(root));
});

test("corrupt or blocked storage degrades to a playable new game; actual ordered moves survive", () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(loadGame(storage).game, null);
  const record = createRecord([112], 1);
  assert.equal(saveGame(storage, record), true); assert.ok(values.has(RECORD_KEY));
  assert.deepEqual(loadGame(storage).game.record, record);
  storage.setItem(RECORD_KEY, "broken"); assert.ok(loadGame(storage).error);
  const blocked = { getItem() { throw Error("denied"); }, setItem() { throw Error("quota"); } };
  assert.equal(saveGame(blocked, record), false); assert.ok(loadGame(blocked).error);
});
