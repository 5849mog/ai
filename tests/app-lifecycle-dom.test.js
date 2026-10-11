import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { OpeningSession, replaySession, isAutomaticTurn } from '../opening-session.js';
import { distinctCandidates } from '../renju-rules.js';
import { createReviewUi } from '../review-ui.js';
import { createOpeningBook } from '../opening-book.js';
import { RIF_OPENINGS } from '../rif-opening-pool.js';
import { createGameArchive, ARCHIVE_KEY } from '../game-archive.js';
import { RECORD_KEY, createRecord } from '../game-record.js';

const flush = () => new Promise(done => setImmediate(done));
let fixtureId = 0;
async function environment(page, { saved = null, failSearch = false, blockSave = false, completeAssessment = false, holdSearch = false, timeMs = null } = {}) {
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
      this.last = data;if(data.type==='init')this.initMessage=data;
      if (data.type === 'init') queueMicrotask(() => this.emit({ type: 'ready' }));
      if (data.type === 'ponder') this.ponderJob = data;
      if (data.type === 'search') queueMicrotask(() => {
        (this.searches ??= []).push(data);
        if (holdSearch) return;
        if (failSearch && !failed) { failed = true; this.emit({ type: 'error', requestId: data.requestId, message: 'fixture search failure' }); return; }
        const allowed = data.allowedMoves ?? data.board.flatMap((value,index)=>value ? [] : [index]);
        const index = allowed.includes(113) ? 113 : allowed[0];
        const alternatives = [index,...allowed.filter(i=>i!==index)].slice(0,data.multiPV);
        this.emit({ type: 'move', requestId: data.requestId, result: { index, x: index % 15, y: Math.floor(index / 15), elapsed: 10,
          ...(completeAssessment ? { assessment: { depth: 12, bestIndex: index, winRate: .55, evaluation: 20, mate: null } } : {}),
          ...(data.multiPV>1 ? {recommendations:alternatives.map(index=>({index, ...(completeAssessment ? {score:20, depth:12, winRate:.55} : {})}))} : {}) } });
      });
    }
    emit(data) { if (!this.dead) this.onmessage?.({ data }); }
  };
  const original = new Map();
  for (const [key, value] of Object.entries(values)) { original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
  const storageKey = `gomoku-opening:${new URL('../', import.meta.url).pathname}:v1`;
  if (saved) localStorage.setItem(storageKey, JSON.stringify(saved));
  if(timeMs)localStorage.setItem('gomoku-thinking-ms',String(timeMs));
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

const settled = async () => { for (let n = 0; n < 24; n++) await flush(); };
function savedSession(f) { return replaySession(JSON.parse(localStorage.getItem(f.storageKey)).record); }
function clickPoint(f, index) { document.querySelector(`#boardSvg [data-index="${index}"]`).dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true })); }
function verifyFormalDom(f, s) {
  assert.equal(document.querySelector('#boardSvg').dataset.stage, s.stage);
  assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length, s.moves.length);
  assert.equal(document.querySelectorAll('#boardSvg [data-proposal]').length, s.candidates.length);
  assert.equal(document.querySelectorAll('dialog[open]').length, 0);
  assert.equal(document.querySelector('#retryButton').hidden, true);
  assert.equal(JSON.parse(localStorage.getItem(f.storageKey)).perspective, s.playerColor);
  if (!['play', 'w6'].includes(s.stage)) assert.equal(document.querySelector('#simpleWinRate').dataset.state, 'waiting');
}

