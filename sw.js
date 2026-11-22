const BASE = new URL("./", self.location.href);
const PREFIX = `gomoku-rapfi:${BASE.pathname}:`;
const RELEASE = "2026.11.22.3";
const SHELL_PREFIX = `gomoku-shell:${BASE.pathname}:`;
const VERSION = SHELL_PREFIX + "261122-v92";
const ENGINE_CACHE = PREFIX + "engine-250615";
const OFFLINE_MARKER = new URL("__engine_offline_ready__", BASE).href;
const url = path => new URL(path, BASE).href;
const SHELL_MARKER = url("__shell_ready__");
const NAVIGATION_PAGES = new Set(["", "index.html", "renju.html", "about.html", "report.html", "update.html"]);
const CORE = [
  ...Array.from(NAVIGATION_PAGES, path => path || "./"),

  // UI styles, about, report and recovery entry points.
  "favicon.svg", "styles.css?v=24", "game-modes.css?v=8", "opening.css?v=8",
  "enhancements.css?v=60", "ui-refinement.css?v=14", "quick-settings.css?v=2",
  "button-theme.css", "surface-theme.css", "play-polish.css", "remote-engine.css",
  "about.css?v=6", "about.js?v=3", "report.css?v=3", "report.js?v=2", "real-game-model.js",
  "app-release.js", "app-update.js", "app-update.js?v=38", "release-notes.js",

  // Board rendering, responsive layout and input.
  "analysis-view.js", "board-facts.js", "board-layout.js", "board-loupe.js",
  "board-preferences.js", "board-transform.js", "board-view.js", "display-modes.js",
  "game-motion.js", "match-inspector.js", "quick-settings.js", "sound.js",
  "svg-view.js", "turn-hints.js", "ui-scheduler.js",

  // Rules, opening and search.
  "adaptive-opening.js", "adaptive-search.js", "endgame-estimate.js", "engine-assessment.js",
  "engine.js?v=42", "engine.worker.js?v=42", "engine-jobs.js?v=42", "engine-protocol.js?v=22",
  "forced-opening.js", "game-rules.js", "opening-advisor.js", "opening-app.js",
  "opening-book.js", "opening-flow.js", "opening-guide.js", "opening-session.js",
  "position-analysis.js", "recommendations.js?v=22", "remote-engine.js",
  "remote-engine-ui.js?v=46", "remote-engine.js?v=46", "renju-rules.js",
  "rif-opening-pool.js", "search-info.js", "thinking-options.js",

  // Saved and shared positions, imports and exports.
  "archive-ui.js", "board-image.js", "export-utils.js", "game-archive.js",
  "game-enhancements.js", "game-record.js", "game-review.js", "image-board.js",
  "image-grid.js", "image-import-ui.js", "opening-review.js", "partial-review.js",
  "position-link-ui.js", "position-link.js", "record-ui.js", "review-branch.js",
  "review-ui.js", "session-records.js", "setup-ui.js",

  // Visual assets and offline license notices.
  "assets/board-wood.svg", "assets/brand-serif.ttf", "assets/paper-fiber.svg",
  "assets/stone-satin.svg", "assets/icons/audio.svg", "assets/icons/board.svg",
  "assets/icons/bot.svg", "assets/icons/camera.svg", "assets/icons/copy.svg",
  "assets/icons/engine.svg", "assets/icons/export.svg", "assets/icons/eye.svg",
  "assets/icons/guide.svg", "assets/icons/import.svg", "assets/icons/layout.svg",
  "assets/icons/restart.svg", "assets/icons/settings.svg", "assets/icons/undo.svg",
  "assets/OFL-NotoSerif.txt", "LICENSE", "THIRD_PARTY.md"
];
const ENGINE = "engine/rapfi-250615/";
const RENJU = "engine/renju-250615/";

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
