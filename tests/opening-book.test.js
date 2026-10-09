import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createOpeningBook } from "../opening-book.js";
import { RIF_OPENINGS } from "../rif-opening-pool.js";
import { OpeningSession, replaySession, isAutomaticTurn } from "../opening-session.js";
import { transform, moveVerdict } from "../renju-rules.js";

const fixturePool = [
  { key: "diagonal-a", points: [112, 96, 80] },
  { key: "direct-a", points: [112, 97, 80] },
  { key: "direct-b", points: [112, 97, 81] }
];
const store = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values }; };
const automatic = (workflow = "copilot") => new OpeningSession({ rule: "rif", workflow, initialBlackSeat: workflow === "duel" ? 1 : 0 });
function finish(book, session) {
  const initial = book.plan(session);
  while (["b1", "w2", "b3"].includes(session.stage)) {
    const plan = book.plan(session); assert.deepEqual(plan.points, initial.points);
    const index = plan.points[session.moves.length]; assert.equal(isAutomaticTurn(session), true);
    assert.equal(session.canPoint(index), true); assert.equal(moveVerdict(session.board, index, session.color, session.rule).forbidden, "");
    session.apply({ type: "stone", index }, { automatic: true }); book.remember(session);
  }
  assert.equal(session.stage, "swap3"); assert.deepEqual(session.colors, [1, 2, 1]);
  assert.deepEqual(replaySession(session.record()).board, session.board);
  return initial;
}

test("automatic opening plans remain fixed throughout a batch and history is consumed only after the third stone", () => {
  const storage = store(), book = createOpeningBook({ pool: fixturePool, storage, random: () => .9 });
  const session = automatic(), plan = book.plan(session);
  const copy = book.snapshot(session); copy.points[1] = 0;
  assert.notEqual(book.plan(session).points[1], 0);
  session.apply({ type: "stone", index: 112 }, { automatic: true }); book.remember(session);
  assert.equal(storage.values.size, 0); assert.deepEqual(book.plan(session).points, plan.points);
  finish(book, session); assert.equal(storage.values.size, 1);
  const history = [...storage.values.values()][0]; book.remember(session);
  assert.equal([...storage.values.values()][0], history);
});

test("consecutive completed games change opening class even with a constant random source and survive reload", () => {
  const storage = store(); let previous;
  for (let game = 0; game < 12; game++) {
    const book = createOpeningBook({ pool: fixturePool, storage, random: () => 0 });
    const picked = finish(book, automatic()); assert.notEqual(picked.key, previous); previous = picked.key;
  }
});

test("saved partial plans restore the same remaining stone and reject tampered or incompatible metadata", () => {
  const original = createOpeningBook({ pool: fixturePool, random: () => .95 }), session = automatic();
  const picked = original.plan(session);
  for (const index of picked.points.slice(0, 2)) session.apply({ type: "stone", index }, { automatic: true });
  const saved = original.snapshot(session), restored = replaySession(session.record());
  const next = createOpeningBook({ pool: fixturePool, random: () => 0 });
  assert.equal(next.restore(restored, saved), true); assert.deepEqual(next.plan(restored).points, picked.points);
  assert.equal(next.restore(restored, { ...saved, points: [112, 0, picked.points[2]] }), false);
  assert.equal(next.restore(restored, { ...saved, key: "unknown" }), false);
  assert.equal(next.restore(restored, { ...saved, points: [112, saved.points[1], 999] }), false);
  assert.equal(next.restore(restored, { ...saved, points: [] }), false);
  finish(next, restored);
});

test("manual openings, other modes, setups and legacy unmatched prefixes continue through the search advisor", () => {
  const book = createOpeningBook({ pool: fixturePool, random: () => 0 });
  for (const session of [new OpeningSession({ workflow: "follow" }), new OpeningSession({ workflow: "copilot", initialBlackSeat: 1 }),
    new OpeningSession({ workflow: "duel", initialBlackSeat: 0 }), new OpeningSession({ initialBlackSeat: null }),
    new OpeningSession({ rule: "taraguchi10" }), new OpeningSession({ rule: "renju" }),
    new OpeningSession({ seed: { board: new Uint8Array(225), sideToMove: 1 } })]) assert.equal(book.plan(session), null);
  const legacy = automatic(); legacy.apply({ type: "stone", index: 112 }, { automatic: true }); legacy.apply({ type: "stone", index: 98 }, { automatic: true });
  const directOnly = createOpeningBook({ pool: fixturePool.filter(entry => entry.key.startsWith("direct")), random: () => 0 });
  assert.equal(directOnly.plan(legacy), null); assert.equal(legacy.moves.length, 2);
});

test("blocked or corrupt optional history cannot prevent play or cause an immediate repeated class", () => {
  for (const saved of ["broken", "{}", '["unknown",null,99]']) {
    const book = createOpeningBook({ pool: fixturePool, storage: { getItem: () => saved, setItem: () => { throw new Error("quota"); } }, random: () => 0 });
    const first = finish(book, automatic()), second = finish(book, automatic("duel")); assert.notEqual(first.key, second.key);
  }
  const empty = createOpeningBook({ pool: [], random: () => 1 }); assert.equal(empty.plan(automatic()), null);
});

test("every shipped pool class and all its rotations preserve RIF legality and both swap outcomes", () => {
  assert.ok(RIF_OPENINGS.length >= 2);
  const classes = new Set();
  for (const entry of RIF_OPENINGS) {
    const canonical = Array.from({ length: 8 }, (_, s) => entry.points.slice(1).map(i => transform(i, s))).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0].join(":");
    assert.equal(classes.has(canonical), false); classes.add(canonical);
    for (let symmetry = 0; symmetry < 8; symmetry++) for (const swap of ["keep", "swap"]) {
      const session = automatic();
      for (const point of entry.points) {
        const index = transform(point, symmetry); assert.equal(session.canPoint(index), true);
        assert.equal(moveVerdict(session.board, index, session.color, "rif").forbidden, ""); session.apply({ type: "stone", index }, { automatic: true });
      }
      assert.equal(session.actor, 1); const board = session.board.slice(); session.apply({ type: "decision", choice: swap });
      assert.deepEqual(session.board, board); assert.equal(session.blackSeat, swap === "swap" ? 1 : 0);
    }
  }
});

test("shipped pool entries have both recorded screening budgets and satisfy the declared quality floor", async () => {
  const report = JSON.parse(await readFile(new URL("../reports/opening-pool-evaluation-v1.json", import.meta.url), "utf8"));
  const reference = JSON.parse(await readFile(new URL("../reports/opening-pool-reference-v1.json", import.meta.url), "utf8"));
  assert.equal(report.cases.length, 52);
  assert.equal(reference.cases.length, 3);
  const implementation = createHash("sha256").update(await readFile(new URL("../scripts/renju-node-engine.js", import.meta.url))).digest("hex");
  for (const file of [report, reference]) {
    assert.equal(file.implementation, implementation);
    assert.equal(file.casesSha256, createHash("sha256").update(JSON.stringify(file.cases)).digest("hex"));
  }
  for (const entry of RIF_OPENINGS) {
    const cases = [...report.cases, ...reference.cases].filter(result => result.key === entry.key);
    assert.deepEqual(cases.map(result => result.budget).sort((a, b) => a - b), [1000, 3000, 10000]);
    for (const result of cases) { assert.deepEqual(result.points, entry.points); assert.ok(result.openerUtility >= entry.minimumUtility); assert.equal(result.fifths.length, 2); }
  }
});
