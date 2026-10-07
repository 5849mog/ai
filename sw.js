const BASE = new URL("./", self.location.href);
const PREFIX = `gomoku-rapfi:${BASE.pathname}:`;
const VERSION = PREFIX + "250615-v25";
const url = path => new URL(path, BASE).href;
const CORE = ["./", "index.html", "styles.css", "styles.css?v=21", "game-modes.css", "game-modes.css?v=1", "setup-ui.js", "display-modes.js", "app.js", "board-view.js", "game-rules.js", "engine-assessment.js", "position-analysis.js", "analysis-view.js",
  "engine.js", "engine-protocol.js", "engine-jobs.js", "engine.worker.js", "recommendations.js", "search-info.js", "game-record.js", "record-ui.js", "favicon.svg", "about.html", "about.css", "about.css?v=2", "about.js", "about.js?v=1", "THIRD_PARTY.md", "LICENSE",
  "assets/board-wood.svg", "assets/paper-fiber.svg", "assets/stone-satin.svg", "assets/button-undo.svg", "assets/button-restart.svg", "assets/brand-serif.ttf", "assets/OFL-NotoSerif.txt"];
const ENGINE = "engine/rapfi-250615/";
const RENJU = "engine/renju-250615/";
CORE.push("game-modes.css?v=2", "game-modes.css?v=3", "renju.html", "opening.css", "opening.css?v=1", "opening.css?v=2", "opening-session.js", "opening-flow.js", "renju-rules.js", "opening-advisor.js", "opening-app.js", "opening-guide.js",
  "engine.js?v=22", "engine.worker.js?v=22", "engine-protocol.js?v=22", "engine-jobs.js?v=22", "recommendations.js?v=22");

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const manifestResponse = await fetch(url(ENGINE + "manifest.json"), { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error("Missing engine manifest");
    const manifest = await manifestResponse.clone().json();
    const renjuResponse = await fetch(url(RENJU + "manifest.json"), { cache: "no-store" });
    if (!renjuResponse.ok) throw new Error("Missing Renju manifest");
    const renjuManifest = await renjuResponse.json();
    // Mutable app files must bypass a still-fresh browser HTTP cache when
    // installing a new release. The pinned engine files remain immutable.
    const resources = [...CORE.map(path => new Request(url(path), { cache: "reload" })),
      ...[ENGINE + "manifest.json", ...Object.keys(manifest.files).map(name => ENGINE + name), RENJU + "manifest.json", ...Object.keys(renjuManifest.files).map(name => RENJU + name)].map(url)];
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
    let cached = await cache.match(event.request);
    // The display-mode parameter selects UI, not a different HTML resource.
    // Simple-mode refreshes must share the precached navigation offline.
    if (!cached && event.request.mode === "navigate") {
      const navigation = new URL(event.request.url);
      if (navigation.searchParams.get("view") === "simple") {
        navigation.searchParams.delete("view");
        cached = await cache.match(navigation.href);
      }
    }
    if (cached) return cached;
    return fetch(event.request);
  })());
});
