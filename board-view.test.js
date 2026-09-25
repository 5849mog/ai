import test from "node:test";
import assert from "node:assert/strict";
import { SIZE } from "./engine.js";
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
