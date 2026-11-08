import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createRecord } from '../game-record.js';
import { createGameArchive } from '../game-archive.js';
import { createArchiveUi } from '../archive-ui.js';
import { setupCustomUi } from '../setup-ui.js';
import { createReviewUi } from '../review-ui.js';

function bind(dom) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = dom.window.document;
  return () => { dom.window.close(); original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document; };
}

test('archive filters narrow records and deletion can be undone while the list stays open', () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.com/ai/' }), finish = bind(dom);
  try {
    let serial = 0, time = 0;
    const archive = createGameArchive({ storage: dom.window.localStorage, page: 'test', id: () => `g${++serial}`, now: () => ++time });
    archive.capture(createRecord([112],1)); const favorite = archive.list()[0].id; archive.favorite(favorite);
    archive.begin(); archive.capture(createRecord([0,15,1,16,2,17,3,18,4],1));
    archive.begin(); archive.capture(createRecord([113,114],1)); const removed = archive.list()[0];
    const root = document.querySelector('#root');
    const ui = createArchiveUi(root, { archive, close() {}, resume() {}, review() {}, exportRecord() {} }); ui.open();
    const filter = root.querySelector('[data-archive-filter]'), change = value => { filter.value = value; filter.dispatchEvent(new dom.window.Event('change')); };
    change('favorite'); assert.equal(root.querySelectorAll('.archive-card').length, 1); assert.equal(root.querySelector('.archive-card').dataset.archiveId, favorite);
    change('finished'); assert.equal(root.querySelectorAll('.archive-card').length, 1);
    change('unfinished'); assert.equal(root.querySelectorAll('.archive-card').length, 2);
    const card = root.querySelector(`[data-archive-id="${removed.id}"]`);
    [...card.querySelectorAll('button')].find(button => button.textContent === '删除').click();
    assert.equal(archive.list().length, 2); assert.match(root.querySelector('.archive-notice').textContent, /已删除/);
    [...root.querySelectorAll('.archive-notice button')].find(button => button.textContent === '撤销删除').click();
    assert.equal(archive.list().length, 3); assert.deepEqual(archive.list().find(entry => entry.id === removed.id).record, removed.record);
    assert.equal(root.querySelectorAll('.archive-card').length, 2); assert.match(root.querySelector('.archive-notice').textContent, /已恢复/);
    ui.dispose();
  } finally { finish(); }
});

test('custom setup alternates only after successful placements and undo restores the next color', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.com/ai/' }), finish = bind(dom);
  try {
    const dialog = document.querySelector('#setupDialog');
    dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new dom.window.Event('close')); };
    setupCustomUi({ getPosition: () => ({ board: new Uint8Array(225), currentColor: 1, playerColor: 1, workflow: 'follow' }), applyRecord() {}, onModalChange() {}, notify() {} });
    document.querySelector('#openSetup').click();
    const alternate = document.querySelector('#setupAlternate'), svg = document.querySelector('#setupBoard');
    alternate.click(); assert.equal(alternate.getAttribute('aria-pressed'), 'true');
    const place = index => svg.querySelector(`[data-index="${index}"]`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    place(0); assert.equal(svg.querySelector('[data-stone="0"]').getAttribute('data-color'), '1');
    assert.equal(document.querySelector('[data-setup-tool="2"]').getAttribute('aria-pressed'), 'true');
    place(1); assert.equal(svg.querySelector('[data-stone="1"]').getAttribute('data-color'), '2');
    assert.equal(document.querySelector('[data-setup-tool="1"]').getAttribute('aria-pressed'), 'true');
    document.querySelector('#undoSetup').click(); assert.equal(svg.querySelector('[data-stone="1"]'), null);
    assert.equal(document.querySelector('[data-setup-tool="2"]').getAttribute('aria-pressed'), 'true');
    place(1); assert.equal(svg.querySelector('[data-stone="1"]').getAttribute('data-color'), '2');
    document.querySelector('[data-setup-tool="0"]').click(); place(1);
    assert.equal(document.querySelector('[data-setup-tool="0"]').getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelector('#setupSide').value, '1');
    dialog.close(); document.querySelector('#openSetup').click(); assert.equal(alternate.getAttribute('aria-pressed'), 'false');
    dialog.close();
  } finally { finish(); }
});

