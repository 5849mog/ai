const BASE = new URL("./", self.location.href);
const PREFIX = `gomoku-rapfi:${BASE.pathname}:`;
const RELEASE = "2026.11.21.2";
const SHELL_PREFIX = `gomoku-shell:${BASE.pathname}:`;
const VERSION = SHELL_PREFIX + "261121-v83";
const ENGINE_CACHE = PREFIX + "engine-250615";
const OFFLINE_MARKER = new URL("__engine_offline_ready__", BASE).href;
const url = path => new URL(path, BASE).href;
const SHELL_MARKER = url("__shell_ready__");
const NAVIGATION_PAGES = new Set(["", "index.html", "renju.html", "about.html", "report.html", "update.html"]);
const CORE = ["./", "index.html", "styles.css", "styles.css?v=21", "game-modes.css", "game-modes.css?v=1", "setup-ui.js", "display-modes.js", "board-view.js", "game-rules.js", "engine-assessment.js", "position-analysis.js", "analysis-view.js",
  "engine.js", "engine-protocol.js", "engine-jobs.js", "engine.worker.js", "recommendations.js", "search-info.js", "game-record.js", "record-ui.js", "session-records.js", "favicon.svg", "about.html", "about.css", "about.css?v=5", "about.js", "about.js?v=3", "report.html", "report.css?v=1", "report.js?v=1", "report-model.js?v=1", "THIRD_PARTY.md", "LICENSE",
  "assets/board-wood.svg", "assets/paper-fiber.svg", "assets/stone-satin.svg", "assets/button-undo.svg", "assets/button-restart.svg", "assets/brand-serif.ttf", "assets/OFL-NotoSerif.txt"];
CORE.push("board-layout.js", "styles.css?v=22", "game-modes.css?v=5", "opening.css?v=4", "enhancements.css?v=38", "app-update.js?v=38", "adaptive-search.js", "adaptive-opening.js", "enhancements.css?v=37", "app-update.js?v=37", "game-archive.js", "archive-ui.js", "opening-review.js", "enhancements.css?v=36", "app-update.js?v=36", "ui-scheduler.js", "app-release.js", "app-update.js", "app-update.js?v=32", "app-update.js?v=33", "app-update.js?v=34", "app-update.js?v=35", "update.html", "enhancements.css?v=32", "enhancements.css?v=33", "enhancements.css", "enhancements.css?v=1", "game-enhancements.js", "release-notes.js", "endgame-estimate.js", "image-import-ui.js", "image-board.js", "game-review.js", "review-ui.js", "opening-book.js", "rif-opening-pool.js");
CORE.push("assets/icons/guide.svg", "assets/icons/import.svg", "assets/icons/export.svg", "assets/icons/copy.svg", "assets/icons/eye.svg", "assets/icons/bot.svg", "assets/icons/camera.svg", "assets/icons/board.svg", "assets/icons/engine.svg", "assets/icons/layout.svg", "assets/icons/audio.svg", "assets/icons/settings.svg", "assets/icons/undo.svg", "assets/icons/restart.svg", "ui-refinement.css?v=12", "turn-hints.js", "engine.js?v=42", "engine.worker.js?v=42", "engine-jobs.js?v=42");
CORE.push("remote-engine.js", "remote-engine.js?v=45", "remote-engine.js?v=46", "remote-engine-ui.js", "remote-engine-ui.js?v=45", "remote-engine-ui.js?v=46", "remote-engine.css");
CORE.push("opening.css?v=6", "enhancements.css?v=48");
CORE.push("opening.css?v=7", "enhancements.css?v=49", "styles.css?v=23", "game-modes.css?v=6", "sound.js");
CORE.push("enhancements.css?v=50", "game-motion.js");
CORE.push("enhancements.css?v=51", "board-preferences.js", "board-facts.js", "board-transform.js", "thinking-options.js");
CORE.push("enhancements.css?v=52", "game-modes.css?v=7", "enhancements.css?v=53");
CORE.push("forced-opening.js", "export-utils.js", "report.css?v=2", "report.js?v=2", "real-game-model.js", "svg-view.js", "image-grid.js", "board-image.js", "review-branch.js", "partial-review.js", "enhancements.css?v=54", "enhancements.css?v=55", "enhancements.css?v=56", "enhancements.css?v=57", "enhancements.css?v=58");
const ENGINE = "engine/rapfi-250615/";
const RENJU = "engine/renju-250615/";
CORE.push("game-modes.css?v=2", "game-modes.css?v=3", "game-modes.css?v=4", "renju.html", "opening.css", "opening.css?v=1", "opening.css?v=2", "opening.css?v=3", "opening-session.js", "opening-flow.js", "renju-rules.js", "opening-advisor.js", "opening-app.js", "opening-guide.js",
  "engine.js?v=22", "engine.worker.js?v=22", "engine-protocol.js?v=22", "engine-jobs.js?v=22", "recommendations.js?v=22");

