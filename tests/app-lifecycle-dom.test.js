import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { OpeningSession } from '../opening-session.js';
import { createReviewUi } from '../review-ui.js';

const flush = () => new Promise(done => setImmediate(done));
let fixtureId = 0;
async function environment(page, { saved = null, failSearch = false, blockSave = false } = {}) {
  const html = await readFile(new URL('../' + page, import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: `https://example.com/ai/${page}?view=simple`, pretendToBeVisual: true });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  const values = { window: dom.window, document: dom.window.document, location: dom.window.location, history: dom.window.history, localStorage: dom.window.localStorage,
    navigator: { hardwareConcurrency: 2 }, MutationObserver: dom.window.MutationObserver, Event: dom.window.Event, ResizeObserver: class { observe() {} } };
  let time = 0, timerId = 0, failed = false; const timers = new Map(), workers = [];
  values.setTimeout = (run, delay = 0) => { const key = ++timerId; timers.set(key, { run, at: time + delay }); return key; };
  values.clearTimeout = key => timers.delete(key);
  values.setInterval = () => 0; values.clearInterval = () => {};
  values.Worker = class {
    constructor() { workers.push(this); this.dead = false; }
    terminate() { this.dead = true; }
    postMessage(data) {
      this.last = data;
      if (data.type === 'init') queueMicrotask(() => this.emit({ type: 'ready' }));
      if (data.type === 'ponder') this.ponderJob = data;
      if (data.type === 'search') queueMicrotask(() => {
        if (failSearch && !failed) { failed = true; this.emit({ type: 'error', requestId: data.requestId, message: 'fixture search failure' }); return; }
        const index = data.board[113] === 0 ? 113 : data.board.findIndex(value => !value);
        this.emit({ type: 'move', requestId: data.requestId, result: { index, x: index % 15, y: Math.floor(index / 15), elapsed: 10 } });
      });
    }
    emit(data) { if (!this.dead) this.onmessage?.({ data }); }
  };
  const original = new Map();
  for (const [key, value] of Object.entries(values)) { original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
  const storageKey = `gomoku-opening:${new URL('../', import.meta.url).pathname}:v1`;
  if (saved) localStorage.setItem(storageKey, JSON.stringify(saved));
  if (blockSave) dom.window.Storage.prototype.setItem = () => { throw new Error('quota exceeded'); };
  const advance = ms => {
    const end = time + ms; for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break; timers.delete(next[0]); time = next[1].at; next[1].run();
    } time = end;
  };
  const close = () => {
    workers.forEach(worker => worker.terminate()); timers.clear(); dom.window.close();
    for (const [key, descriptor] of original) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  };
  return { dom, workers, storageKey, advance, close, async load() { await import(`../${page === 'index.html' ? 'app.js' : 'opening-app.js'}?dom-case=${++fixtureId}`); await flush(); await flush(); } };
}

test('freestyle simple-mode retry preserves the existing stone and continues the failed AI turn', async () => {
  const f = await environment('index.html', { failSearch: true });
  try {
    await f.load(); document.querySelector('[data-index="112"]').dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true }));
    await flush(); await flush();
    const retry = [...document.querySelector('#simpleStatusRow').querySelectorAll('button')].find(button => button.textContent === '重试 AI');
    assert.equal(retry.hidden, false); assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length, 1);
    assert.equal(document.querySelector('#simpleRestartLabel').textContent, '新局');
    retry.click(); await flush(); await flush();
    assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length, 2);
    assert.ok(document.querySelector('#boardSvg [data-stone="112"]')); assert.ok(document.querySelector('#boardSvg [data-stone="113"]'));
    assert.equal(retry.hidden, true);
  } finally { f.close(); }
});

test('storage errors are visibly mirrored inline in simple mode and clear when the original notice clears', async () => {
  const f = await environment('index.html', { blockSave: true });
  try {
    await f.load(); document.querySelector('[data-index="112"]').dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true }));
    await flush(); await flush();
    const notice = document.querySelector('.simple-notice'); assert.equal(notice.hidden, false); assert.match(notice.textContent, /暂未保存/);
    assert.equal(document.querySelector('.simple-mode') !== null, true);
    document.querySelector('#gameNotice').hidden = true; await flush(); assert.equal(notice.hidden, true);
    assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length, 2);
  } finally { f.close(); }
});

