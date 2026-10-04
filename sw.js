const BASE = new URL("./", self.location.href);
const PREFIX = `gomoku-rapfi:${BASE.pathname}:`;
const VERSION = PREFIX + "250615-v12";
const url = path => new URL(path, BASE).href;
const CORE = ["./", "index.html", "styles.css", "styles.css?v=12", "app.js", "board-view.js", "game-rules.js", "engine-assessment.js", "position-analysis.js", "analysis-view.js",
  "engine.js", "engine-protocol.js", "engine-jobs.js", "engine.worker.js", "recommendations.js", "search-info.js", "game-record.js", "record-ui.js", "favicon.svg", "about.html", "THIRD_PARTY.md", "LICENSE",
  "assets/board-wood.svg", "assets/paper-fiber.svg", "assets/stone-satin.svg", "assets/button-undo.svg", "assets/button-restart.svg", "assets/brand-serif.ttf", "assets/OFL-NotoSerif.txt"];
const ENGINE = "engine/rapfi-250615/";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const manifestResponse = await fetch(url(ENGINE + "manifest.json"), { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error("Missing engine manifest");
    const manifest = await manifestResponse.clone().json();
    const resources = [...CORE, ENGINE + "manifest.json",
      ...Object.keys(manifest.files).map(name => ENGINE + name)].map(url);
    await cache.addAll(resources);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== VERSION).map(name => caches.delete(name)));
    await self.clients.claim();
    for (const client of await self.clients.matchAll()) client.postMessage({ type: "offline-ready" });
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "offline-status") event.source?.postMessage({ type: "offline-ready" });
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(BASE.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    return fetch(event.request);
  })());
});
