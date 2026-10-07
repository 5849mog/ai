import test from "node:test";
import assert from "node:assert/strict";
import { createRecord } from "./game-record.js";
import { OpeningSession, RULES } from "./opening-session.js";
import { reviewFrames, analyzeReview, reviewHighlights } from "./game-review.js";

const finished = () => createRecord([0, 15, 1, 16, 2, 17, 3, 18, 4], 1);
test("review is terminal only, leaves records immutable and includes every actual stone", () => {
  assert.throws(() => reviewFrames(createRecord([112], 1)), /结束/);
  const record = finished(), copy = structuredClone(record), review = reviewFrames(record);
  assert.equal(review.winner, 1); assert.equal(review.frames.length, 10); assert.equal(review.moves.length, 9);
  assert.deepEqual(record, copy); assert.equal(review.frames.at(-1).board[4], 1);
  review.frames[1].board[0] = 2; assert.equal(review.frames[2].board[0], 1);
});

function finishSession(s) {
  let n = 0;
  while (!s.winner && n++ < 225) s.apply({ type: "stone", index: s.allowedMoves({ safe: true })[0] });
  assert.ok(s.winner); return s;
}
test("all four rules replay terminal boards with accurate owners, colors and opening actions", () => {
  for (const rule of Object.keys(RULES)) for (const opener of [0, 1]) for (const swap of [false, true]) {
    const s = new OpeningSession({ rule, initialBlackSeat: opener });
    if (["rif", "taraguchi10"].includes(rule)) {
      for (const index of [112, 97, 96, 128, 126]) {
        if (s.offerCount) break;
        s.apply({ type: "stone", index });
        if (s.decision) s.apply({ type: "decision", choice: swap ? "swap" : "keep" });
      }
      if (s.offerCount) {
        for (const index of s.allowedMoves({ safe: true }).slice(0, 2)) s.apply({ type: "offer", index });
        s.apply({ type: "select", index: s.candidates[1] });
      }
    }
    finishSession(s); const original = JSON.stringify(s.record()), review = reviewFrames(s.record());
    assert.deepEqual(review.frames.at(-1).board, s.board); assert.equal(review.frames.length, s.events.length + 1);
    if (rule === "rif") {
      const proposals = review.frames.filter(f => f.label.startsWith("第五手候选"));
      assert.equal(proposals.length, 2); assert.equal(proposals[1].board.filter(Boolean).length, 4);
      assert.equal(proposals[1].candidates.length, 2); assert.equal(review.moves[0].ply, 6);
    }
    for (const move of review.moves) { assert.equal(move.actor, move.color === s.playerColor ? 0 : 1); assert.equal(move.after[move.index], move.color); }
    assert.equal(JSON.stringify(s.record()), original);
  }
});

test("Taraguchi ten route retains A1…A10 before selected fifth and never analyzes hypothetical candidates", () => {
  const s = new OpeningSession({ rule: "taraguchi10" });
  for (const index of [112, 97, 96, 128]) { s.apply({ type: "stone", index }); if (s.stage !== "route4") s.apply({ type: "decision", choice: "keep" }); }
  s.apply({ type: "decision", choice: "ten" });
  for (const index of s.allowedMoves({ safe: true }).slice(0, 10)) s.apply({ type: "offer", index });
  const chosen = s.candidates[7], rejected = s.candidates[6]; s.apply({ type: "select", index: chosen }); finishSession(s);
  const review = reviewFrames(s.record()), proposals = review.frames.find(f => f.candidates.length === 10);
  assert.equal(proposals.board.filter(Boolean).length, 4); assert.equal(proposals.board[chosen], 0); assert.equal(proposals.board[rejected], 0);
  assert.equal(review.moves[0].ply, 6); assert.equal(review.moves[0].before[chosen], 1);
});