// Actual application entry point, rendered inline controls, stored records and
// automatic-turn scheduling. The Worker is deterministic; native engine
// strength and legal search are checked separately by formal-modes-eval.js.
const formalBranches = [
  ...[0,1].flatMap(opener => [0,1].map(mask => ({rule:'rif', opener, mask, ten:false}))),
  ...[0,1].flatMap(opener => Array.from({length:32}, (_,mask) => ({rule:'taraguchi10', opener, mask, ten:false}))),
  ...[0,1].flatMap(opener => Array.from({length:8}, (_,mask) => ({rule:'taraguchi10', opener, mask, ten:true})))
];
for (const branch of formalBranches) test(`formal simple app: ${branch.rule} seat${branch.opener} mask${branch.mask} ${branch.ten?'ten':'normal'}`, async () => {
  const setup = new OpeningSession({rule:branch.rule, workflow:'copilot', initialBlackSeat:null});
  const f = await environment('renju.html', {saved:{record:setup.record(), perspective:1}, completeAssessment:true});
  try {
    await f.load(); document.querySelector(`#simpleOpeningFlow [data-flow-action="start"][data-value="${branch.opener}"]`).click(); await settled();
    let s = savedSession(f), expectedBlack = branch.opener, actions = 0;
    while (s.stage !== 'play') {
      assert.ok(++actions < 30, 'Opening must finish'); verifyFormalDom(f, s);
      assert.equal(isAutomaticTurn(s), false, 'Automatic groups finish before external input');
      if (s.decision) {
        const turn = branch.rule === 'rif' ? 0 : {swap1:0,swap2:1,swap3:2,route4:3,swap5:4}[s.stage];
        const choice = branch.ten && s.stage==='route4' ? 'ten' : branch.mask & (1<<turn) ? 'swap' : 'keep';
        const board = s.board.slice();
        document.querySelector(`#simpleOpeningFlow [data-flow-action="decision"][data-value="${choice}"]`).click();
        if (choice === 'swap') expectedBlack = 1-expectedBlack;
        await settled(); const next=savedSession(f);
        assert.equal(next.blackSeat, expectedBlack);
        for (const [index,value] of board.entries()) if (value) assert.equal(next.board[index], value, 'Swaps never recolor stones');
      } else if (s.stage === 'choose') {
        assert.equal(s.actor,1); const selected=s.candidates.at(-1);
        if(s.candidates.length<=2) document.querySelector(`#simpleOpeningFlow [data-flow-action="select"][data-value="${selected}"]`).click();
        else clickPoint(f,selected); // Ten proposals are selected on the board.
        await settled();
        assert.equal(savedSession(f).board[selected],1);
      } else {
        assert.equal(s.actor,1);
        const index = s.offerCount ? distinctCandidates(s.board,[...s.candidates,...s.allowedMoves({safe:true})])[s.candidates.length] : s.allowedMoves({safe:true})[0];
        clickPoint(f,index); await settled();
        if (s.offerCount) {
          const next=savedSession(f);
          if (next.stage.startsWith('offer') || next.stage==='choose') assert.equal(next.moves.length,4);
        }
      }
      s=savedSession(f);
    }
    verifyFormalDom(f,s); assert.equal(s.blackSeat,expectedBlack); assert.equal(s.actor,1);
    const before=s.record(), ownColor=s.playerColor, count=s.moves.length, opponent=s.allowedMoves({safe:true})[0];
    clickPoint(f,opponent); await settled(); s=savedSession(f);
    assert.equal(s.moves.length,count+2); assert.equal(s.colors.at(-1),ownColor); assert.equal(s.events.at(-1).automatic,true); assert.equal(s.actor,1);
    assert.equal(document.querySelector('#simpleWinRate').dataset.state,'rated');
    assert.equal(JSON.parse(localStorage.getItem(f.storageKey)).analysis.playerColor,ownColor);
    const lastSearch=f.workers.at(-1).searches.at(-1); assert.equal(lastSearch.multiPV,1); assert.equal(lastSearch.sideToMove,ownColor);
    document.querySelector('#simpleUndoButton').click(); await settled();
    assert.deepEqual(savedSession(f).record(),before, 'Undo removes one external move and its AI answer');
  } finally { f.close(); }
});

for (const rule of ['rif','taraguchi10']) test(`${rule}: reload partial proposals and resume selection with the same colors`, async () => {
  const s=new OpeningSession({rule,workflow:'copilot',initialBlackSeat:1});
  for(const index of [112,97,96,128]) { s.apply({type:'stone',index}); if(s.decision && s.stage!=='route4') s.apply({type:'decision',choice:'keep'}); }
  if(s.stage==='route4') s.apply({type:'decision',choice:'ten'});
  const count=s.offerCount, points=distinctCandidates(s.board,s.allowedMoves({safe:true})).slice(0,count);
  for(const index of points.slice(0,count-1)) s.apply({type:'offer',index});
  const f=await environment('renju.html',{saved:{record:s.record(),perspective:2},completeAssessment:true});
  try {
    await f.load(); await settled(); verifyFormalDom(f,savedSession(f));
    assert.deepEqual(savedSession(f).candidates,s.candidates);
    clickPoint(f,points.at(-1)); await settled(); const next=savedSession(f);
    assert.equal(next.moves.length,6); assert.equal(next.stage,'play'); assert.equal(next.actor,1);
    assert.equal(next.colors[4],1); assert.equal(next.colors[5],2); assert.equal(next.candidates.length,0);
    assert.equal(next.record().events.filter(e=>e.type==='select').length,1);
  } finally { f.close(); }
});

