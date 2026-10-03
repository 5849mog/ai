import test from "node:test";
import assert from "node:assert/strict";
import { RecommendationCollector } from "../recommendations.js";

function pv(collector, rank, depth, index, score = 600, count = 2) {
  for (const line of [`INFO PV ${rank}`, `INFO NUMPV ${count}`, `INFO DEPTH ${depth}`,
    `INFO EVAL ${score}`, `INFO BESTLINE ${index % 15},${Math.floor(index / 15)} 8,7`, "INFO PV DONE"]) collector.read(line);
}
const board = () => { const result = Array(225).fill(0); result[112] = 1; return result; };

test("recommendations use two root alternatives, not the first PV's next reply", () => {
  const collector = new RecommendationCollector();
  pv(collector, 0, 4, 111, 600);
  pv(collector, 1, 4, 110, 300);
  const input = board(), before = [...input];
  assert.deepEqual(collector.finish(input, 111, 2).map(move => move.index), [111, 110]);
  assert.deepEqual(input, before);
  pv(collector, 0, 5, 109, 700);
  assert.deepEqual(collector.finish(input, 109, 2).map(move => move.index), [111, 110]);
  assert.equal(collector.completed[0].depth, 4);
});

test("recommendations never merge candidates from different depths", () => {
  const collector = new RecommendationCollector();
  pv(collector, 0, 4, 111);
  pv(collector, 1, 5, 110);
  assert.deepEqual(collector.finish(board(), 109, 2).map(move => move.index), [109]);
});

test("recommendations rank positive mates above ordinary scores", () => {
  const collector = new RecommendationCollector();
  pv(collector, 0, 4, 111, 600);
  pv(collector, 1, 4, 110, "+M3");
  assert.deepEqual(collector.finish(board(), 110, 2).map(move => move.index), [110, 111]);
});

test("recommendations reject duplicate, occupied and out-of-range candidates", () => {
  for (const second of [111, 112, -1]) {
    const collector = new RecommendationCollector();
    pv(collector, 0, 4, 111);
    if (second === -1) {
      for (const line of ["INFO PV 1", "INFO NUMPV 2", "INFO DEPTH 4", "INFO EVAL 300", "INFO BESTLINE 15,7", "INFO PV DONE"]) collector.read(line);
    } else pv(collector, 1, 4, second);
    assert.throws(() => collector.finish(board(), 111, 2), /无效推荐/);
  }
});

test("direct-win shortcut yields real winning points and keeps a unique win unique", () => {
  const input = Array(225).fill(0);
  for (const i of [110, 111, 112, 113]) input[i] = 1;
  for (const i of [0, 2, 30, 32]) input[i] = 2;
  const before = [...input];
  assert.deepEqual(new RecommendationCollector().finish(input, 114, 1).map(move => move.index), [114, 109]);
  assert.throws(() => new RecommendationCollector().finish(input, 100, 1), /无效推荐/);
  assert.deepEqual(input, before);
  input[0] = 0; input[109] = 2;
  assert.deepEqual(new RecommendationCollector().finish(input, 114, 1).map(move => move.index), [114]);
});