test("review caches adjacent positions and converts black/white estimates into mover's loss", async () => {
  const review = reviewFrames(finished()), calls = [], original = review.moves.map(m => [...m.before]);
  const search = async options => {
    calls.push(options); const index = options.board.findIndex((v, i) => !v && i === 224) === 224 ? 224 : options.board.findIndex(v => !v);
    return { index, assessment: { bestIndex: index, winRate: .8 } };
  };
  const rows = await analyzeReview(review, search);
  assert.equal(calls.length, review.moves.length); assert.ok(calls.every(o => o.timeMs === 500 && o.allowSetup));
  assert.ok(Math.abs(rows[0].loss - .6) < 1e-9); assert.ok(Math.abs(rows[1].loss - .6) < 1e-9);
  assert.equal(rows.at(-1).afterRate, 1); assert.equal(rows.at(-1).loss, 0);
  assert.deepEqual(review.moves.map(m => [...m.before]), original);
  assert.equal(reviewHighlights(rows).length, 3);
});

test("best move is not labeled a mistake; missing assessments remain unknown", async () => {
  const review = reviewFrames(finished()); let calls = 0;
  const rows = await analyzeReview(review, async o => {
    const index = review.moves.find(m => m.before.join("") === o.board.join(""))?.index ?? o.board.findIndex(v => !v);
    return { index, ...(calls++ === 2 ? {} : { assessment: { bestIndex: index, winRate: .6 } }) };
  });
  assert.equal(rows[0].loss, 0); assert.equal(rows[1].loss, null); assert.deepEqual(reviewHighlights(rows), []);
  await assert.rejects(analyzeReview(review, async () => ({ index: -1 })), /无效/);
});

test("completed PV score stays paired with its legal recommendation when final engine move differs", async () => {
  const review = reviewFrames(finished());
  const rows = await analyzeReview(review, async () => ({ index: 223, assessment: { bestIndex: 224, winRate: .8 } }));
  assert.equal(rows[0].best, 224); assert.equal(rows[0].beforeRate, .8); assert.ok(Math.abs(rows[0].loss - .6) < 1e-9);
  const unknown = await analyzeReview(review, async () => ({ index: 223, assessment: { bestIndex: 300, winRate: .8 } }));
  assert.equal(unknown[0].best, 223); assert.equal(unknown[0].loss, null);
});

test("cancellation after an awaited result publishes no stale progress or further search", async () => {
  const controller = new AbortController(); let progress = 0, calls = 0;
  await assert.rejects(analyzeReview(reviewFrames(finished()), async () => { calls++; controller.abort(); return { index: 112 }; }, { signal: controller.signal, onProgress: () => progress++ }), { name: "AbortError" });
  assert.equal(calls, 1); assert.equal(progress, 0);
});

test("Renju confirmed forbidden loss is replayed and compared with a legal suggestion", async () => {
  const board = new Uint8Array(225); for (const i of [110, 111, 97, 127]) board[i] = 1;
  const s = new OpeningSession({ rule: "renju", seed: { board, sideToMove: 1 } }); s.apply({ type: "stone", index: 112 });
  const review = reviewFrames(s.record()); assert.equal(review.winner, 2);
  assert.equal(review.frames.at(-1).forbidden, "三三"); assert.match(review.frames.at(-1).label, /三三禁手（白胜）/);
  const [row] = await analyzeReview(review, async () => ({ index: 0, assessment: { bestIndex: 0, winRate: .7 } }));
  assert.equal(row.afterRate, 0); assert.equal(row.loss, .7);
  await assert.rejects(analyzeReview(review, async () => ({ index: 112 })), /无效/);
});

test("draw review is available without fabricating a 50% win probability", async () => {
  const board = Uint8Array.from({ length: 225 }, (_, i) => (i % 15 + 2 * Math.floor(i / 15)) % 4 < 2 ? 1 : 2);
  board[0] = 0; const review = reviewFrames(createRecord([0], 1, { board, sideToMove: 1 }));
  assert.equal(review.winner, 3);
  const [row] = await analyzeReview(review, async () => ({ index: 0, assessment: { bestIndex: 0, winRate: .4 } }));
  assert.equal(row.afterRate, null); assert.equal(row.loss, null);
});
