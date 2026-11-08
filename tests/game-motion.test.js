import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { boardTransition, createBoardView } from "../board-view.js";
import { createGameMotion, gamePhase } from "../game-motion.js";
import { createAnalysisView } from "../analysis-view.js";
import { readFile } from "node:fs/promises";

const empty = () => new Uint8Array(225);

test("board transitions distinguish a real move, undo, recolor and bulk restore", () => {
  const before = empty(), after = empty(); after[112] = 1;
  assert.deepEqual(boardTransition(before, after, 112), { type: "place", added: [112], removed: [] });
  assert.equal(boardTransition(undefined, after, 112).type, "initial");
  assert.deepEqual(boardTransition(after, before, -1), { type: "undo", added: [], removed: [112] });
  const restored = after.slice(); restored[113] = 2;
  assert.equal(boardTransition(before, restored, 113).type, "replace");
  const recolored = after.slice(); recolored[112] = 2;
  assert.equal(boardTransition(after, recolored, 112).type, "replace");
  assert.equal(boardTransition(after, after.slice(), 112).type, "none");
});

function boardFixture({ reduced = false } = {}) {
  const dom = new JSDOM("<svg></svg>", { pretendToBeVisual: true }), svg = dom.window.document.querySelector("svg");
  const calls = [];
  dom.window.matchMedia = () => ({ matches: reduced });
  dom.window.SVGElement.prototype.animate = function (keyframes, options) {
    calls.push({ element: this, keyframes, options });
    return { cancel() {}, finished: new Promise(() => {}) };
  };
  const view = createBoardView(svg), board = empty();
  const state = { board, lastMove: -1, canInteract: true, overlayKey: "test" };
  return { dom, svg, calls, view, board, state };
}

test("rapid candidate moves and hover updates keep ranks, stones and rings connected", () => {
  const f = boardFixture();
  try {
    f.board[112] = 1;
    Object.assign(f.state, { lastMove: 112, answerIndex: 112, pendingIndex: 97,
      moveHints: [110, 111, 113].map(index => ({ index, color: 2 })) });
    f.view.render(f.state);
    const markers = [...f.svg.querySelectorAll(".turn-hint")];
    const numbers = markers.map(marker => marker.querySelector("text"));
    const rings = [...f.svg.querySelectorAll(".last-ring, .answer-ring, .pending-ring")];
    const stone = f.svg.querySelector('[data-stone="112"]');
    const observer = new f.dom.window.MutationObserver(() => {});
    observer.observe(f.svg, { childList: true, subtree: true });
    for (let update = 0; update < 24; update += 1) {
      const indices = update % 2 ? [224, 0, 14] : [14, 224, 0];
      f.state.moveHints = indices.map(index => ({ index, color: 2 }));
      f.state.hoverIndex = update % 2 ? 111 : -1;
      f.view.render(f.state);
      for (const [rank, marker] of markers.entries()) {
        assert.equal(f.svg.querySelector(`.turn-hint[data-rank="${rank + 1}"]`), marker);
        assert.equal(marker.querySelector("text"), numbers[rank]);
        assert.equal(Number(marker.dataset.hint), indices[rank]);
        assert.equal(marker.querySelector("circle").getAttribute("cx"), String(46 + indices[rank] % 15 * 528 / 14));
      }
    }
    const stable = [...markers, ...rings, stone];
    const removed = observer.takeRecords().flatMap(record => [...record.removedNodes]);
    assert.equal(removed.some(node => stable.some(element => node === element || node.contains(element))), false);
    for (const element of stable) assert.equal(element.isConnected, true);
    assert.equal(f.svg.querySelectorAll(".turn-hint").length, 3);
    assert.equal(f.svg.querySelectorAll(".hit-target").length, 224);
    f.view.render({ ...f.state, moveHints: [], pendingIndex: -1, answerIndex: -1 });
    assert.equal(f.svg.querySelectorAll(".turn-hint, .pending-ring, .answer-ring").length, 0);
    observer.disconnect();
  } finally { f.dom.window.close(); }
});

