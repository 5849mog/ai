import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { boardKeyboardIndex } from "../board-view.js";
import { boardTransformMarkup, transformedIndex, transformBoard } from "../board-transform.js";
import { describeBoard } from "../board-facts.js";
import { readBoardAppearance, setupBoardAppearance } from "../board-preferences.js";
import { OpeningSession } from "../opening-session.js";
import { createOpeningDialogs } from "../opening-guide.js";
import { THINKING_VALUES, SPECTATOR_DELAYS } from "../thinking-options.js";

test("live board, draft and screenshot navigation share bounded jumps", () => {
  assert.deepEqual(["PageUp", "PageDown", "[", "]", "Home"].map(key => boardKeyboardIndex(112, key)), [37, 187, 105, 119, 112]);
  assert.equal(boardKeyboardIndex(1, "PageUp"), 1);
  assert.equal(boardKeyboardIndex(224, "PageDown"), 224);
});

test("draft transformations preserve intersections and original color data", () => {
  const source = new Uint8Array(225); source[1] = 1; source[32] = 2;
  assert.deepEqual(["rotateLeft", "rotateRight", "mirror", "flip", "swap"].map(action => transformedIndex(1, action)), [195, 29, 13, 211, 1]);
  assert.equal(transformBoard(source, "rotateRight")[29], 1);
  assert.equal(transformBoard(source, "swap")[1], 2);
  assert.deepEqual(transformBoard(transformBoard(source, "rotateRight"), "rotateLeft"), source);
  for (const action of ["mirror", "flip", "swap"]) assert.deepEqual(transformBoard(transformBoard(source, action), action), source);
  assert.equal(boardTransformMarkup().split("<option").length - 1, 5);
});

test("board facts distinguish placed and seeded stones and describe an opening choice", () => {
  const seed = new Uint8Array(225); seed[112] = 2;
  const seeded = new OpeningSession({ rule: "freestyle", workflow: "follow", initialBlackSeat: 0, seed: { board: seed, sideToMove: 1 } });
  seeded.apply({ type: "stone", index: 113 });
  const facts = Object.fromEntries(describeBoard({ session: seeded, cursor: 112, workflow: "手动记录", allowed: 223 }));
  assert.equal(facts.已走手数, 1);
  assert.equal(facts.最近落子, "I8 · 黑棋");
  assert.equal(facts.盘面棋子, "黑 1 · 白 1");
  assert.equal(facts.空交点, 223);
  assert.equal(facts.当前选点, "H8");
  const setup = new OpeningSession({ rule: "rif", workflow: "duel", initialBlackSeat: null });
  assert.equal(Object.fromEntries(describeBoard({ session: setup, cursor: -1 })).下一着, "等待选择");
});

test("both menus share board preferences and resetting restores safe touch defaults", () => {
  const dom = new JSDOM('<svg></svg><div data-board-appearance></div><div data-board-appearance></div>', { url: "https://example.com/ai/" });
  try {
    const { document, localStorage: storage, Event } = dom.window, board = document.querySelector("svg");
    setupBoardAppearance({ document, board, storage });
    const [first, second] = document.querySelectorAll("[data-appearance=farCoordinates]");
    assert.equal(first.disabled, true);
    const coordinates = document.querySelector("[data-appearance=coordinates]");
    coordinates.checked = true; coordinates.dispatchEvent(new Event("change"));
    assert.equal(second.disabled, false);
    const theme = document.querySelector("[data-appearance=theme]");
    theme.value = "slate"; theme.dispatchEvent(new Event("change"));
    assert.equal(board.dataset.theme, "slate");
    const touch = document.querySelector("[data-appearance=touchConfirm]");
    touch.checked = false; touch.dispatchEvent(new Event("change"));
    assert.equal(readBoardAppearance(storage).touchConfirm, false);
    document.querySelector("[data-reset-appearance]").click();
    assert.equal(readBoardAppearance(storage).touchConfirm, true);
    assert.equal(first.disabled, true);
  } finally { dom.window.close(); }
});

test("all mode combinations fill the draft and require explicit start", () => {
  const dom = new JSDOM('<button id="openModes"></button><button id="openGuide"></button><details id="recordMenu"></details>');
  const original = globalThis.document, oldEvent = globalThis.Event;
  Object.assign(globalThis, { document: dom.window.document, Event: dom.window.Event });
  const started = [];
  try {
    createOpeningDialogs({ getSession: () => ({ rule: "rif", workflow: "follow" }), onNew: configuration => started.push(configuration), onModal() {} });
    const preset = document.querySelector("#modePreset"), modes = document.querySelector("#modeDialog");
    modes.showModal = () => { modes.open = true; }; modes.close = () => { modes.open = false; };
    document.querySelector("#openModes").click();
    assert.equal(preset.value, "rif/follow");
    assert.equal(preset.options.length, 16);
    for (const option of preset.options) {
      preset.value = option.value; preset.dispatchEvent(new Event("change"));
      assert.equal(`${document.querySelector("#ruleMode").value}/${document.querySelector("#workflowMode").value}`, option.value);
    }
    assert.deepEqual(started, []);
    document.querySelector("#startMode").click();
    assert.deepEqual(started, [{ rule: "taraguchi10", workflow: "local", initialBlackSeat: null }]);
  } finally { globalThis.document = original; globalThis.Event = oldEvent; dom.window.close(); }
});

test("standard and adaptive thinking choices match the complete spectator controls", () => {
  assert.deepEqual(THINKING_VALUES, ["100", "500", "1000", "2000", "3000", "5000", "6000", "10000", "adaptive"]);
  assert.deepEqual(SPECTATOR_DELAYS.map(([ms]) => ms), [0, 100, 250, 500, 1000, 2000, 3000]);
});
