import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, access } from 'node:fs/promises';
import { APP_VERSION } from '../app-release.js';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const base = 'https://example.com/ai/', key = x => typeof x === 'string' ? x : x.url;
function fixture({ engineError = false, enginePutError = false, scope = base } = {}) {
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
    if (url.endsWith('app-release.js')) return new Response(`export const APP_VERSION = "${APP_VERSION}";`);
    if (url.endsWith('manifest.json')) return Response.json({ files: { 'model.bin': {}, 'engine.wasm': {} } });
    return new Response('fresh:' + url);
  }
  const client = { postMessage: data => messages.push(data) };
  const context = vm.createContext({ URL, Request, Response, caches, fetch: fetcher, self: { location: { href: scope + 'sw.js' }, addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => { skipped = true; }, clients: { claim: async () => { claimed = true; }, matchAll: async () => [client] } } });
  vm.runInContext(source, context);
  const constants = vm.runInContext('({ PREFIX, SHELL_PREFIX, SHELL_MARKER, VERSION, ENGINE_CACHE, RELEASE, CORE, ENGINE, RENJU })', context);
  async function dispatch(type, extra = {}) { let pending; handlers[type]({ ...extra, waitUntil: p => { pending = p; } }); await pending; }
  async function request(path, { mode } = {}) {
    let pending; const req = new Request(new URL(path, scope));
    if (mode) Object.defineProperty(req, 'mode', { value: mode });
    handlers.fetch({ request: req, respondWith: p => { pending = p; } }); return await pending;
  }
  return { ...constants, caches, stores, messages, network, client, dispatch, request, claimed: () => claimed, skipped: () => skipped };
}

test('the app shell includes each static URL used by the current pages, modules and styles', async () => {
  const f = fixture(), cached = new Set(f.CORE);
  assert.equal(f.RELEASE, APP_VERSION);
  assert.equal(cached.size, f.CORE.length, 'duplicate offline URL');
  // The worker script is fetched by the browser's registration/update process.
  // Model files and live JSON use their own cache or network policy.
  const staticFile = /(?:["']|url\()\.\/([\w./-]+\.(?:js|css|svg|ttf)(?:\?[^"'<>\s)]+)?)(?=["')])/g;
  for (const path of f.CORE) {
    const pathname = path === './' ? 'index.html' : path.split('?')[0];
    const file = new URL('../' + pathname, import.meta.url);
    if (!/\.(?:html|js|css)$/.test(pathname)) {
      await access(file);
      continue;
    }
    const text = await readFile(file, 'utf8');
    for (const [, resource] of text.matchAll(staticFile)) {
      if (resource !== 'sw.js') assert.ok(cached.has(resource), `${path} references uncached ${resource}`);
    }
  }
});
test('the renamed site reads the previous immutable model cache without duplicating or downloading weights', async () => {
  const f = fixture({ engineError: true, scope: 'https://example.com/gomoku-studio/' });
  const name = 'gomoku-rapfi:/ai/:engine-250615';
  const old = await f.caches.open(name);
  for (const prefix of [f.ENGINE, f.RENJU]) {
    await old.put(base + prefix + 'manifest.json', Response.json({ files: { 'model.bin': {} } }));
    await old.put(base + prefix + 'model.bin', new Response('old model'));
  }
  await f.dispatch('install');
  await f.dispatch('message', { data: { type: 'offline-status' }, source: f.client });
  assert.equal(f.messages.at(-1).offline, true);
  assert.equal(f.stores.get(f.ENGINE_CACHE).size, 1);
  assert.equal(await (await f.request(f.ENGINE + 'model.bin')).text(), 'old model');
  assert.equal(f.network.some(entry => entry.url.includes('/engine/')), false);
  assert.ok(f.stores.has(name));
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
  assert.equal(await (await f.request('?view=simple&computer-launch=1', { mode: 'navigate' })).text(), 'fresh:' + base);
  const shell = await f.caches.open(f.VERSION); await shell.put(base + 'update.html', new Response('stale recovery'));
  assert.equal(await (await f.request('update.html')).text(), 'fresh:' + base + 'update.html');
  assert.equal(f.network.at(-1).options.cache, 'no-store');
});

test('older cleanup cannot touch the current shell, and current cleanup keeps a newer shell', async () => {
  const f = fixture(); await f.dispatch('install');
  const old = f.PREFIX + '261120-v79', newer = f.SHELL_PREFIX + '261120-v999';
  assert.equal(f.VERSION.startsWith(f.PREFIX), false);
  await f.caches.open(old); await f.caches.open(newer);
  await f.dispatch('message', { data: { type: 'offline-status' }, source: f.client });
  assert.equal(f.stores.has(old), false);
  assert.equal(f.stores.has(f.VERSION), true); assert.equal(f.stores.has(newer), true);
});

test('missing page cache is rebuilt before the next offline-ready announcement', async () => {
  const f = fixture(); await f.dispatch('install');
  await f.dispatch('message', { data: { type: 'offline-status' }, source: f.client });
  await f.caches.delete(f.VERSION); f.messages.length = 0;
  await f.dispatch('message', { data: { type: 'offline-status' }, source: f.client });
  assert.equal(f.messages[0].shell, false); assert.equal(f.messages[0].offline, false);
  assert.equal(f.messages.at(-1).shell, true); assert.equal(f.messages.at(-1).version, APP_VERSION);
  assert.equal(f.messages.at(-1).offline, true); assert.ok(await (await f.caches.open(f.VERSION)).match(f.SHELL_MARKER));
});
test('published report data always bypasses shell caches and uses no-store network requests', async () => {
  const f = fixture(); await f.dispatch('install');
  const path = 'reports/strength-baseline-v1-summary.json';
  const shell = await f.caches.open(f.VERSION); await shell.put(base + path, new Response('stale report'));
  const requestPath = path + '?_=12345';
  assert.equal(await (await f.request(requestPath)).text(), 'fresh:' + base + requestPath);
  assert.equal(f.network.at(-1).options.cache, 'no-store');
  assert.equal(f.CORE.some(item => item.startsWith('reports/')), false);
});

test('release notes refresh independently of the installed shell', async () => {
  const f = fixture(); await f.dispatch('install');
  const path = 'content/feed.json';
  const shell = await f.caches.open(f.VERSION); await shell.put(base + path, new Response('stale notes'));
  assert.equal(await (await f.request(path)).text(), 'fresh:' + base + path);
  assert.equal(f.network.at(-1).options.cache, 'no-store');
  assert.equal(f.CORE.includes(path), false);
});

test('the public wordmark can change without reinstalling the page shell', async () => {
  const f = fixture(); await f.dispatch('install');
  const path = 'content/wordmark.wm';
  const shell = await f.caches.open(f.VERSION); await shell.put(base + path, new Response('stale wordmark'));
  assert.equal(await (await f.request(path)).text(), 'fresh:' + base + path);
  assert.equal(f.network.at(-1).options.cache, 'no-store');
  assert.equal(f.CORE.includes(path), false);
});

test('storage quota failures do not discard a successfully downloaded online engine response', async () => {
  const f = fixture({ enginePutError: true });
  assert.equal(await (await f.request(f.ENGINE + 'engine.wasm')).text(), 'fresh:' + base + f.ENGINE + 'engine.wasm');
});
