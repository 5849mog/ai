import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createBoardView } from '../board-view.js';
import { setupDisplayModes } from '../display-modes.js';

function fixture() {
  const dom = new JSDOM(`<details id="recordMenu"></details><button id="enterSimpleMode"></button><svg id="boardSvg"></svg><div id="simpleControls"><button id="simpleRestart"><span id="simpleRestartLabel"></span></button><button id="simpleColor"><span id="simpleColorLabel"></span></button></div><span id="simpleLive"></span>`, { url: 'https://example.com/ai/?view=simple', pretendToBeVisual: true });
  const original = new Map(); for (const key of ['window', 'document', 'location', 'history', 'setTimeout', 'clearTimeout']) original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, history: dom.window.history });
  let time = 0, id = 0, starts = 0; const timers = new Map();
  globalThis.setTimeout = (run, delay) => { const key = ++id; timers.set(key, { at: time + delay, run }); return key; };
  globalThis.clearTimeout = key => timers.delete(key);
  const advance = ms => { const end = time + ms; for (;;) {
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!next || next[1].at > end) break; timers.delete(next[0]); time = next[1].at; next[1].run();
  } time = end; };
  const ui = setupDisplayModes({ onChange() {}, onNewGame: () => starts++, onToggleColor() {} });
  const button = document.querySelector('#simpleRestart'); button.setPointerCapture = () => {};
  const pointer = (type, values = {}) => { const event = new dom.window.Event(type); Object.assign(event, { pointerId: 1, button: 0, clientX: 20, clientY: 20, isPrimary: true, ...values }); button.dispatchEvent(event); };
  const click = detail => button.dispatchEvent(new dom.window.MouseEvent('click', { detail, cancelable: true }));
  return { dom, ui, button, advance, pointer, click, starts: () => starts, close() {
    dom.window.close(); for (const [key, descriptor] of original) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  } };
}

test('cancelled/moved touches and focus loss cannot start a new game through a delayed click', () => {
  for (const action of ['cancel', 'move', 'blur', 'hidden']) {
    const f = fixture();
    try {
      f.pointer('pointerdown'); f.advance(100);
      if (action === 'cancel') f.pointer('pointercancel');
      if (action === 'move') { f.pointer('pointermove', { clientX: 60 }); f.pointer('pointerup'); }
      if (action === 'blur') f.dom.window.dispatchEvent(new f.dom.window.Event('blur'));
      if (action === 'hidden') { Object.defineProperty(document, 'hidden', { value: true }); document.dispatchEvent(new f.dom.window.Event('visibilitychange')); }
      f.advance(1000); f.click(1); assert.equal(f.starts(), 0, action);
      f.pointer('pointerup'); f.pointer('pointerdown'); f.pointer('pointerup'); f.click(1); assert.equal(f.starts(), 1, action);
    } finally { f.close(); }
  }
});
test('a secondary finger cannot cancel the primary long press; exiting does not restart', () => {
  const f = fixture();
  try {
    f.pointer('pointerdown'); f.pointer('pointerdown', { pointerId: 2, isPrimary: false });
    f.pointer('pointermove', { pointerId: 2, clientX: 200 }); f.pointer('pointercancel', { pointerId: 2 });
    f.advance(800); assert.equal(f.ui.simple, false);
    f.pointer('pointerup'); f.advance(1000); f.click(1); assert.equal(f.starts(), 0);
  } finally { f.close(); }
});
test('keyboard clicks remain usable after a cancelled touch and error labels do not imply retrying New', () => {
  const f = fixture();
  try {
    f.pointer('pointerdown'); f.pointer('pointercancel'); f.click(0); assert.equal(f.starts(), 1);
    f.ui.render({ playerColor: 1, winner: 0, state: 'error', text: 'AI 暂不可用', busy: false });
    assert.equal(document.querySelector('#simpleRestartLabel').textContent, '新局');
  } finally { f.close(); }
});
test('unchanged board renders preserve actual nodes; in-place moves and overlay changes invalidate the cache', () => {
  const dom = new JSDOM('<svg></svg>'), svg = dom.window.document.querySelector('svg');
  const view = createBoardView(svg), board = new Uint8Array(225), state = { board, lastMove: -1, canInteract: true, overlayKey: 'A1' };
  assert.equal(view.render(state), true); const originalTarget = svg.querySelector('[data-index="112"]');
  const marker = dom.window.document.createElementNS('http://www.w3.org/2000/svg', 'g'); marker.setAttribute('data-overlay', 'A1'); svg.append(marker);
  for (let n = 0; n < 100; n++) assert.equal(view.render({ ...state }), false);
  assert.equal(svg.querySelector('[data-index="112"]'), originalTarget); assert.equal(svg.querySelectorAll('[data-overlay]').length, 1);
  board[112] = 1; state.lastMove = 112; assert.equal(view.render(state), true);
  assert.equal(svg.querySelectorAll('[data-stone]').length, 1); assert.equal(svg.querySelector('[data-overlay]'), null);
  state.overlayKey = 'A1,A2'; assert.equal(view.render(state), true); assert.equal(view.render(state), false);
  state.canInteract = false; assert.equal(view.render(state), true); assert.equal(svg.querySelectorAll('.hit-target').length, 0);
  dom.window.close();
});
