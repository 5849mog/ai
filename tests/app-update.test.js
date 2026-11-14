import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { setupAppUpdates, updateControlMarkup, createSafeUpdateGate } from '../app-update.js';
import { APP_VERSION } from '../app-release.js';

const flush = () => new Promise(done => setImmediate(done));
const newerVersion = APP_VERSION.replace(/\d+$/, suffix => String(Number(suffix) + 1));
function fixture({ fail = false } = {}) {
  const dom = new JSDOM(`${updateControlMarkup()}${updateControlMarkup()}<p id="offlineState"></p>`), doc = dom.window.document;
  const events = new EventTarget(), registration = new EventTarget();
  let updates = 0, reloads = 0;
  registration.update = async () => { updates++; if (fail) throw new Error('network unavailable'); };
  const serviceWorker = events;
  serviceWorker.controller = { postMessage(data) { if (data.type === 'offline-status') status(APP_VERSION, true); } };
  serviceWorker.register = async (_, options) => { assert.equal(options.updateViaCache, 'none'); return registration; };
  function status(version, offline) {
    const event = new Event('message'); event.data = { type: 'app-status', version, offline }; events.dispatchEvent(event);
  }
  const ui = setupAppUpdates({ container: doc, serviceWorker, reload: () => reloads++ });
  return { dom, doc, serviceWorker, registration, status, ui, updates: () => updates, reloads: () => reloads };
}
test('both inline update controls show actual code/cache versions and reload only on an explicit click', async () => {
  const f = fixture(); await f.ui.initialized;
  for (const label of f.doc.querySelectorAll('[data-app-version]')) assert.match(label.textContent, new RegExp(APP_VERSION));
  f.status(newerVersion, false); assert.equal(f.reloads(), 0);
  for (const button of f.doc.querySelectorAll('[data-app-update]')) assert.equal(button.textContent, '刷新使用新版');
  assert.match(f.doc.querySelector('#offlineState').textContent, /未完成/);
  await f.ui.check(); assert.equal(f.reloads(), 1); f.dom.window.close();
});
test('an older installed cache requires an update check rather than a reload back to old code', async () => {
  const f = fixture(); await f.ui.initialized;
  f.status('2026.10.08.1', true);
  assert.equal(f.doc.querySelector('[data-app-update]').textContent, '检查更新');
  await f.ui.check(); assert.equal(f.updates(), 1); assert.equal(f.reloads(), 0);
  f.dom.window.close();
});
test('a completed manual check offers a separate reload; failures keep the retry action', async () => {
  const good = fixture(); await good.ui.check(); assert.equal(good.updates(), 1); assert.equal(good.reloads(), 0);
  assert.equal(good.doc.querySelector('[data-app-update]').textContent, '重新加载本页');
  await good.ui.check(); assert.equal(good.reloads(), 1); good.dom.window.close();
  const bad = fixture({ fail: true }); await bad.ui.check(); assert.equal(bad.reloads(), 0);
  assert.match(bad.doc.querySelector('[data-app-version]').textContent, /network unavailable/);
  assert.equal(bad.doc.querySelector('[data-app-update]').disabled, false); await bad.ui.check(); assert.equal(bad.updates(), 2); bad.dom.window.close();
});
test('manual checks wait for the new worker and cannot reload while installation is pending', async () => {
  const f = fixture(), worker = new EventTarget(); worker.state = 'installing'; f.registration.installing = worker;
  const checking = f.ui.check(); await flush();
  assert.equal(f.doc.querySelector('[data-app-update]').disabled, true); assert.equal(f.reloads(), 0);
  await f.ui.check(); assert.equal(f.reloads(), 0);
  worker.state = 'activated'; f.registration.installing = null; worker.dispatchEvent(new Event('statechange')); await checking;
  assert.equal(f.reloads(), 0); assert.equal(f.doc.querySelector('[data-app-update]').disabled, false); f.dom.window.close();
});
test('legacy messages cannot falsely report the new version or offline completeness', async () => {
  const f = fixture(); await f.ui.initialized; const before = f.doc.querySelector('#offlineState').textContent;
  const event = new Event('message'); event.data = { type: 'offline-ready' }; f.serviceWorker.dispatchEvent(event);
  assert.equal(f.doc.querySelector('#offlineState').textContent, before); f.dom.window.close();
});
test('automatic application is gated and only reloads for a newer installed version', async()=>{
 const dom=new JSDOM(updateControlMarkup()),events=new EventTarget(),registration=new EventTarget();let allowed=false,reloads=0,updates=0;
 registration.update=async()=>{updates++;};events.controller={postMessage(){}};events.register=async()=>registration;
 const ui=setupAppUpdates({container:dom.window.document,serviceWorker:events,reload:()=>reloads++,autoApply:()=>allowed});await ui.initialized;assert.equal(updates,1);
 const status=version=>{const e=new Event('message');e.data={type:'app-status',version,offline:true};events.dispatchEvent(e);};
 status(APP_VERSION);assert.equal(reloads,0);status(newerVersion);assert.equal(reloads,0);allowed=true;status(newerVersion);assert.equal(reloads,1);dom.window.close();
});

test('safe gate blocks unsaved work, corruption, failed saves and reload loops',()=>{
 const state={untouched:true,loadSafe:true,hidden:false,modal:false,busy:false,pending:false,forbidden:false};let saved=0;const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const gate=createSafeUpdateGate({state:()=>state,storage,key:'once',save:()=>{saved++;return true;}});
 for(const name of ['hidden','modal','busy','pending','forbidden']){state[name]=true;assert.equal(gate('next'),false);state[name]=false;}assert.equal(saved,0);
 state.untouched=false;assert.equal(gate('next'),null);state.untouched=true;state.loadSafe=false;assert.equal(gate('next'),null);state.loadSafe=true;
 assert.equal(gate('next'),true);assert.equal(saved,1);assert.equal(gate('next'),null);assert.equal(saved,1);
 assert.equal(createSafeUpdateGate({state:()=>state,storage,key:'fail',save:()=>false})('next'),null);
 assert.equal(createSafeUpdateGate({state:()=>state,storage:{getItem(){throw Error('blocked');}},key:'x',save:()=>true})('next'),null);
});