for (const rule of ['rif','taraguchi10']) test(`${rule}: a late opening search cannot add stones after starting a new game`, async () => {
  const s=new OpeningSession({rule,workflow:'copilot',initialBlackSeat:1});
  for(const index of [112,97,96]) {s.apply({type:'stone',index}); if(s.decision) s.apply({type:'decision',choice:'keep'});}
  const f=await environment('renju.html',{saved:{record:s.record(),perspective:2},holdSearch:true});
  try {
    await f.load(); await settled(); const worker=f.workers.at(-1), job=worker.searches.at(-1); assert.ok(job);
    document.querySelector('#simpleRestart').click(); await settled();
    worker.emit({type:'move',requestId:job.requestId,result:{index:113,x:8,y:7,assessment:{depth:12,bestIndex:113,winRate:.8,mate:null}}}); await settled();
    const next=savedSession(f); assert.equal(next.stage,'setup'); assert.equal(next.moves.length,0); assert.equal(next.events.length,0);
    assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length,0);
  } finally {f.close();}
});

test('Renju app spends automatic reply time on one line, and its explicit recommendation still requests two', async () => {
  const board = new Uint8Array(225); board[112]=1; board[97]=2;
  const session = new OpeningSession({ rule:'rif', workflow:'copilot', seed:{board,sideToMove:1} });
  const f = await environment('renju.html',{saved:{record:session.record(),perspective:1}});
  try {
    await f.load(); const worker=f.workers.at(-1);
    assert.equal(worker.searches[0].multiPV,1);
    assert.equal(worker.searches[0].sideToMove,1);
    assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length,3);
    document.querySelector('#simpleRecommendButton').click(); await flush(); await flush();
    assert.equal(worker.searches.at(-1).multiPV,2);
    assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length,3);
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

test('RIF simple-mode automatic starts use a complete varied opening and retain numbered stones and inline swaps', async () => {
  const f = await environment('renju.html');
  try {
    await f.load();
    document.querySelector('#simpleOpeningFlow [data-flow-action="start"][data-value="0"]').click();
    await flush(); await flush();
    const saved = JSON.parse(localStorage.getItem(f.storageKey)), restored = new OpeningSession(saved.record);
    for (const event of saved.record.events) restored.apply(event);
    assert.equal(restored.stage, 'swap3'); assert.deepEqual(restored.colors, [1, 2, 1]);
    assert.ok(RIF_OPENINGS.some(entry => entry.key === saved.openingPlan.key));
    assert.deepEqual(restored.moves, saved.openingPlan.points);
    assert.deepEqual([...document.querySelectorAll('#boardSvg [data-order-number]')].map(node => node.textContent), ['1', '2', '3']);
    assert.equal(document.querySelectorAll('#simpleOpeningFlow [data-flow-action="decision"]').length, 2);
    assert.equal(document.querySelectorAll('dialog[open]').length, 0);
    assert.equal(f.workers.length, 0);
    const previous = saved.openingPlan.key;
    document.querySelector('#simpleRestart').click();
    document.querySelector('#simpleOpeningFlow [data-flow-action="start"][data-value="0"]').click();
    await flush(); await flush();
    const next = JSON.parse(localStorage.getItem(f.storageKey)); assert.notEqual(next.openingPlan.key, previous);
    assert.equal(next.record.events.filter(event => event.type === 'stone').length, 3);
  } finally { f.close(); }
});

test('RIF reload continues its stored third stone without changing the existing two or searching a replacement opening', async () => {
  const s = new OpeningSession({ rule: 'rif', workflow: 'copilot', initialBlackSeat: 0 });
  const book = createOpeningBook({ pool: RIF_OPENINGS, random: () => 0 }), plan = book.plan(s);
  for (const index of plan.points.slice(0, 2)) s.apply({ type: 'stone', index }, { automatic: true });
  const f = await environment('renju.html', { saved: { record: s.record(), perspective: 1, openingPlan: book.snapshot(s) } });
  try {
    await f.load(); const saved = JSON.parse(localStorage.getItem(f.storageKey));
    assert.deepEqual(saved.record.events.filter(event => event.type === 'stone').map(event => event.index), plan.points);
    assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length, 3);
    assert.equal(document.querySelector('#simpleOpeningFlow').dataset.stage, 'swap3');
    assert.equal(f.workers.length, 0);
  } finally { f.close(); }
});

