import test from "node:test";
import assert from "node:assert/strict";
import { AssessmentCollector } from "../engine-assessment.js";
import { parseOutput } from "../engine-protocol.js";
import { PositionAnalysis, describePosition, trendGeometry } from "../position-analysis.js";

const stats = (winRate = .7, depth = 8, bestIndex = 113, mate = null) => ({ assessment: { winRate, depth, bestIndex, mate } });
const accept = (model, id = 1, side = 1, rate = .7, depth = 8, bestIndex = 113, mate = null) => model.accept({ requestId: id, sideToMove: side, stats: stats(rate, depth, bestIndex, mate) });
const storage = () => {
  const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const frame = (collector, pv = 0, score = "100", rate = ".7", depth = 8) => {
  let result;
  for (const line of [`INFO PV ${pv}`, `INFO DEPTH ${depth}`, `INFO EVAL ${score}`, `INFO WINRATE ${rate}`, "INFO BESTLINE 8,7 7,8", "INFO PV DONE"]) result = collector.read(line) ?? result;
  return result;
};

test("win-rate protocol accepts finite probabilities, including scientific notation, and rejects malformed values", () => {
  for (const rate of ["0", "1", "0.7", "1e-06"]) assert.equal(parseOutput(`INFO WINRATE ${rate}`).stats.winRate, Number(rate));
  for (const rate of ["NaN", "Infinity", "1.1", "-0.1", "2e9"]) assert.equal(parseOutput(`INFO WINRATE ${rate}`).type, "message");
});
test("only complete PV 0 frames pair score, depth and native win rate; partial frames never reuse old values", () => {
  const collector = new AssessmentCollector();
  assert.deepEqual(frame(collector, 0, "100", "0.7"), { depth: 8, evaluation: 100, winRate: .7, mate: null, bestIndex: 113 });
  assert.equal(frame(collector, 1, "-500", "0.1"), undefined);
  collector.read("INFO PV 0"); collector.read("INFO DEPTH 9"); collector.read("INFO EVAL M3");
  assert.equal(collector.read("INFO PV DONE"), null);
  assert.equal(frame(collector, 0, "-M4", "0").mate, "-M4");
  assert.equal(frame(collector, 0, "100", "0.6").mate, null);
  assert.equal(frame(collector, 0, "100", "1.5"), undefined);
});
test("rates and forced wins always use the player's perspective for both colors and search phases", () => {
  for (const player of [1, 2]) for (const side of [1, 2]) {
    const model = new PositionAnalysis([], player); model.begin(1, side); accept(model, 1, side);
    assert.ok(Math.abs(model.current.winRate - (player === side ? .7 : .3)) < 1e-9);
    accept(model, 1, side, 1, 9, 113, "M3"); assert.equal(model.current.forcedColor, side);
    accept(model, 1, side, 0, 10, 113, "-M3"); assert.equal(model.current.forcedColor, 3 - side);
    accept(model, 1, side, .5, 11); assert.equal(model.current.forcedColor, 0);
  }
});
test("ponder refinements replace one position; shallower slices, cancelled and late jobs cannot corrupt it", () => {
  const model = new PositionAnalysis([112], 1); model.begin(1, 2);
  assert.equal(accept(model, 1, 2), true); accept(model, 1, 2, .8, 9);
  assert.equal(model.history.length, 1); assert.equal(accept(model, 1, 2, .1, 7), false);
  model.begin(2, 2); assert.equal(accept(model, 1, 2, .1, 12), false);
  model.cancel(); assert.equal(accept(model, 2, 2), false);
  model.begin(3, 2); model.setPosition([], 1); assert.equal(accept(model, 3, 2), false);
});
test("only the AI's evaluated best move inherits its continuation; human alternatives wait for fresh evaluation", () => {
  const model = new PositionAnalysis([112], 1); model.begin(1, 2); accept(model, 1, 2);
  model.advanceAi([112, 113], 113, stats().assessment);
  assert.equal(model.current.kind, "continuation"); assert.equal(model.history.length, 2);
  model.setPosition([112, 113, 114], 1); assert.equal(model.current, null);
  model.setPosition([112], 1); assert.equal(model.history.length, 1);
  model.advanceAi([112, 114], 114, stats().assessment); assert.equal(model.current, null);
});
test("undo removes future estimates, restores the original point and keeps the new branch independent", () => {
  const model = new PositionAnalysis([112], 1); model.begin(1, 2); accept(model, 1, 2);
  model.advanceAi([112, 113], 113, stats().assessment);
  model.setPosition([112, 113, 97], 1); model.begin(2, 2); accept(model, 2, 2, .9);
  model.setPosition([112, 113], 1); assert.deepEqual(model.history.map(p => p.ply), [1, 2]);
  assert.equal(model.current.kind, "continuation");
  model.setPosition([112, 113, 98], 1); assert.equal(model.current, null);
  assert.equal(accept(model, 2, 2, .1, 20), false);
  model.setPosition([112], 1); model.setPosition([112, 114], 1);
  assert.deepEqual(model.history.map(p => p.ply), [1]);
});
test("restart, imported records and color changes clear analysis even when moves happen to match", () => {
  for (const color of [1, 2]) {
    const model = new PositionAnalysis([112, 113], 1); model.begin(1, 1); accept(model);
    model.setPosition([112, 113], color, { reset: true }); assert.equal(model.history.length, 0);
    assert.equal(accept(model), false);
  }
});
test("resume requires an exact chronological record and rejects corrupt or out-of-range derived history", () => {
  const store = storage(), model = new PositionAnalysis([112, 113], 1); model.begin(1, 1); accept(model); model.save(store);
  const resumed = new PositionAnalysis([112, 113], 1); assert.equal(resumed.load(store), true);
  assert.deepEqual(resumed.history, model.history);
  assert.equal(new PositionAnalysis([113, 112], 1).load(store), false);
  assert.equal(new PositionAnalysis([112], 1).load(store), false);
  assert.equal(new PositionAnalysis([112, 113], 2).load(store), false);
  const key = [...store.data.keys()][0], data = JSON.parse(store.getItem(key));
  for (const bad of [{ ...data.points[0], winRate: 7 }, { ...data.points[0], ply: 3 }, { ...data.points[0], depth: -1 }]) {
    store.setItem(key, JSON.stringify({ ...data, points: [bad] })); assert.equal(resumed.load(store), false);
  }
  store.setItem(key, "{"); assert.equal(resumed.load(store), false);
  assert.equal(model.save({ setItem() { throw new Error("blocked"); } }), false);
});
test("terminal results override estimates, draw is not a fictional 50% win rate, and undo clears the terminal point", () => {
  const model = new PositionAnalysis([112], 1); model.finish(1); assert.equal(model.current.winRate, 1);
  assert.equal(describePosition(model.current, 1, 1), "五子连珠，你赢了");
  model.finish(2); assert.equal(model.current.winRate, 0);
  model.finish(3); assert.equal(model.current.winRate, null);
  model.setPosition([], 1); assert.equal(model.current, null);
  assert.equal(describePosition(null, 1), "等待引擎评估当前局势");
});
test("trend geometry preserves actual ply spacing and gaps, stays bounded and never fabricates opening balance", () => {
  assert.equal(trendGeometry([], 0).groups.length, 0);
  const result = trendGeometry([{ ply: 1, winRate: 1 }, { ply: 2, winRate: .5 }, { ply: 4, winRate: 0 }], 4);
  assert.deepEqual(result.groups.map(g => g.length), [2, 1]);
  assert.equal(result.groups[0][0].y, 6); assert.equal(result.groups[1][0].y, 68);
  assert.equal(trendGeometry([{ ply: 225, winRate: .5 }], 225).groups[0][0].x, 350);
});