test('review autoplay stops on manual navigation, at the end, in the background and when closed', () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.com/ai/', pretendToBeVisual: true }), finish = bind(dom);
  const oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout; let clock = 0, id = 0; const timers = new Map();
  globalThis.setTimeout = (callback, delay) => { const token = ++id; timers.set(token, { callback, at: clock + delay }); return token; };
  globalThis.clearTimeout = token => timers.delete(token);
  const advance = ms => { const until = clock + ms; for (;;) {
    const next = [...timers.entries()].sort((a,b) => a[1].at - b[1].at)[0];
    if (!next || next[1].at > until) break; timers.delete(next[0]); clock = next[1].at; next[1].callback();
  } clock = until; };
  try {
    const root = document.querySelector('#root');
    const review = createReviewUi(root, { search: () => new Promise(() => {}), cancelSearch() {}, close() {}, newGame() {} });
    const record = createRecord([0,15,1,16,2,17,3,18,4],1); void review.open(record);
    const play = root.querySelector('[data-play]'), range = root.querySelector('[data-timeline]');
    play.click(); assert.equal(range.value,'0'); assert.equal(play.getAttribute('aria-pressed'),'true');
    advance(800); assert.equal(range.value,'1');
    root.querySelector('[data-next]').click(); assert.equal(range.value,'2'); assert.equal(play.getAttribute('aria-pressed'),'false');
    advance(3000); assert.equal(range.value,'2');
    range.value='8'; range.dispatchEvent(new dom.window.Event('input')); play.click(); advance(800);
    assert.equal(range.value,'9'); assert.equal(play.getAttribute('aria-pressed'),'false');
    play.click(); advance(800); Object.defineProperty(document,'hidden',{ configurable:true,value:true });
    document.dispatchEvent(new dom.window.Event('visibilitychange')); assert.equal(play.getAttribute('aria-pressed'),'false');
    const saved = range.value; advance(3000); assert.equal(range.value,saved);
    Object.defineProperty(document,'hidden',{ configurable:true,value:false }); play.click(); review.dispose(); assert.equal(timers.size,0);
  } finally { globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; finish(); }
});

test('saved names and notes survive game updates and deletion undo; history can be searched, filtered and sorted', () => {
  const dom = new JSDOM('<div id="root"></div>', { url:'https://example.com/ai/' }), finish=bind(dom);
  try {
    let n=0,t=0; const archive=createGameArchive({storage:dom.window.localStorage,page:'test',id:()=>`g${++n}`,now:()=>++t});
    archive.capture(createRecord([0],1));const id=archive.list()[0].id;
    assert.equal(archive.annotate(id,{name:'关键对局',note:'防守变化'}),true);
    archive.capture(createRecord([0,15],1)); assert.equal(archive.list()[0].name,'关键对局');assert.equal(archive.list()[0].note,'防守变化');
    archive.begin();archive.capture(createRecord([112],1));const newer=archive.list()[0].id;
    const root=document.querySelector('#root'),ui=createArchiveUi(root,{archive,close(){},resume(){},review(){},exportRecord(){}});ui.open();
    const search=root.querySelector('[data-archive-search]');search.value='防守';search.dispatchEvent(new dom.window.Event('input'));
    assert.equal(root.querySelectorAll('.archive-card').length,1);assert.equal(root.querySelector('.archive-card').dataset.archiveId,id);
    search.value='';search.dispatchEvent(new dom.window.Event('input'));
    const rule=root.querySelector('[data-rule-filter]');rule.value='rif';rule.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelectorAll('.archive-card').length,0);
    rule.value='freestyle';rule.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelectorAll('.archive-card').length,2);
    const sort=root.querySelector('[data-archive-sort]');sort.value='oldest';sort.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelector('.archive-card').dataset.archiveId,id);
    archive.favorite(newer);sort.value='favorite';sort.dispatchEvent(new dom.window.Event('change'));assert.equal(root.querySelector('.archive-card').dataset.archiveId,newer);
    const saved=archive.list().find(x=>x.id===id);archive.remove(id);assert.equal(archive.restore(saved),true);assert.equal(archive.list().find(x=>x.id===id).note,'防守变化');ui.dispose();
  } finally {finish();}
});

test('review supports endpoints, keyboard navigation, reverse playback and speed changes', () => {
  const dom=new JSDOM('<div id="root"></div>',{url:'https://example.com/ai/',pretendToBeVisual:true}),finish=bind(dom);
  const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let id=0;const timers=new Map();
  globalThis.setTimeout=(fn,delay)=>{const key=++id;timers.set(key,{fn,delay});return key;};globalThis.clearTimeout=key=>timers.delete(key);
  try {
    const root=document.querySelector('#root'),ui=createReviewUi(root,{search:()=>new Promise(()=>{}),cancelSearch(){},close(){},newGame(){}});
    void ui.open(createRecord([0,15,1,16,2,17,3,18,4],1));const slider=root.querySelector('[data-timeline]');
    root.querySelector('[data-first]').click();assert.equal(slider.value,'0');root.querySelector('[data-last]').click();assert.equal(slider.value,'9');
    const svg=root.querySelector('svg');svg.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(slider.value,'8');
    svg.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.equal(slider.value,'0');
    root.querySelector('[data-direction]').value='-1';root.querySelector('[data-speed]').value='400';root.querySelector('[data-play]').click();
    assert.equal(slider.value,'9');let [token,timer]=[...timers][0];assert.equal(timer.delay,400);timers.delete(token);timer.fn();assert.equal(slider.value,'8');
    root.querySelector('[data-speed]').value='1400';root.querySelector('[data-speed]').dispatchEvent(new dom.window.Event('change'));assert.equal([...timers.values()][0].delay,1400);
    ui.dispose();assert.equal(timers.size,0);
  } finally {globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;finish();}
});
