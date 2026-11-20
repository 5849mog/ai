import { APP_VERSION } from "./app-release.js";
import { isAppVersion, newerVersion, updateControlMarkup } from "./app-update.js";

const FEED_URL = new URL("./content/feed.json", import.meta.url);
const STORAGE_KEY = `gomoku-release-notes:${FEED_URL.pathname}:v1`;
const MAX_TEXT = 16_384;
const MAX_RELEASES = 12;

export function parseReleaseFeed(text) {
  if (typeof text !== "string" || text.length > MAX_TEXT) throw new Error("更新日志大小无效");
  const data = JSON.parse(text);
  if (data?.schema !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1 || !Array.isArray(data.releases)
    || data.releases.length < 1 || data.releases.length > MAX_RELEASES) throw new Error("更新日志格式无效");
  const seen = new Set();
  const clean = (value, limit) => {
    if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error("更新日志文字无效");
    return value.trim();
  };
  const releases = data.releases.map(entry => {
    if (!isAppVersion(entry?.version) || seen.has(entry.version) || !Array.isArray(entry.changes)
      || entry.changes.length < 1 || entry.changes.length > 8) throw new Error("更新日志条目无效");
    seen.add(entry.version);
    return { version: entry.version, title: clean(entry.title, 80), changes: entry.changes.map(change => clean(change, 180)) };
  });
  releases.sort((a, b) => newerVersion(a.version, b.version) ? -1 : 1);
  return { schema: 1, revision: data.revision, releases };
}

export function setupReleaseNotes({ container = document, storage, fetchFeed = globalThis.fetch } = {}) {
  const views = [...container.querySelectorAll("[data-release-notes]")].map(root => {
    const surface = root.dataset.releaseNotes, panelId = `releaseNotes-${surface}`;
    root.innerHTML = `<button type="button" data-notes-toggle data-ui-icon="guide" aria-expanded="false" aria-controls="${panelId}">最近更新</button>
      <section class="release-notes-panel" id="${panelId}" aria-label="最近更新" hidden>
        <div class="release-notes-top"><p data-notes-state role="status"></p><button type="button" data-notes-refresh>刷新日志</button></div>
        <p class="release-notes-installed">当前版本 ${APP_VERSION}</p>
        <ol class="release-note-list"></ol>
        ${surface === "full" ? updateControlMarkup() : ""}
      </section>`;
    const toggle = root.querySelector("[data-notes-toggle]"), panel = root.querySelector("section");
    toggle.onclick = () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
    };
    return { status: panel.querySelector("[data-notes-state]"), list: panel.querySelector("ol"), refresh: panel.querySelector("[data-notes-refresh]") };
  });
  if (!views.length) return;
  if (storage === undefined) {
    try { storage = container.defaultView?.localStorage; } catch { /* Storage can be disabled by the browser. */ }
  }
  function loadSaved() {
    try { return parseReleaseFeed(storage?.getItem(STORAGE_KEY)); } catch { return null; }
  }
  const element = (tag, text) => {
    const node = container.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  let feed = loadSaved(), inFlight = null, rendered = null;
  function render(status, busy) {
    for (const view of views) {
      view.status.textContent = status;
      view.refresh.disabled = busy;
      if (rendered === feed) continue;
      view.list.replaceChildren(...(feed?.releases ?? []).map(entry => {
        const item = element("li"), header = element("header");
        header.append(element("span", entry.version));
        if (entry.version === APP_VERSION) header.append(element("strong", "当前版本"));
        else if (newerVersion(entry.version, APP_VERSION)) header.append(element("strong", "新版改动"));
        const changes = element("ul");
        changes.append(...entry.changes.map(change => element("li", change)));
        item.append(header, element("h3", entry.title), changes);
        return item;
      }));
    }
    rendered = feed;
  }
  function refresh() {
    if (inFlight) return inFlight;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    render(feed ? "正在刷新日志…" : "正在读取更新日志…", true);
    inFlight = Promise.resolve().then(async () => {
      try {
        const response = await fetchFeed(FEED_URL, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const incoming = parseReleaseFeed(await response.text());
        const saved = loadSaved();
        if (saved && saved.revision > (feed?.revision ?? 0)) feed = saved;
        if (incoming.revision < (feed?.revision ?? 0)) { render("显示较新的已保存日志", false); return; }
        if (incoming.revision > (feed?.revision ?? 0)) {
          feed = incoming;
          try { storage?.setItem(STORAGE_KEY, JSON.stringify(feed)); } catch { /* The online panel still works without storage. */ }
        }
        render("已取得云端日志", false);
      } catch {
        render(feed ? "暂时无法刷新，显示上次保存的日志" : "暂时读不到更新日志，可稍后重试", false);
      } finally {
        clearTimeout(timeout);
        inFlight = null;
      }
    });
    return inFlight;
  }
  for (const view of views) view.refresh.onclick = refresh;
  container.defaultView?.addEventListener("online", refresh);
  void refresh();
  return { refresh };
}
