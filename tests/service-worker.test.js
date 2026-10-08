import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, access } from 'node:fs/promises';
import { APP_VERSION } from '../app-release.js';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const base = 'https://example.com/ai/', key = x => typeof x === 'string' ? x : x.url;
function fixture({ engineError = false, enginePutError = false } = {}) {
  const handlers = {}, stores = new Map(), messages = [], network = [];
  let claimed = false, skipped = false;
  const caches = { keys: async () => [...stores.keys()], delete: async name => stores.delete(name), open: async name => {
    if (!stores.has(name)) stores.set(name, new Map()); const data = stores.get(name);
    return { match: async request => data.get(key(request))?.clone(), put: async (request, response) => {
      if (enginePutError && name.endsWith('engine-250615')) throw new Error('quota exceeded');
      data.set(key(request), response.clone()); },
      addAll: async requests => { for (const request of requests) data.set(key(request), await fetcher(request)); } };
  } };
  async function fetcher(request, options) {
    const url = key(request); network.push({ url, options });
    if (engineError && /\/engine\//.test(url)) throw new Error('model download failed');
    if (url.endsWith('manifest.json')) return Response.json({ files: { 'model.bin': {}, 'engine.wasm': {} } });
    return new Response('fresh:' + url);
  }
  const client = { postMessage: data => messages.push(data) };
  const context = vm.createContext({ URL, Request, Response, caches, fetch: fetcher, self: { location: { href: base + 'sw.js' }, addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => { skipped = true; }, clients: { claim: async () => { claimed = true; }, matchAll: async () => [client] } } });
  vm.runInContext(source, context);
  const constants = vm.runInContext('({ PREFIX, VERSION, ENGINE_CACHE, RELEASE, CORE, ENGINE, RENJU })', context);
  async function dispatch(type, extra = {}) { let pending; handlers[type]({ ...extra, waitUntil: p => { pending = p; } }); await pending; }
  async function request(path, { mode } = {}) {
    let pending; const req = new Request(new URL(path, base));
    if (mode) Object.defineProperty(req, 'mode', { value: mode });
    handlers.fetch({ request: req, respondWith: p => { pending = p; } }); return await pending;
  }
  return { ...constants, caches, stores, messages, network, client, dispatch, request, claimed: () => claimed, skipped: () => skipped };
}

test('all precached shell resources exist and the worker identifies the same release as the page', async () => {
  const f = fixture(); assert.equal(f.RELEASE, APP_VERSION);
  for (const path of f.CORE) {
    const pathname = path === './' ? 'index.html' : path.split('?')[0];
    await access(new URL('../' + pathname, import.meta.url));
  }
});
test('shell installation and activation complete even when every model download fails', async () => {
  const f = fixture({ engineError: true }); await f.dispatch('install');
  assert.equal(f.skipped(), true); assert.equal(f.network.some(x => /\/engine\//.test(x.url)), false);
  await f.dispatch('activate'); assert.equal(f.claimed(), true); assert.equal(f.messages.at(-1).version, APP_VERSION);
  assert.equal(f.messages.at(-1).offline, false);
  await f.dispatch('message', { data: { type: 'offline-status' }, source: f.client });
  assert.equal(f.messages.at(-1).offline, false);
  assert.match(await (await f.request('image-import-ui.js')).text(), /fresh:/);
});
test('pinned engines migrate from the old cache with no downloads; cleanup only removes this project caches', async () => {
  const f = fixture({ engineError: true }), oldName = f.PREFIX + '250615-v31', old = await f.caches.open(oldName);
  await f.caches.open('other-project:keep');
  for (const prefix of [f.ENGINE, f.RENJU]) {
    await old.put(base + prefix + 'manifest.json', Response.json({ files: { 'model.bin': {}, 'engine.wasm': {} } }));
    for (const name of ['model.bin', 'engine.wasm']) await old.put(base + prefix + name, new Response('old engine bytes'));
  }
  await f.dispatch('install'); await f.dispatch('activate');
  await f.dispatch('message', { data: { type: 'offline-status' }, source: f.client });
  assert.equal(f.messages.at(-1).offline, true); assert.equal(f.stores.has(oldName), false); assert.equal(f.stores.has('other-project:keep'), true);
  assert.equal(f.network.some(x => /\/engine\//.test(x.url)), false);
  assert.equal(await (await f.request(f.ENGINE + 'model.bin')).text(), 'old engine bytes');
});
test('failed engine warmup retains legacy offline assets and never serves old app scripts', async () => {
  const f = fixture({ engineError: true }), oldName = f.PREFIX + '250615-v31', old = await f.caches.open(oldName);
  await old.put(base + 'image-import-ui.js', new Response('old app'));
  await old.put(base + f.ENGINE + 'model.bin', new Response('saved model'));
  await f.dispatch('install'); await f.dispatch('activate');
  await f.dispatch('message', { data: { type: 'offline-status' }, source: f.client });
  assert.equal(f.stores.has(oldName), true);
  assert.equal(await (await f.request(f.ENGINE + 'model.bin')).text(), 'saved model');
  assert.notEqual(await (await f.request('image-import-ui.js')).text(), 'old app');
});
test('simple navigation shares the shell; the recovery page bypasses its cached copy', async () => {
  const f = fixture(); await f.dispatch('install');
  assert.equal(await (await f.request('renju.html?view=simple', { mode: 'navigate' })).text(), 'fresh:' + base + 'renju.html');
  const shell = await f.caches.open(f.VERSION); await shell.put(base + 'update.html', new Response('stale recovery'));
  assert.equal(await (await f.request('update.html')).text(), 'fresh:' + base + 'update.html');
  assert.equal(f.network.at(-1).options.cache, 'no-store');
});
test('storage quota failures do not discard a successfully downloaded online engine response', async () => {
  const f = fixture({ enginePutError: true });
  assert.equal(await (await f.request(f.ENGINE + 'engine.wasm')).text(), 'fresh:' + base + f.ENGINE + 'engine.wasm');
});