test('RIF opponent opening input is preserved and does not activate the automatic opening book', async () => {
  const s = new OpeningSession({ rule: 'rif', workflow: 'copilot', initialBlackSeat: 1 });
  s.apply({ type: 'stone', index: 112 }); s.apply({ type: 'stone', index: 97 });
  const f = await environment('renju.html', { saved: { record: s.record(), perspective: 2 } });
  try {
    await f.load(); const saved = JSON.parse(localStorage.getItem(f.storageKey));
    assert.equal(saved.openingPlan, null); assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length, 2);
    assert.equal(document.querySelector('#simpleOpeningFlow').dataset.stage, 'b3');
    assert.match(document.querySelector('#simpleOpeningFlow').textContent, /录入对方前三子/);
    assert.equal(f.workers.at(-1).last.type, 'init');
  } finally { f.close(); }
});

const byText = text => [...document.querySelectorAll('button')].find(b=>b.textContent===text);
test('freestyle deep mode uses 30 seconds, pauses without placing a move, and ignores a late result before continuing',async()=>{
  const f=await environment('index.html',{holdSearch:true,timeMs:30000});
  try {
    await f.load();clickPoint(f,112);await settled();const old=f.workers.at(-1),job=old.searches.at(-1);assert.equal(job.timeMs,30000);
    assert.equal(byText('暂停思考').hidden,false);byText('暂停思考').click();await settled();
    assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length,1);assert.equal(byText('继续思考').hidden,false);
    old.onmessage({data:{type:'move',requestId:job.requestId,result:{index:113,x:8,y:7}}});await settled();assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length,1);
    byText('继续思考').click();await settled();const next=f.workers.at(-1),search=next.searches.at(-1);assert.notEqual(next,old);assert.equal(search.timeMs,30000);
    next.emit({type:'move',requestId:search.requestId,result:{index:113,x:8,y:7,assessment:{depth:15,bestIndex:113,winRate:.55,mate:null}}});await settled();
    assert.equal(document.querySelectorAll('#boardSvg [data-stone]').length,2);assert.equal(byText('继续思考').hidden,true);
    document.querySelector('#simpleRestart').click();await settled();const entries=JSON.parse(localStorage.getItem(ARCHIVE_KEY)).entries;assert.equal(entries.length,1);assert.deepEqual(entries[0].record.moves,[112,113]);
    assert.equal(entries[0].meta.timeMs,30000);assert.equal(JSON.parse(localStorage.getItem(RECORD_KEY)).moves.length,0);
  }finally{f.close();}
});
for(const rule of ['freestyle','renju','rif','taraguchi10']) test(`${rule}: deep copilot pause preserves seed, continuation uses 30 seconds and New drops late answers`,async()=>{
  const board=new Uint8Array(225);board[112]=1;const s=new OpeningSession({rule,workflow:'copilot',initialBlackSeat:1,seed:{board,sideToMove:2}});
  const f=await environment('renju.html',{saved:{record:s.record(),perspective:2},holdSearch:true,timeMs:30000});
  try {
    await f.load();await settled();const old=f.workers.at(-1),job=old.searches.at(-1);assert.equal(job.timeMs,30000);assert.equal(job.sideToMove,2);
    byText('暂停思考').click();await settled();assert.equal(savedSession(f).events.length,0);assert.equal(savedSession(f).board[112],1);
    old.onmessage({data:{type:'move',requestId:job.requestId,result:{index:113,x:8,y:7}}});await settled();assert.equal(savedSession(f).events.length,0);
    byText('继续思考').click();await settled();const next=f.workers.at(-1),search=next.searches.at(-1);assert.equal(search.timeMs,30000);
    document.querySelector('#simpleRestart').click();await settled();next.onmessage({data:{type:'move',requestId:search.requestId,result:{index:113,x:8,y:7}}});await settled();
    assert.equal(savedSession(f).stage,'setup');assert.equal(savedSession(f).moves.length,0);assert.equal(byText('继续思考').hidden,true);
  }finally{f.close();}
});
test('history can restore a partial RIF proposal from a different live rule without losing the live game',async()=>{
  const old=new OpeningSession({rule:'rif',workflow:'copilot',initialBlackSeat:1});
  for(const index of [112,97,96,128]){old.apply({type:'stone',index});if(old.decision)old.apply({type:'decision',choice:'keep'});}
  old.apply({type:'offer',index:0});
  const board=new Uint8Array(225);board[112]=1;const current=new OpeningSession({rule:'taraguchi10',workflow:'copilot',initialBlackSeat:0,seed:{board,sideToMove:2}});
  const f=await environment('renju.html',{saved:{record:current.record(),perspective:1},completeAssessment:true});
  try {
    const archive=createGameArchive({storage:localStorage,page:'opening'});archive.begin();archive.capture(old.record());const id=archive.list()[0].id;
    await f.load();await settled();document.querySelector('[aria-controls="simpleQuickTools"]').click();document.querySelector('[data-archive]').click();
    assert.equal(document.querySelector('.app-shell').hidden,true);document.querySelector(`[data-archive-id="${id}"] button`).click();await settled();
    const restored=savedSession(f);assert.deepEqual(restored.record(),old.record());assert.equal(restored.stage,'offer');assert.equal(restored.playerColor,2);
    const entries=JSON.parse(localStorage.getItem(ARCHIVE_KEY)).entries;assert.equal(entries.length,2);assert.ok(entries.some(e=>e.record.rule==='taraguchi10'));
    assert.equal(document.querySelector('.app-shell').hidden,false);assert.equal(document.querySelectorAll('#boardSvg [data-proposal]').length,1);
  }finally{f.close();}
});

