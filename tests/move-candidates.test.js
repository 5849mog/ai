import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { MoveCandidates, createCandidateView, moveReviewOptions } from "../move-candidates.js";

const board = () => { const b = new Uint8Array(225); b[112] = 1; b[97] = 2; return b; };
const batch = (indices = [113, 111, 127, 128, 110], depth = 12) => indices.map((index, rank) => ({ index, depth, score: 40 - rank * 20, winRate: .6 - rank * .05 }));
function fixture(color = 1) {
  const m = new MoveCandidates(); m.setPosition({ board: board(), color, ply: 2 }); m.begin(1);
  assert.ok(m.accept({ requestId: 1, sideToMove: color, stats: { recommendations: batch() } })); return m;
}
const answer = (index = 118, evaluation = 200, winRate = .8) => ({ index, assessment: { bestIndex: index, evaluation, winRate, depth: 14 } });

for (const color of [1, 2]) test(`${color === 1 ? "black" : "white"} candidates retain the mover's score and a pinned pre-move board`, () => {
  const m = fixture(color), r = m.record(111); assert.equal(r.actual.rank, 2); assert.equal(r.actual.score, 20); assert.equal(r.needsScore, false);
  const next = board(); next[111] = color; m.setPosition({ board: next, color: 3 - color, ply: 3 }); m.begin(2);
  m.accept({ requestId: 2, sideToMove: 3 - color, stats: { recommendations: batch([114, 115, 116, 117, 118]) } });
  assert.equal(m.displayed, r); assert.equal(r.color, color); assert.equal(r.board[111], 0); assert.equal(r.rows[1].index, 111);
  m.pinned = false; assert.equal(m.displayed.color, 3 - color); assert.equal(m.displayed.rows[0].index, 114);
  m.pinned = true; assert.equal(m.displayed.actual.score, 20);
});
test("outside top five creates a separate actual row, never invents its rank or reorders the original list", () => {
  const m = fixture(), r = m.record(120); assert.equal(r.rankedCount, 5); assert.equal(r.actual.rank, null); assert.equal(r.pending, true);
  assert.deepEqual(r.rows.slice(0, 5).map(row => row.index), [113, 111, 127, 128, 110]);
  const options = moveReviewOptions(r); assert.equal(options.board[120], 1); assert.equal(options.sideToMove, 2); assert.equal(r.board[120], 0);
  assert.ok(m.finishReview(r, answer())); assert.equal(r.actual.score, -200); assert.ok(Math.abs(r.actual.winRate - .2) < 1e-10); assert.equal(r.pending, false);
  assert.equal(r.actual.rank, null); assert.equal(r.actual.rechecked, true);
});
test("no completed list can still score the actual move without claiming it missed the top five", () => {
  const m = new MoveCandidates(); m.setPosition({ board: board(), color: 2, ply: 2 }); const r = m.record(120);
  assert.equal(r.rankedCount, 0); assert.equal(r.needsScore, true); assert.ok(m.finishReview(r, answer(118, 0, .5)));
});
test("mixed depths, wrong side, stale identity, occupied points and duplicate rows cannot update a list", () => {
  const m = fixture(), original = JSON.stringify(m.current.rows);
  for (const event of [
    { requestId: 0, sideToMove: 1, stats: { recommendations: batch() } },
    { requestId: 1, sideToMove: 2, stats: { recommendations: batch() } },
    { requestId: 1, sideToMove: 1, stats: { recommendations: batch().map((r, i) => ({ ...r, depth: i === 4 ? 13 : 12 })) } },
    { requestId: 1, sideToMove: 1, stats: { recommendations: batch([112, 111, 127, 128, 110]) } },
    { requestId: 1, sideToMove: 1, stats: { recommendations: batch([113, 113, 127, 128, 110]) } }
  ]) assert.equal(m.accept(event), false);
  assert.equal(JSON.stringify(m.current.rows), original);
  m.setPosition({ board: board(), color: 2 }); assert.equal(m.accept({ requestId: 1, sideToMove: 1, stats: { recommendations: batch() } }), false);
});
test("shallower or unscored background slices cannot erase a completed deeper list", () => {
  const m = fixture(); assert.equal(m.accept({ requestId: 1, sideToMove: 1, stats: { recommendations: batch(undefined, 10) } }), false);
  assert.equal(m.accept({ requestId: 1, sideToMove: 1, stats: { recommendations: [{ index: 120 }] } }), false);
  assert.equal(m.current.depth, 12);
});
test("an occupied reply, an invalid rate or a late review never becomes the actual move's score", () => {
  const m = fixture(), r = m.record(120);
  assert.equal(m.finishReview(r, answer(120)), false); assert.equal(r.actual.score, null);
  assert.equal(m.finishReview(r, answer(118, 2, 1.1)), false);
  const newer = m.record(121); assert.equal(m.finishReview(r, answer()), false); assert.equal(m.review, newer); assert.equal(newer.actual.score, null);
  m.reset(); assert.equal(m.finishReview(newer, answer()), false);
});
test("a forced mate assessment with no numeric evaluation remains a valid score", () => {
  const m = fixture(), r = m.record(120);
  assert.ok(m.finishReview(r, { index: 118, assessment: { bestIndex: 118, depth: 20, evaluation: null, mate: "-M9", winRate: 0 } }));
  assert.equal(r.actual.mate, "+M10"); assert.equal(r.actual.winRate, 1);
});
test("restricted or forbidden candidates are rejected and an actual forbidden black move is a rule loss", () => {
  const m = new MoveCandidates(), b = new Uint8Array(225); for (const i of [109, 110, 111, 113, 114]) b[i] = 1;
  m.setPosition({ board: b, color: 1, rule: "renju", allowedMoves: [115] }); m.begin(1);
  assert.equal(m.accept({ requestId: 1, sideToMove: 1, stats: { recommendations: batch([112]) } }), false);
  const r = m.record(112); assert.ok(r.actual.forbidden); assert.equal(r.actual.winRate, 0); assert.equal(r.needsScore, false);
});
test("a direct winning shortcut supplies a proven winning score without fabricating four more candidates", () => {
  const m = new MoveCandidates(), b = new Uint8Array(225); for (const i of [108, 109, 110, 111]) b[i] = 2;
  m.setPosition({ board: b, color: 2 }); m.begin(1);
  assert.ok(m.accept({ requestId: 1, sideToMove: 2, stats: { recommendations: [{ index: 112 }] } }));
  const r = m.record(112); assert.equal(r.rows.length, 1); assert.equal(r.actual.winRate, 1); assert.equal(r.needsScore, false);
});
test("view names the mover, preserves the selected line and exposes explicit live/review switching", () => {
  const dom = new JSDOM('<section></section>'), root = dom.window.document.querySelector('section'), m = fixture(2);
  try {
    const view = createCandidateView(root, m); view.render(); m.record(111); view.render();
    assert.equal(root.dataset.color, "2"); assert.equal(root.dataset.mode, "review"); assert.equal(root.querySelector('[aria-current="true"]').dataset.index, "111");
    assert.match(root.querySelector('#candidateNote').textContent, /候选 2/);
    const next = board(); next[111] = 2; m.setPosition({ board: next, color: 1, ply: 3 }); view.render(); assert.equal(root.dataset.color, "2");
    root.querySelector('#candidateSwitch').click(); assert.equal(root.dataset.color, "1"); assert.equal(root.dataset.mode, "live");
    root.querySelector('#candidateSwitch').click(); assert.equal(root.dataset.color, "2");
  } finally { dom.window.close(); }
});

