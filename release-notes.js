import { APP_VERSION } from "./app-release.js";
import { isAppVersion, newerVersion, updateControlMarkup } from "./app-update.js";

const FEED_URL = new URL("./content/feed.json", import.meta.url);
const STORAGE_KEY = `gomoku-release-notes:${FEED_URL.pathname}:v1`;
const CHECKED_KEY = `${STORAGE_KEY}:checked`;
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
        <p class="release-notes-installed">当前版本 ${APP_VERSION} <time data-notes-checked hidden></time></p>
        <div class="release-notes-filter"><label>查找改动 <input type="search" data-notes-search maxlength="80" placeholder="版本或关键词"></label>
        <label><input type="checkbox" data-notes-newer>只看比当前更新的版本</label></div>
        <p data-notes-empty hidden>没有匹配的更新。</p>
        <ol class="release-note-list"></ol>
        ${surface === "full" ? updateControlMarkup() : ""}
      </section>`;
    const toggle = root.querySelector("[data-notes-toggle]"), panel = root.querySelector("section");
    toggle.onclick = () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
    };
    return {
      toggle, status: panel.querySelector("[data-notes-state]"), checked: panel.querySelector("[data-notes-checked]"),
      list: panel.querySelector("ol"), refresh: panel.querySelector("[data-notes-refresh]"),
      search: panel.querySelector("[data-notes-search]"), newer: panel.querySelector("[data-notes-newer]"),
      empty: panel.querySelector("[data-notes-empty]")
    };
  });
  if (!views.length) return;
  if (storage === undefined) {
    try { storage = container.defaultView?.localStorage; } catch { /* Storage can be disabled by the browser. */ }
  }
  function loadChecked() {
    try {
      const saved = Number(storage?.getItem(CHECKED_KEY));
      if (Number.isFinite(saved) && saved > 0 && saved <= Date.now()) return saved;
    } catch { /* Saved timestamps are optional. */ }
    return 0;
  }
  function loadSaved() {
    try { return parseReleaseFeed(storage?.getItem(STORAGE_KEY)); } catch { return null; }
  }
  const element = (tag, text) => {
    const node = container.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  let feed = loadSaved(), checked = feed ? loadChecked() : 0, inFlight = null, rendered = null;
  let status = "", query = "", newerOnly = false, busy = false;
  const formattedTime = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function render(nextStatus = status, nextBusy = busy) {
    status = nextStatus;
    busy = nextBusy;
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const items = (feed?.releases ?? []).filter(entry => {
      const content = [entry.version, entry.title, ...entry.changes].join(" ").toLowerCase();
      return (!newerOnly || newerVersion(entry.version, APP_VERSION)) && words.every(word => content.includes(word));
    });
    const signature = JSON.stringify([feed?.revision, query, newerOnly]);
    for (const view of views) {
      if (view.status.textContent !== status) view.status.textContent = status;
      view.refresh.disabled = busy;
      view.search.disabled = view.newer.disabled = !feed;
      if (view.search.value !== query) view.search.value = query;
      view.newer.checked = newerOnly;
      view.toggle.textContent = feed && newerVersion(feed.releases[0].version, APP_VERSION) ? "最近更新 · 有新版" : "最近更新";
      view.empty.hidden = !feed || items.length > 0;
      view.checked.hidden = !checked;
      if (checked) {
        view.checked.dateTime = new Date(checked).toISOString();
        view.checked.textContent = `上次云端检查 ${formattedTime.format(checked)}`;
      }
      if (rendered === signature) continue;
      view.list.replaceChildren(...items.map(entry => {
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
    rendered = signature;
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
        checked = Date.now();
        try { storage?.setItem(CHECKED_KEY, String(checked)); } catch { /* Keep the time for this page. */ }
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
  for (const view of views) {
    view.refresh.onclick = refresh;
    view.search.oninput = () => { query = view.search.value; render(); };
    view.newer.onchange = () => { newerOnly = view.newer.checked; render(); };
  }
  container.defaultView?.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY && event.key !== CHECKED_KEY) return;
    const saved = loadSaved();
    if (!saved || saved.revision < (feed?.revision ?? 0)) return;
    if (saved.revision > (feed?.revision ?? 0)) feed = saved;
    checked = Math.max(checked, loadChecked());
    render(busy ? status : "显示已保存的日志");
  });
  container.defaultView?.addEventListener("online", refresh);
  void refresh();
  return { refresh };
}