async function populateShell(cache) {
  await cache.addAll(CORE.map(path => new Request(url(path), { cache: "reload" })));
  await cache.put(SHELL_MARKER, new Response(RELEASE));
}
async function shellIsReady(cache) {
  return Boolean(await cache.match(SHELL_MARKER) && await cache.match(url("./")));
}
async function repairShell() {
  const cache = await caches.open(VERSION);
  if (await shellIsReady(cache)) return;
  // An older worker may still be running after a deployment. Only refill its
  // shell if the server still advertises that exact release.
  const response = await fetch(url("app-release.js"), { cache: "no-store" });
  if (!response.ok || !(await response.text()).includes(`"${RELEASE}"`)) throw new Error("Shell release changed");
  await populateShell(cache);
}
const shellGeneration = name => Number(/-v(\d+)$/.exec(name)?.[1]);
const superseded = name => (name.startsWith(PREFIX) || name.startsWith(SHELL_PREFIX))
  && shellGeneration(name) < shellGeneration(VERSION);

// Updating the UI must not depend on downloading every large AI model again.
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    await populateShell(await caches.open(VERSION));
    await self.skipWaiting();
  })());
});
async function legacyEngine(request) {
  for (const name of await caches.keys()) {
    if (superseded(name)) {
      const cached = await (await caches.open(name)).match(request);
      if (cached) return cached;
    }
  }
}
async function warmEngines() {
  const cache = await caches.open(ENGINE_CACHE);
  if (await cache.match(OFFLINE_MARKER)) return;
  async function ensure(path) {
    const request = url(path);
    if (await cache.match(request)) return;
    const response = await legacyEngine(request) ?? await fetch(request, { cache: "no-store" });
    if (!response.ok) throw new Error("Engine cache incomplete");
    await cache.put(request, response);
  }
  for (const base of [ENGINE, RENJU]) {
    await ensure(base + "manifest.json");
    const manifest = await (await cache.match(url(base + "manifest.json"))).json();
    const paths = Object.keys(manifest.files).map(name => base + name);
    for (let i = 0; i < paths.length; i += 3) await Promise.all(paths.slice(i, i + 3).map(ensure));
  }
  await cache.put(OFFLINE_MARKER, new Response("complete"));
}
async function status(client) {
  const shell = await shellIsReady(await caches.open(VERSION));
  const offline = shell && Boolean(await (await caches.open(ENGINE_CACHE)).match(OFFLINE_MARKER));
  client?.postMessage({ type: "app-status", version: shell ? RELEASE : "", shell, offline });
}
async function notify() { for (const client of await self.clients.matchAll()) await status(client); }
let warming;
function prepareOffline() {
  warming ??= (async () => {
    try {
      // Reuse the previous release's pinned engine assets before removing it.
      await Promise.all([repairShell(), warmEngines()]);
      const names = await caches.keys();
      await Promise.all(names.filter(name => superseded(name)).map(name => caches.delete(name)));
    } catch { /* Online play/UI updates still work; keep old offline engine assets. */ }
    await notify();
  })().finally(() => { warming = null; });
  return warming;
}
self.addEventListener("activate", event => {
  event.waitUntil((async () => { await self.clients.claim(); await notify(); })());
});
self.addEventListener("message", event => {
  // Bulk caching runs after activation, so it cannot hold the UI update hostage.
  if (event.data?.type === "offline-status") event.waitUntil((async () => { await status(event.source); await prepareOffline(); })());
  if (event.data?.type === "activate-update") event.waitUntil(self.skipWaiting());
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(BASE.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const path = new URL(event.request.url).pathname.slice(BASE.pathname.length);
    // The recovery page must remain reachable even with an older installed app.
    if (path === "update.html") {
      try { const response = await fetch(event.request, { cache: "no-store" }); if (response.ok) return response; } catch { /* use offline copy */ }
    }
    // Published content can change independently of the installed application.
    if (path === "content/feed.json" || path.startsWith("reports/")) return fetch(event.request, { cache: "no-store" });
    if (path.startsWith(ENGINE) || path.startsWith(RENJU)) {
      const engines = await caches.open(ENGINE_CACHE);
      const cached = await engines.match(event.request) ?? await legacyEngine(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) {
        try { await engines.put(event.request, response.clone()); } catch { /* Quota limits must not break online play. */ }
      }
      return response;
    }
    let cached = await cache.match(event.request);
    if (!cached && event.request.mode === "navigate" && NAVIGATION_PAGES.has(path)) cached = await cache.match(url(path || "./"));
    return cached ?? fetch(event.request);
  })());
});
