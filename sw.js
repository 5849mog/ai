const BASE = new URL("./", self.location.href);
const PREFIX = `gomoku-rapfi:${BASE.pathname}:`;
const RELEASE = "2026.11.28.4";
const SHELL_PREFIX = `gomoku-shell:${BASE.pathname}:`;
const VERSION = SHELL_PREFIX + "261128-v102";
const ENGINE_CACHE = PREFIX + "engine-250615";
const OFFLINE_MARKER = new URL("__engine_offline_ready__", BASE).href;
const url = path => new URL(path, BASE).href;
const SHELL_MARKER = url("__shell_ready__");
const NAVIGATION_PAGES = new Set(["", "index.html", "renju.html", "about.html", "about.zh-CN.html", "report.html", "update.html"]);
const CORE = [
  ...Array.from(NAVIGATION_PAGES, path => path || "./"),

  // UI styles, about, report and recovery entry points.
  "favicon.svg", "styles.css?v=26", "game-modes.css?v=8", "opening.css?v=8",
  "enhancements.css?v=60", "ui-refinement.css?v=14", "quick-settings.css?v=2",
  "button-theme.css", "surface-theme.css", "play-polish.css?v=1", "remote-engine.css",
  "about.css?v=7", "report.css?v=3", "app-release.js",

  // Published JavaScript bundles. The worker URL is loaded by the app bundle.
  "about.protected.js?v=4", "report.protected.js?v=2", "wordmark.protected.js",
  "app-update.protected.js?v=38", "update-page.protected.js", "remote-engine-ui.protected.js?v=46",
  "opening-app.protected.js", "engine.worker.protected.js?v=45",

  // Visual assets and offline license notices.
  "assets/board-wood.svg", "assets/paper-fiber.svg",
  "assets/stone-satin.svg", "assets/icons/audio.svg", "assets/icons/board.svg",
  "assets/icons/bot.svg", "assets/icons/camera.svg", "assets/icons/copy.svg",
  "assets/icons/engine.svg", "assets/icons/export.svg", "assets/icons/eye.svg",
  "assets/icons/guide.svg", "assets/icons/import.svg", "assets/icons/layout.svg",
  "assets/icons/restart.svg", "assets/icons/settings.svg", "assets/icons/undo.svg",
  "assets/OFL-NotoSerif.txt", "LICENSE", "THIRD_PARTY.md"
];
// BEGIN GENERATED ASSET INTEGRITY
const ASSET_INTEGRITY = {
  "about.protected.js?v=4": "sha384-YpbiWjkxbD++6pmyMxVWr4rcaFb5adn+afCpCGQsZCjUcDqhFf82GVsPWubB+euW",
  "report.protected.js?v=2": "sha384-S5pjJQcy9ZpF4joCIk7Xy6zmvfB8HFpK3NEAMacksKm97AcxqIfBBnqIgfLvff5j",
  "wordmark.protected.js": "sha384-SH7b14M1xB5D32Zyd/8Za8HIrOSQcmDPQvmIx7CA2arMaPOOrPt5pmyc02my/y88",
  "app-update.protected.js?v=38": "sha384-eYr7c9IK32ZR8N/VmDVhpxy3U93OKdBfjz1+lFFBx8hkd1AWLouS91xJ/EH8dGsZ",
  "update-page.protected.js": "sha384-BYyeBTayNIqBnkOCpu+phADpfD24Odiba8lCYgu5/lPhA+5rLILDZ08fmOhbRm+0",
  "remote-engine-ui.protected.js?v=46": "sha384-MNBQgnojWNBt4imMVvhuEimNb3dsw2630KH3jt7HF1LyuZMGuNcciEHGLH7pDc6g",
  "opening-app.protected.js": "sha384-mzY7wqe5G2whXfklvEJ+Z/7kTQeLPoeqwQEjv929dj/9kI1nAlfXLOuLdve7Q81T",
  "engine.worker.protected.js?v=45": "sha384-ao6uXsizAg95SVFZ+FRtMoFfk4tk9iDNiWJ9v3N6UsEfLmjcyYi0ExzTNbeZmGd3"
};
// END GENERATED ASSET INTEGRITY
const ENGINE = "engine/rapfi-250615/";
const RENJU = "engine/renju-250615/";
const OLD_ENGINE_CACHE = "gomoku-rapfi:/ai/:engine-250615";

async function populateShell(cache) {
  await cache.addAll(CORE.map(path => new Request(url(path), { cache: "reload" })));
  // Never mark or activate a new shell until its entry scripts and worker have
  // been checked. A failed install leaves the previous worker and saves intact.
  await Promise.all(Object.entries(ASSET_INTEGRITY).map(async ([path, expected]) => {
    const response = await cache.match(url(path));
    if (!response?.ok) throw new Error("Shell integrity resource missing");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-384", await response.arrayBuffer()));
    if ("sha384-" + btoa(String.fromCharCode(...digest)) !== expected) throw new Error("Shell integrity mismatch");
  }));
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
async function previousSiteEngine(request) {
  if (BASE.pathname !== "/gomoku-studio/") return;
  const path = new URL(typeof request === "string" ? request : request.url).pathname.slice(BASE.pathname.length);
  if (!path.startsWith(ENGINE) && !path.startsWith(RENJU)) return;
  const oldRequest = new URL("/ai/" + path, BASE).href;
  if ((await caches.keys()).includes(OLD_ENGINE_CACHE)) {
    return (await caches.open(OLD_ENGINE_CACHE)).match(oldRequest);
  }
}
async function warmEngines() {
  const cache = await caches.open(ENGINE_CACHE);
  if (await cache.match(OFFLINE_MARKER)) return;
  async function ensure(path) {
    const request = url(path);
    const cached = await cache.match(request) ?? await previousSiteEngine(request);
    if (cached?.ok) return cached;
    const response = await legacyEngine(request) ?? await fetch(request, { cache: "no-store" });
    if (!response.ok) throw new Error("Engine cache incomplete");
    await cache.put(request, response.clone());
    return response;
  }
  for (const base of [ENGINE, RENJU]) {
    const manifest = await (await ensure(base + "manifest.json")).json();
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
    if (path === "content/feed.json" || path === "content/wordmark.wm" || path.startsWith("reports/")) return fetch(event.request, { cache: "no-store" });
    if (path.startsWith(ENGINE) || path.startsWith(RENJU)) {
      const engines = await caches.open(ENGINE_CACHE);
      const cached = await engines.match(event.request) ?? await previousSiteEngine(event.request) ?? await legacyEngine(event.request);
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