test("keyboard cursor has a stable identity, coordinate badge and edge-aware placement", () => {
  const f = boardFixture();
  try {
    Object.assign(f.state, { keyboardActive: true, keyboardIndex: 112 });
    f.view.render(f.state);
    const cursor = f.svg.querySelector(".keyboard-cursor");
    assert.equal(cursor.dataset.keyboardCursor, "112");
    assert.equal(cursor.querySelector("text").textContent, "H8");
    assert.equal(cursor.getAttribute("aria-hidden"), "true");
    f.state.keyboardIndex = 0; f.view.render(f.state);
    assert.equal(f.svg.querySelector(".keyboard-cursor"), cursor);
    assert.equal(cursor.querySelector("text").textContent, "A15");
    const label = cursor.querySelector("rect");
    assert.ok(Number(label.getAttribute("y")) > 46);
    f.state.keyboardActive = false; f.view.render(f.state);
    assert.equal(f.svg.querySelector(".keyboard-cursor"), null);
  } finally { f.dom.window.close(); }
});

test("recommendation ranks update in place when candidates swap positions", () => {
  const f = boardFixture();
  try {
    f.state.recommendations = [{ index: 110 }, { index: 114 }];
    f.view.render(f.state);
    const markers = [...f.svg.querySelectorAll(".recommendation-marker")];
    f.state.recommendations.reverse(); f.state.canInteract = false;
    f.view.render(f.state);
    for (const [rank, marker] of markers.entries()) {
      assert.equal(f.svg.querySelector(`.recommendation-marker[data-rank="${rank + 1}"]`), marker);
      assert.equal(Number(marker.dataset.recommendation), f.state.recommendations[rank].index);
    }
    assert.equal(f.svg.querySelectorAll(".hit-target").length, 0);
    f.state.recommendations = []; f.view.render(f.state);
    assert.equal(f.svg.querySelectorAll(".recommendation-marker").length, 0);
  } finally { f.dom.window.close(); }
});

test("live win-rate refinements preserve the curve and current-point animation nodes", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
  try {
    const root = document.querySelector("#positionAnalysis"), view = createAnalysisView(root);
    const history = [{ ply: 1, winRate: .5 }, { ply: 2, winRate: .6 }];
    const analysis = { history, moves: [112, 113], playerColor: 1, current: history[1] };
    view.render(analysis, 0);
    const stable = [...root.querySelectorAll(".trend-line, .trend-area, .trend-halo, .trend-current")];
    const beforeY = root.querySelector(".trend-current").getAttribute("cy");
    const observer = new dom.window.MutationObserver(() => {});
    observer.observe(root.querySelector("#trendData"), { childList: true, subtree: true });
    for (let update = 0; update < 24; update += 1) {
      history[1].winRate = .6 + update / 100;
      view.render(analysis, 0);
      for (const element of stable) assert.equal(root.querySelector(`.${element.getAttribute("class")}`), element);
    }
    assert.equal(observer.takeRecords().length, 0);
    assert.notEqual(root.querySelector(".trend-current").getAttribute("cy"), beforeY);
    assert.equal(root.querySelector("#playerWinRate").textContent, "83%");
    assert.equal(root.querySelector("#winRateBar").getAttribute("aria-valuenow"), "83");
    assert.equal(root.querySelector("#winRateBar").getAttribute("aria-valuetext"), "当前视角 83%，对方 17%");
    analysis.moves.push(114); history.push({ ply: 3, winRate: null }); analysis.current = history[2];
    view.render(analysis, 0);
    assert.equal(root.querySelector(".trend-halo, .trend-current"), null);
    analysis.moves = []; history.length = 0; analysis.current = null; view.render(analysis, 0);
    assert.equal(root.querySelector("#trendData").children.length, 0);
    assert.equal(root.querySelector("#winRateBar").hasAttribute("aria-valuetext"), false);
    observer.disconnect();
  } finally {
    original ? Object.defineProperty(globalThis, "document", original) : delete globalThis.document;
    dom.window.close();
  }
});