test("inspecting a live candidate freezes the list and position changes invalidate its confirmation", () => {
  const m = fixture(2); assert.ok(m.select(111)); assert.equal(m.applicable.index, 111);
  assert.equal(m.accept({ requestId: 1, sideToMove: 2, stats: { recommendations: batch([120, 121, 122, 123, 124], 18) } }), false);
  assert.equal(m.current.rows[1].index, 111);
  const old = m.applicable, b = board(); b[120] = 2; m.setPosition({ board: b, color: 1 });
  assert.equal(m.preview, null); assert.equal(m.applicable, null); assert.notEqual(m.current, old.position);
});
test("history candidates can be inspected but never confirmed, even before the board advances", () => {
  const m = fixture(); m.record(111); assert.ok(m.select(113)); assert.equal(m.preview.index, 113); assert.equal(m.applicable, null);
  assert.ok(m.select(113)); assert.equal(m.preview, null); assert.equal(m.select(224), false);
});
test("candidate buttons preview once, confirm explicitly and clear when switching to history", () => {
  const dom = new JSDOM('<section></section>'), root = dom.window.document.querySelector('section'), m = fixture(2);
  let previews = 0, applied = null;
  try {
    const view = createCandidateView(root, m, { onPreview: () => previews++, onApply: s => applied = s }); view.render({ canApply: true });
    const choose = () => root.querySelector('button.candidate-row[data-index="111"]').click();
    root.querySelector('button.candidate-row[data-index="111"]').focus();
    choose(); assert.equal(previews, 1); assert.equal(applied, null); assert.equal(root.querySelector('#candidateApply').hidden, false);
    assert.equal(dom.window.document.activeElement.dataset.index, '111');
    assert.equal(root.querySelector('[aria-pressed="true"]').dataset.index, '111');
    root.querySelector('#candidateApply').click(); assert.equal(applied, m.applicable);
    choose(); assert.equal(m.preview, null); assert.equal(root.querySelector('#candidateApply').hidden, true);
    m.record(113); view.render(); choose(); assert.equal(root.querySelector('#candidateApply').hidden, true);
    assert.match(root.querySelector('#candidateNote').textContent, /历史候选/);
    root.querySelector('#candidateSwitch').click(); assert.equal(m.preview, null);
  } finally { dom.window.close(); }
});