for(const page of ['index.html','renju.html']) test(`${page}: reviewing archived games selects their actual model and restores the untouched live game`,async()=>{
  const board=new Uint8Array(225);board[112]=1;
  const current=new OpeningSession({rule:'rif',workflow:'copilot',initialBlackSeat:0,seed:{board,sideToMove:2}});
  const f=await environment(page,{saved:page==='renju.html'?{record:current.record(),perspective:1}:null,holdSearch:true});
  try {
    let record;
    if(page==='renju.html')record=createRecord([0,15,1,16,2,17,3,18,4],1);
    else {
      const old=new OpeningSession({rule:'rif',workflow:'follow',initialBlackSeat:1,seed:{board,sideToMove:2}});
      while(!old.winner)old.apply({type:'stone',index:old.allowedMoves({safe:true})[0]});record=old.record();
    }
    const archive=createGameArchive({storage:localStorage,page:page==='renju.html'?'opening':'freestyle'});archive.begin();archive.capture(record);const id=archive.list()[0].id;
    await f.load();await settled();const before=page==='renju.html'?savedSession(f).record():JSON.parse(localStorage.getItem(RECORD_KEY));
    document.querySelector('[data-archive]').click();document.querySelector(`[data-archive-id="${id}"] button`).click();await settled();
    const search=f.workers.at(-1).searches.at(-1);assert.equal(search.rule,page==='renju.html'?'freestyle':'rif');
    assert.equal(document.querySelector('.app-shell').hidden,true);byText('返回结果').click();await settled();
    assert.equal(f.workers.at(-1).initMessage.rule,page==='renju.html'?'rif':'freestyle');
    assert.deepEqual(page==='renju.html'?savedSession(f).record():JSON.parse(localStorage.getItem(RECORD_KEY)),before);
    assert.equal(document.querySelector('.app-shell').hidden,false);
  }finally{f.close();}
});
test('restoring archived partial own RIF opening retains the exact planned third stone',async()=>{
  const old=new OpeningSession({rule:'rif',workflow:'copilot',initialBlackSeat:0});
  const book=createOpeningBook({pool:RIF_OPENINGS,random:()=>.8}),plan=book.plan(old);
  for(const index of plan.points.slice(0,2))old.apply({type:'stone',index},{automatic:true});
  const current=new OpeningSession({rule:'rif',workflow:'copilot',initialBlackSeat:null});
  const f=await environment('renju.html',{saved:{record:current.record(),perspective:1}});
  try {
    const archive=createGameArchive({storage:localStorage,page:'opening'});archive.begin();archive.capture(old.record(),{openingPlan:book.snapshot(old)});const id=archive.list()[0].id;
    await f.load();document.querySelector('[data-archive]').click();document.querySelector(`[data-archive-id="${id}"] button`).click();await settled();
    assert.deepEqual(savedSession(f).moves,plan.points);assert.equal(savedSession(f).stage,'swap3');assert.equal(f.workers.length,0);
  }finally{f.close();}
});
