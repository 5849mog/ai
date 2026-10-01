import test from "node:test";
import assert from "node:assert/strict";
import { TACTICS, verifyTactic } from "./fixtures/tactics.js";
import { validatePosition } from "../game-rules.js";
import { OPENINGS } from "./fixtures/openings.js";

test("all tactical fixtures are legal and independently proven", () => {
  for (const fixture of TACTICS) {
    validatePosition(fixture.board, fixture.sideToMove);
    const { expected, proofs } = verifyTactic(fixture);
    assert.ok(expected.length, fixture.id);
    if (fixture.id.startsWith("vcf-two-attacks")) {
      assert.deepEqual(expected, [112], fixture.id);
      assert.ok(proofs[112].length >= 5, "two attacking moves with a forced reply and two final wins");
    }
  }
});
test("benchmark openings are distinct, legal, and have white to move", () => {
  assert.equal(OPENINGS.length, 20);
  assert.equal(new Set(OPENINGS.map(o => JSON.stringify(o.moves))).size, 20);
  for (const opening of OPENINGS) {
    const board = new Uint8Array(225);
    opening.moves.forEach(([x,y], i) => { const index = y*15+x; assert.equal(board[index], 0); board[index] = i%2+1; });
    validatePosition(board, 2);
  }
});
