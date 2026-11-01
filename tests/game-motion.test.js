import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { boardTransition, createBoardView } from "../board-view.js";
import { createGameMotion, gamePhase } from "../game-motion.js";

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
    motion.render({ text: "黑棋胜", state: "ready", currentColor: 2, winner: 1 });
    motion.announce();
    assert.equal(document.documentElement.dataset.gamePhase, "finished");
    assert.equal(document.querySelector("#board").dataset.winner, "1");
    assert.equal(calls.length, reduced ? 0 : 4);
    dom.window.close();
  }
});
