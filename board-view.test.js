import test from "node:test";
import assert from "node:assert/strict";
import { SIZE } from "./game-rules.js";
import { createBoardView } from "./board-view.js";

function makeSvg() {
  return {
    innerHTML: "",
    getScreenCTM() {
      return { inverse: () => ({}) };
    },
    createSVGPoint() {
      return {
        x: 0,
        y: 0,
        matrixTransform() {
          return { x: this.x, y: this.y };
        }
      };
    }
  };
}

test("board view renders playable intersections and maps screen coordinates", () => {
  const svg = makeSvg();
  const view = createBoardView(svg);
  const board = new Uint8Array(SIZE * SIZE);

  view.render({
    board,
    lastMove: -1,
    pendingIndex: -1,
    selectedSkill: null,
    selectedTargets: [],
    canInteract: true
  });

  assert.equal((svg.innerHTML.match(/class="hit-target"/g) || []).length, SIZE * SIZE);
  assert.equal(view.nearestIntersection(310, 310), 7 * SIZE + 7);
  assert.equal(view.nearestIntersection(20, 310), -1);

  board[7 * SIZE + 7] = 1;
  view.render({
    board,
    lastMove: 7 * SIZE + 7,
    pendingIndex: -1,
    selectedSkill: null,
    selectedTargets: [],
    canInteract: true
  });
  assert.equal((svg.innerHTML.match(/class="hit-target"/g) || []).length, SIZE * SIZE - 1);
  assert.match(svg.innerHTML, /class="last-ring"/);
  assert.match(svg.innerHTML, /class="stone-texture black"/);
});

test("recommendations mark empty alternatives without adding stones or changing hit targets", () => {
  const svg = makeSvg(), view = createBoardView(svg);
  const board = new Uint8Array(225); board[112] = 1;
  view.render({ board, lastMove: 112, pendingIndex: -1, hoverIndex: -1, canInteract: true,
    recommendations: [{ index: 113 }, { index: 127 }] });
  assert.match(svg.innerHTML, /data-recommendation="113" data-rank="1"/);
  assert.match(svg.innerHTML, /data-recommendation="127" data-rank="2"/);
  assert.equal((svg.innerHTML.match(/data-stone=/g) || []).length, 1);
  assert.equal((svg.innerHTML.match(/class="hit-target"/g) || []).length, 224);
  view.render({ board, lastMove: 112, pendingIndex: -1, hoverIndex: -1, canInteract: true,
    recommendations: [{ index: 112 }] });
  assert.doesNotMatch(svg.innerHTML, /data-recommendation=/);
});
