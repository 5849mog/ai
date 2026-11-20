import test from "node:test";
import assert from "node:assert/strict";
import { describeSearch } from "../search-info.js";

test("scores consistently favor AI for either player color and either search phase", () => {
  assert.equal(describeSearch({ evaluation: 432 }, 2, 2).score, "+432");
  assert.equal(describeSearch({ evaluation: 432 }, 1, 2).score, "-432");
  assert.equal(describeSearch({ evaluation: -432 }, 2, 1).score, "+432");
  assert.deepEqual(describeSearch({}, 1, 2), { depth: "—", score: "—", nodes: "—", speed: "—" });
  assert.equal(describeSearch({ depth: 12, nps: 42000, evaluation: NaN }, 1, 1).score, "—");
});

test("mate signs follow the analysis color and invalid counters stay blank", () => {
  assert.equal(describeSearch({ mate: "-M3" }, 2, 1).score, "+M3");
  assert.equal(describeSearch({ mate: "M5" }, 1, 2).score, "-M5");
  assert.deepEqual(describeSearch({ evaluation: 0.1, nodes: -1, nps: -2, depth: -1 }, 1, 2),
    { score: "0", depth: "—", nodes: "—", speed: "—" });
});
