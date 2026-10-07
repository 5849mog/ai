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

test("winning connectors sit behind stones and rings disappear when the winning move is undone", () => {
  const svg = makeSvg(), view = createBoardView(svg), board = new Uint8Array(225);
  for (const index of [105, 106, 107, 108, 109, 110]) board[index] = 2;
  const state = { board, lastMove: 108, pendingIndex: -1, hoverIndex: -1, canInteract: false };
  view.render(state);
  assert.equal((svg.innerHTML.match(/class="winning-connector"/g) || []).length, 1);
  assert.equal((svg.innerHTML.match(/data-winning-stone=/g) || []).length, 6);
  assert.ok(svg.innerHTML.indexOf('class="winning-connector"') < svg.innerHTML.indexOf("data-stone="));
  board[108] = 0; view.render(state);
  assert.doesNotMatch(svg.innerHTML, /winning-connector|data-winning-stone/);
});

test("a second board uses independent paint servers for all stones, shadows and wood", () => {
  const svg = makeSvg(), board = new Uint8Array(225); board[0] = 1; board[1] = 2;
  createBoardView(svg, { idPrefix: "preview-" }).render({ board, lastMove: 1, canInteract: false });
  assert.match(svg.innerHTML, /id="preview-blackStone"/); assert.match(svg.innerHTML, /url\(#preview-whiteStone\)/);
  assert.match(svg.innerHTML, /style="fill:url\(#preview-woodSurface\)"/);
  assert.doesNotMatch(svg.innerHTML, /id="(?:blackStone|whiteStone|woodSurface|stoneShadow)"|url\(#(?:blackStone|whiteStone|stoneShadow)\)/);
});

test("touch preview guides stay in bounds without displaying move coordinates", () => {
  const svg = makeSvg(), view = createBoardView(svg), board = new Uint8Array(225);
  for (const pendingIndex of [0, 14, 210, 224, 112]) {
    view.render({ board, lastMove: -1, pendingIndex, canInteract: true });
    assert.match(svg.innerHTML, /class="aim-guides"/);
    assert.doesNotMatch(svg.innerHTML, /coordinate-pill|待确认 [A-O]\d+/);
    assert.equal((svg.innerHTML.match(/class="hit-target"/g) || []).length, 225);
  }
  for (const state of [{ pendingIndex: -1 }, { pendingIndex: 112, canInteract: false }, { pendingIndex: 112, editable: true }]) {
    view.render({ board, lastMove: -1, canInteract: true, ...state }); assert.doesNotMatch(svg.innerHTML, /aim-guides|coordinate-pill/);
  }
  board[112] = 1; view.render({ board, lastMove: 112, pendingIndex: 112, canInteract: true }); assert.doesNotMatch(svg.innerHTML, /aim-guides/);
});

test("AI answer halo requires a known occupied latest answer and editable boards only show correction marks", () => {
  const svg = makeSvg(), view = createBoardView(svg), board = new Uint8Array(225); board[112] = 2;
  view.render({ board, lastMove: 112, answerIndex: 112, canInteract: false }); assert.match(svg.innerHTML, /data-answer="112"/); assert.doesNotMatch(svg.innerHTML, /coordinate-pill|AI 落子 H8/);
  view.render({ board, lastMove: 112, answerIndex: 111, canInteract: false }); assert.doesNotMatch(svg.innerHTML, /answer-ring|coordinate-pill/);
  view.render({ board, lastMove: 112, answerIndex: 112, canInteract: true, editable: true, uncertain: [112] }); assert.doesNotMatch(svg.innerHTML, /answer-ring|coordinate-pill/); assert.match(svg.innerHTML, /data-uncertain="112"/);
  assert.equal((svg.innerHTML.match(/class="hit-target"/g) || []).length, 225);
});