test('Renju coalesces statistic bursts, periodically saves assessments, and preserves the last assessment on hide', async () => {
  const session = new OpeningSession({ rule: 'renju', workflow: 'follow', initialBlackSeat: 0 });
  session.apply({ type: 'stone', index: 112 });
  const f = await environment('renju.html', { saved: { record: session.record(), perspective: 1 } });
  try {
    await f.load(); const worker = f.workers.at(-1), job = worker.ponderJob; assert.ok(job);
    for (let n = 0; n < 20; n++) worker.emit({ type: 'stats', phase: 'ponder', requestId: job.requestId,
      stats: { depth: n + 1, assessment: { depth: n + 1, bestIndex: 113, winRate: .8, mate: null } } });
    assert.equal(document.querySelector('#searchDepth').textContent, '—');
    f.advance(100); assert.equal(document.querySelector('#searchDepth').textContent, '20');
    f.advance(400); const saved = JSON.parse(localStorage.getItem(f.storageKey)); assert.equal(saved.analysis.points.at(-1).depth, 20);
    worker.emit({ type: 'stats', phase: 'ponder', requestId: job.requestId,
      stats: { depth: 21, assessment: { depth: 21, bestIndex: 113, winRate: .75, mate: null } } });
    Object.defineProperty(document, 'hidden', { value: true }); document.dispatchEvent(new f.dom.window.Event('visibilitychange'));
    const hiddenSaved = JSON.parse(localStorage.getItem(f.storageKey)); assert.equal(hiddenSaved.analysis.points.at(-1).depth, 21);
  } finally { f.close(); }
});

test('restoring a terminal Renju record always replaces an older estimated rate with the actual result', async () => {
  const session = new OpeningSession({ rule: 'renju', workflow: 'follow', initialBlackSeat: 0 });
  for (const index of [105, 0, 106, 1, 107, 2, 108, 3, 109]) session.apply({ type: 'stone', index });
  const analysis = { version: 1, playerColor: 1, positionKey: 'renju:opening', moves: session.moves,
    points: [{ ply: session.moves.length, winRate: .25, depth: 8, forcedColor: 0, bestIndex: 114, kind: 'engine' }] };
  const f = await environment('renju.html', { saved: { record: session.record(), perspective: 1, analysis } });
  try {
    await f.load(); const point = JSON.parse(localStorage.getItem(f.storageKey)).analysis.points.at(-1);
    assert.equal(point.kind, 'result'); assert.equal(point.winRate, 1); assert.equal(document.querySelector('#playerWinRate').textContent, '100%');
    assert.equal(f.workers.length, 0);
  } finally { f.close(); }
});

test('review proposal overlays remain single instances during repeated seeks and reflect candidate changes', async () => {
  const s = new OpeningSession({ rule: 'rif', workflow: 'follow', initialBlackSeat: 0 });
  for (const index of [112, 97, 96, 128]) {
    s.apply({ type: 'stone', index }); if (s.decision) s.apply({ type: 'decision', choice: 'keep' });
  }
  const offers = s.allowedMoves({ safe: true }).slice(0, 2);
  for (const index of offers) s.apply({ type: 'offer', index }); s.apply({ type: 'select', index: offers[0] });
  while (!s.winner) s.apply({ type: 'stone', index: s.allowedMoves({ safe: true })[0] });
  const f = await environment('renju.html');
  try {
    const root = document.createElement('div'); document.body.append(root);
    const review = createReviewUi(root, { search: () => new Promise(() => {}), cancelSearch() {}, close() {}, newGame() {} });
    void review.open(s.record());
    const first = s.events.findIndex(event => event.type === 'offer') + 1, timeline = root.querySelector('[data-timeline]');
    const seek = value => { timeline.value = value; timeline.oninput({ target: timeline }); };
    for (let n = 0; n < 20; n++) seek(first);
    assert.equal(root.querySelectorAll('.review-candidate').length, 1);
    seek(first + 1); assert.equal(root.querySelectorAll('.review-candidate').length, 2);
    seek(first); assert.equal(root.querySelectorAll('.review-candidate').length, 1); review.dispose();
  } finally { f.close(); }
});
