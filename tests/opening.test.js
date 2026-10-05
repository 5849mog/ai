import test from "node:test";
import assert from "node:assert/strict";
import { OpeningSession, replaySession, canManualTurn, isAutomaticTurn } from "../opening-session.js";
import { blackForbidden, moveVerdict, distinctCandidates, transform, inCentral } from "../renju-rules.js";
import { adviseOpening } from "../opening-advisor.js";
import { searchCommands } from "../engine-protocol.js";
const stone = (s, index) => s.apply({ type: "stone", index });
const decide = (s, choice = "keep") => s.apply({ type: "decision", choice });
function firstFour(rule, swaps = []) {
  const s = new OpeningSession({ rule });
  for (const [turn, index] of [112, 97, 96, 128].entries()) {
    stone(s, index);
    if (s.decision && s.stage !== "route4") decide(s, swaps[turn] ? "swap" : "keep");
  }
  return s;
}
const same = (a, b) => { assert.deepEqual(a.board, b.board); for (const key of ["stage", "color", "actor", "blackSeat", "winner", "forbidden"]) assert.equal(a[key], b[key], key); assert.deepEqual(a.candidates, b.candidates); };

test("RIF first three belong to one seat, swap changes ownership only, candidates are proposals", () => {
  const s = new OpeningSession({ rule: "rif", initialBlackSeat: 1 });
  assert.throws(() => stone(s, 111));
  for (const i of [112, 97, 96]) { assert.equal(s.actor, 1); stone(s, i); }
  assert.equal(s.stage, "swap3"); assert.equal(s.actor, 0); const board = s.board.slice();
  decide(s, "swap"); assert.equal(s.blackSeat, 0); assert.deepEqual(s.board, board); assert.equal(s.actor, 1);
  stone(s, 128); assert.equal(s.actor, 0);
  const [a, b] = distinctCandidates(s.board, s.allowedMoves()).slice(0, 2);
  s.apply({ type: "offer", index: a }); assert.equal(s.moves.length, 4); assert.equal(s.board[a], 0);
  s.apply({ type: "offer", index: b }); assert.equal(s.stage, "choose"); assert.equal(s.actor, 1);
  const before = replaySession(s.record()); s.apply({ type: "select", index: b }); assert.equal(s.board[b], 1); assert.equal(s.board[a], 0); same(s.undo(), before);
  stone(s, 129); assert.equal(s.stage, "play"); assert.equal(s.color, 1); same(replaySession(s.record()), s);
});
test("RIF central constraints produce exactly 26 opening equivalence classes", () => {
  const keys = new Set();
  for (let second = 0; second < 225; second++) if (second !== 112 && inCentral(second, 3)) {
    for (let third = 0; third < 225; third++) if (![112, second].includes(third) && inCentral(third, 5)) {
      const variants = Array.from({ length: 8 }, (_, symmetry) => `${transform(second, symmetry)}:${transform(third, symmetry)}`).sort(); keys.add(variants[0]);
    }
  }
  assert.equal(keys.size, 26);
});
test("Taraguchi all 32 normal swap branches maintain actual color and the next actor", () => {
  for (let mask = 0; mask < 32; mask++) {
    const s = new OpeningSession({ rule: "taraguchi10" }); let expectedBlack = 0;
    for (let turn = 0; turn < 5; turn++) {
      assert.equal(s.color, turn % 2 + 1); assert.equal(s.actor, s.color === 1 ? expectedBlack : 1 - expectedBlack);
      const allowed = s.allowedMoves(); const previous = s.board.slice(); stone(s, [112, 97, 96, 128, 126][turn]);
      assert.equal(s.actor, turn % 2 === 0 ? 1 - expectedBlack : expectedBlack);
      const swap = Boolean(mask & (1 << turn)); decide(s, swap ? "swap" : "keep"); if (swap) expectedBlack = 1 - expectedBlack;
      assert.equal(s.blackSeat, expectedBlack); assert.equal(s.moves.length, turn + 1); assert.ok(allowed.length); assert.ok(previous.some((v, i) => v !== s.board[i]));
      same(replaySession(s.record()), s);
    }
    assert.equal(s.stage, "w6"); assert.equal(s.actor, 1 - expectedBlack); stone(s, 129); assert.equal(s.stage, "play");
  }
});
test("Ten route accepts full-board proposals, rejects equivalence and restores every partial stage", () => {
  let s = firstFour("taraguchi10", [true, false, true]); const black = s.blackSeat; decide(s, "ten"); assert.equal(s.blackSeat, black);
  const initial = s.record(); const points = distinctCandidates(s.board, s.allowedMoves()).slice(0, 10);
  assert.ok(points.some(i => !inCentral(i, 9)));
  for (const i of points) { const before = replaySession(s.record()); s.apply({ type: "offer", index: i }); same(s.undo(), before); same(replaySession(s.record()), s); assert.equal(s.moves.length, 4); assert.equal(s.board[i], 0); }
  assert.equal(s.stage, "choose"); assert.throws(() => s.apply({ type: "select", index: 112 }));
  s.apply({ type: "select", index: points[7] }); assert.equal(s.moves.length, 5); assert.equal(s.board.filter(Boolean).length, 5); assert.equal(s.actor, 1 - black);
  while (s.events.length > initial.events.length) s = s.undo(); same(s, replaySession(initial));
});
test("Symmetry respects colors and the stabilizer of the existing position", () => {
  const b = new Uint8Array(225); b[112] = 1;
  assert.equal(distinctCandidates(b, [111, 113, 97, 127]).length, 1);
  b[97] = 2; assert.equal(distinctCandidates(b, [111, 113, 127]).length, 2);
});
test("Duel undo returns to the last human action even after ownership swaps", () => {
  const s = new OpeningSession({ rule: "rif", workflow: "duel" });
  for (const i of [112, 97, 96]) stone(s, i);
  const beforeHumanThird = s.undo(); decide(s, "swap"); stone(s, 128);
  assert.equal(s.blackSeat, 1); same(s.undo(), replaySession({ ...s.record(), events: s.events.slice(0, 4) }));
  assert.equal(beforeHumanThird.moves.length, 2);
});
test("Copilot records the whole formal opening, then automates only the user's color", () => {
  const s = new OpeningSession({ rule: "rif", workflow: "copilot", initialBlackSeat: 1 });
  assert.equal(canManualTurn(s), true); assert.equal(isAutomaticTurn(s), false);
  for (const i of [112, 97, 96]) { assert.equal(canManualTurn(s), true); stone(s, i); }
  assert.equal(s.stage, "swap3"); assert.equal(canManualTurn(s), true); decide(s);
  stone(s, 128); const candidates = distinctCandidates(s.board, s.allowedMoves({ safe: true })).slice(0, 2);
  for (const index of candidates) s.apply({ type: "offer", index });
  s.apply({ type: "select", index: candidates[0] }); stone(s, s.allowedMoves({ safe: true })[0]);
  assert.equal(s.stage, "play"); assert.equal(isAutomaticTurn(s), false); assert.equal(canManualTurn(s), true);
  const afterOpening = replaySession(s.record());
  stone(s, s.allowedMoves({ safe: true })[0]);
  assert.equal(isAutomaticTurn(s), true); assert.equal(canManualTurn(s), false);
  s.apply({ type: "stone", index: s.allowedMoves({ safe: true })[0] }, { automatic: true });
  assert.equal(s.events.at(-1).automatic, true); assert.equal(canManualTurn(s), true);
  same(s.undo(), afterOpening);
});
test("Freestyle copilot waits for an explicit handoff and undo returns to the manual opening", () => {
  const s = new OpeningSession({ rule: "freestyle", workflow: "copilot" });
  assert.equal(s.copilotReady, false); assert.equal(canManualTurn(s), true); assert.equal(isAutomaticTurn(s), false);
  stone(s, 112); stone(s, 97); const beforeHandoff = replaySession(s.record());
  s.apply({ type: "handoff" }); assert.equal(isAutomaticTurn(s), true);
  s.apply({ type: "stone", index: s.allowedMoves({ safe: true })[0] }, { automatic: true });
  const replayed = replaySession(s.record()); assert.equal(replayed.copilotReady, true);
  const undone = s.undo(); same(undone, beforeHandoff); assert.equal(undone.copilotReady, false);
});
test("Renju free opening keeps black forbidden moves without forcing the RIF proposal sequence", () => {
  const s = new OpeningSession({ rule: "renju", workflow: "copilot" });
  assert.equal(s.stage, "play"); assert.equal(s.width, 15); assert.equal(s.copilotReady, false);
  const board = points => { const b = new Uint8Array(225); for (const point of points) b[point] = 1; return b; };
  assert.equal(moveVerdict(board([110, 111, 97, 127]), 112, 1, "renju").forbidden, "三三");
  stone(s, 112); assert.equal(isAutomaticTurn(s), false); s.apply({ type: "handoff" }); assert.equal(isAutomaticTurn(s), false);
  stone(s, 97); assert.equal(isAutomaticTurn(s), true);
});
test("Seed continues chosen color, records only continuation, and replay rejects impossible actions", () => {
  const b = new Uint8Array(225); b[112] = b[111] = b[97] = 1; b[140] = 2;
  const s = new OpeningSession({ rule: "rif", seed: { board: b, sideToMove: 2 } }); assert.equal(s.stage, "play"); stone(s, 141); same(s.undo(), new OpeningSession(s.options));
  assert.throws(() => replaySession({ ...s.record(), events: [{ type: "decision", choice: "swap" }] }));
  assert.throws(() => replaySession({ ...s.record(), events: [{ type: "stone", index: 112 }] }));
  assert.throws(() => new OpeningSession({ rule: "invalid" })); assert.throws(() => replaySession({ ...s.record(), events: Array(301).fill({ type: "stone", index: 0 }) }));
});
test("Black forbidden patterns, false threes, white overlines and exact-five priority", () => {
  const board = points => { const b = new Uint8Array(225); for (const p of points) b[p] = 1; return b; };
  assert.equal(blackForbidden(board([109,110,111,113,114]),112), "长连");
  assert.equal(blackForbidden(board([110,111,97,127]),112), "三三");
  assert.equal(blackForbidden(board([109,110,111,82,97,127]),112), "四四");
  assert.equal(blackForbidden(board([110,111]),112), ""); // one straight four does not have two fours
  const falseThree = board([110,111,97,127]); falseThree[109] = falseThree[114] = 2;
  assert.equal(blackForbidden(falseThree,112), "");
  const exact = board([109,110,111,113,114,82,97,127,142]);
  assert.deepEqual(moveVerdict(exact,112,1,"rif"), { winner:1,forbidden:"" });
  const white = Uint8Array.from(board([109,110,111,113,114]),v=>v*2); assert.equal(moveVerdict(white,112,2,"rif").winner,2);
  const s = new OpeningSession({rule:"rif",seed:{board:board([109,110,111,113,114]),sideToMove:1}}); stone(s,112); assert.equal(s.winner,2); assert.equal(s.undo().winner,0);
});
test("Restricted search terminates its block list and cannot leak blocked points into later jobs", () => {
  const b = new Uint8Array(225); b[112]=1;
  const commands=searchCommands(b,2,1000,10,true,{allowedMoves:[97,96]});
  const block=commands.find(c=>c.startsWith("YXBLOCK\n")); assert.ok(block.endsWith("\nDONE")); assert.ok(!block.includes("7,6\n")); assert.equal(commands.at(-1),"YXNBEST 10");
});
test("Opening advice never mutates actual stones and handles swap/choose/offer perspectives", async () => {
  const s=firstFour("rif"); const record=JSON.stringify(s.record());
  const fake=async options=>({index:options.allowedMoves?.[0]??0,assessment:{winRate:.9},recommendations:(options.allowedMoves??[]).slice(0,32).map(index=>({index}))});
  const offered=await adviseOpening(s,fake); assert.equal(offered.points.length,2); assert.equal(JSON.stringify(s.record()),record);
  for(const index of offered.points)s.apply({type:"offer",index}); const chosen=await adviseOpening(s,fake); assert.ok(s.candidates.includes(chosen.points[0])); assert.equal(s.moves.length,4);
  const t=new OpeningSession({rule:"taraguchi10"});stone(t,112);const decision=await adviseOpening(t,fake);assert.equal(decision.choice,"keep");assert.equal(t.stage,"swap1");
});