test("placement and undo get separate bounded effects; hover redraws do not replay placement", () => {
  const f = boardFixture();
  try {
    assert.equal(f.view.render(f.state), true);
    const initialCalls = f.calls.length;
    f.board[112] = 1; f.state.lastMove = 112;
    f.view.render(f.state);
    assert.equal(f.svg.dataset.boardAction, "place");
    assert.equal(f.svg.querySelectorAll('[data-impact="112"]').length, 1);
    assert.ok(f.calls.some(call => call.options.duration === 390));
    assert.ok(f.calls.some(call => call.options.duration === 520));
    const placementCalls = f.calls.length;
    f.state.hoverIndex = 113; f.view.render(f.state);
    assert.equal(f.calls.length, placementCalls);
    assert.equal(f.svg.querySelectorAll(".stone-impact").length, 0);
    f.board[112] = 0; f.state.lastMove = -1; f.state.hoverIndex = -1; f.state.motion = "undo";
    f.view.render(f.state);
    assert.equal(f.svg.dataset.boardAction, "undo");
    assert.equal(f.svg.querySelectorAll('[data-removed-stone="112"]').length, 1);
    assert.equal(initialCalls, 0);
  } finally { f.dom.window.close(); }
});

test("record resets and reduced-motion mode never start stone animations", () => {
  const reset = boardFixture();
  try {
    reset.view.render(reset.state); reset.board[112] = 1; reset.state.lastMove = 112; reset.state.motion = "reset";
    reset.view.render(reset.state);
    assert.equal(reset.calls.length, 0);
    assert.equal(reset.svg.querySelector(".stone-impact"), null);
  } finally { reset.dom.window.close(); }
  const reduced = boardFixture({ reduced: true });
  try {
    reduced.view.render(reduced.state); reduced.board[112] = 1; reduced.state.lastMove = 112;
    reduced.view.render(reduced.state);
    assert.equal(reduced.calls.length, 0);
    assert.equal(reduced.svg.dataset.boardAction, "reduced");
    assert.equal(reduced.svg.querySelector(".stone-impact"), null);
  } finally { reduced.dom.window.close(); }
});

test("page phase follows winner, pause, thinking, errors and loading", () => {
  assert.equal(gamePhase({ winner: 1, busy: true }), "finished");
  assert.equal(gamePhase({ paused: true }), "paused");
  assert.equal(gamePhase({ busy: true }), "thinking");
  assert.equal(gamePhase({ state: "error" }), "error");
  assert.equal(gamePhase({ state: "loading" }), "loading");
  assert.equal(gamePhase({ state: "ready" }), "ready");
});

test("HUD motion exposes state, animates meaningful text changes and honors reduced motion", () => {
  for (const reduced of [false, true]) {
    const dom = new JSDOM("<strong id='status'></strong><svg id='board'></svg><div id='frame'></div><div id='notice'></div>", { pretendToBeVisual: true });
    const calls = [];
    dom.window.matchMedia = () => ({ matches: reduced });
    dom.window.HTMLElement.prototype.animate = function (keyframes, options) { calls.push({ keyframes, options }); return { cancel() {} }; };
    const document = dom.window.document;
    const motion = createGameMotion({ root: document.documentElement, board: document.querySelector("#board"), status: document.querySelector("#status"), frame: document.querySelector("#frame"), notice: document.querySelector("#notice") });
    motion.render({ text: "轮到你落子", state: "ready", currentColor: 1 });
    motion.render({ text: "AI 思考中", state: "ready", currentColor: 2, busy: true });
    assert.equal(document.documentElement.dataset.gamePhase, "thinking");
    assert.equal(document.documentElement.dataset.gameTurn, "2");
    assert.equal(document.querySelector("#frame").dataset.motionPhase, "thinking");
    motion.render({ text: "深入搜索第 12 层", state: "ready", currentColor: 2, busy: true });
    assert.equal(calls.length, reduced ? 0 : 1, "search refinements do not replay status motion");
    motion.render({ text: "黑棋胜", state: "ready", currentColor: 2, winner: 1 });
    document.querySelector("#notice").textContent = "对局结束";
    motion.announce();
    motion.announce();
    assert.equal(document.documentElement.dataset.gamePhase, "finished");
    assert.equal(document.querySelector("#board").dataset.winner, "1");
    assert.equal(calls.length, reduced ? 0 : 4);
    dom.window.close();
  }
});
