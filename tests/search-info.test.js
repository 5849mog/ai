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
