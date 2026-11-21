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

function createNotesView(root) {
  const surface = root.dataset.releaseNotes, panelId = `releaseNotes-${surface}`;
  root.innerHTML = `<button type="button" data-notes-toggle data-ui-icon="guide" aria-expanded="false" aria-controls="${panelId}">最近更新</button>
    <section class="release-notes-panel" id="${panelId}" aria-labelledby="${panelId}-title" hidden>
      <header class="release-notes-top"><button type="button" data-notes-back aria-label="返回菜单">返回</button>
        <h2 id="${panelId}-title">最近更新</h2><button type="button" data-notes-refresh aria-label="刷新日志">刷新</button></header>
      <nav class="release-notes-nav" aria-label="更新日志版本" hidden>
        <button type="button" data-notes-prev aria-disabled="true">‹ 较新</button><select data-notes-version aria-label="选择版本"></select>
        <button type="button" data-notes-next aria-disabled="true">较旧 ›</button>
      </nav>
      <p class="release-notes-position" data-notes-position hidden></p>
      <div class="release-notes-body" tabindex="0" role="region" aria-label="版本内容" aria-keyshortcuts="[ ] Home End">
        <div class="release-notes-filter" hidden>
          <button type="button" data-notes-filter aria-expanded="false" aria-controls="${panelId}-filters">查找改动</button>
          <div id="${panelId}-filters" data-notes-filter-fields hidden>
            <label>版本或关键词 <input type="search" data-notes-search maxlength="80" enterkeyhint="search" autocomplete="off"></label>
            <label><input type="checkbox" data-notes-newer>只看比当前更新的版本</label>
            <output data-notes-matches></output>
            <button type="button" data-notes-clear hidden>清除筛选</button>
          </div>
        </div>
        <p data-notes-empty hidden>没有匹配的更新。可修改关键词或清除筛选。</p>
        <article class="release-note-entry" aria-live="polite" hidden></article>
        <p class="release-notes-installed">安装版本 ${APP_VERSION} <time data-notes-checked hidden></time></p>
        ${surface === "full" ? updateControlMarkup() : ""}
      </div>
      <p class="release-notes-status" data-notes-state role="status"></p>
    </section>`;
  const find = selector => root.querySelector(selector);
  const toggle = find("[data-notes-toggle]"), panel = find("section"), back = find("[data-notes-back]");
  const filterLabel = find("[data-notes-filter]"), fields = find("[data-notes-filter-fields]");
  const menu = root.closest(".record-options, .quick-tools-body");
  const owner = root.closest("#recordMenu, .simple-quick-tools") ?? menu;
  let originalScroll = 0;
  function close(restoreFocus = false) {
    if (panel.hidden) return;
    panel.hidden = true;
    delete root.dataset.notesOpen;
    toggle.setAttribute("aria-expanded", "false");
    if (menu) menu.scrollTop = originalScroll;
    if (restoreFocus) toggle.focus();
  }
  toggle.onclick = () => {
    originalScroll = menu?.scrollTop ?? 0;
    panel.hidden = false;
    root.dataset.notesOpen = "true";
    toggle.setAttribute("aria-expanded", "true");
    if (menu) menu.scrollTop = 0;
    back.focus({ preventScroll: true });
  };
  back.onclick = () => close(true);
  filterLabel.onclick = () => {
    fields.hidden = !fields.hidden;
    filterLabel.setAttribute("aria-expanded", String(!fields.hidden));
    if (!fields.hidden) find("[data-notes-search]").focus();
  };
  const Observer = root.ownerDocument.defaultView?.MutationObserver;
  if (owner && Observer) new Observer(() => {
    if (owner.hidden || owner.tagName === "DETAILS" && !owner.open) close();
  }).observe(owner, { attributes: true, attributeFilter: ["open", "hidden"] });
  return {
    toggle, panel, close, status: find("[data-notes-state]"), checked: find("[data-notes-checked]"),
    entry: find("article"), body: find(".release-notes-body"), refresh: find("[data-notes-refresh]"),
    nav: find("nav"), prev: find("[data-notes-prev]"), next: find("[data-notes-next]"), version: find("[data-notes-version]"),
    filter: find(".release-notes-filter"), filterLabel, fields,
    search: find("[data-notes-search]"), newer: find("[data-notes-newer]"),
    position: find("[data-notes-position]"), matches: find("[data-notes-matches]"),
    clear: find("[data-notes-clear]"), empty: find("[data-notes-empty]")
  };
}

export function setupReleaseNotes({ container = document, storage, fetchFeed = globalThis.fetch } = {}) {
  const views = [...container.querySelectorAll("[data-release-notes]")].map(createNotesView);
  if (!views.length) return;
  container.defaultView?.addEventListener("keydown", event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const active = views.find(view => !view.panel.hidden && view.panel.contains(container.activeElement));
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    if (active.fields.contains(container.activeElement)) {
      active.filterLabel.focus({ preventScroll: true });
      active.filterLabel.click();
      return;
    }
    active.close(true);
  }, true);
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
  let feed = loadSaved(), checked = feed ? loadChecked() : 0, inFlight = null;
  let status = "", query = "", newerOnly = false, busy = false;
  let selectedVersion = null, matches = [], position = 0, renderedMatches = "", renderedEntry = null;
  const formattedTime = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const normalized = text => text.normalize("NFKC").toLowerCase().trim();
  function render(nextStatus = status, nextBusy = busy) {
    status = nextStatus;
    busy = nextBusy;
    const words = normalized(query).split(/\s+/).filter(Boolean);
    matches = (feed?.releases ?? []).filter(entry => {
      const content = normalized([entry.version, entry.title, ...entry.changes].join(" "));
      return (!newerOnly || newerVersion(entry.version, APP_VERSION)) && words.every(word => content.includes(word));
    });
    position = Math.max(0, matches.findIndex(entry => entry.version === selectedVersion));
    const entry = matches[position], matchKey = matches.map(item => item.version).join(","), filtered = Boolean(words.length || newerOnly);
    const changedPage = renderedEntry?.version !== entry?.version;
    for (const view of views) {
      if (view.status.textContent !== status) view.status.textContent = status;
      view.refresh.setAttribute("aria-disabled", String(busy));
      view.refresh.textContent = busy ? "刷新中" : "刷新";
      view.filter.hidden = !feed;
      if (view.search.value !== query) view.search.value = query;
      view.newer.checked = newerOnly;
      view.clear.hidden = !filtered;
      view.filterLabel.textContent = filtered ? "查找改动 · 筛选中" : "查找改动";
      view.toggle.textContent = feed && newerVersion(feed.releases[0].version, APP_VERSION) ? "最近更新 · 有新版" : "最近更新";
      view.empty.hidden = !feed || matches.length > 0;
      view.nav.hidden = !entry;
      view.position.hidden = !entry;
      if (entry) view.position.textContent = `第 ${position + 1} / ${matches.length} 版`;
      view.matches.textContent = filtered ? `找到 ${matches.length} 个版本` : "";
      view.entry.hidden = !entry;
      view.checked.hidden = !checked;
      if (checked) {
        view.checked.dateTime = new Date(checked).toISOString();
        view.checked.textContent = `上次云端检查 ${formattedTime.format(checked)}`;
      }
      if (renderedMatches !== matchKey) view.version.replaceChildren(...matches.map(item => {
        const option = element("option", item.version + (item.version === APP_VERSION ? " · 当前" : ""));
        option.value = item.version;
        return option;
      }));
      if (entry) {
        view.version.value = entry.version;
        view.prev.setAttribute("aria-disabled", String(position === 0));
        view.next.setAttribute("aria-disabled", String(position === matches.length - 1));
      }
      if (changedPage && !view.fields.contains(container.activeElement)) view.body.scrollTop = 0;
      if (renderedEntry === entry) continue;
      view.entry.replaceChildren();
      if (entry) {
        const heading = element("header");
        heading.append(element("h3", entry.title));
        if (entry.version === APP_VERSION) heading.append(element("span", "当前版本"));
        else if (newerVersion(entry.version, APP_VERSION)) heading.append(element("span", "新版改动"));
        const changes = element("ul");
        changes.append(...entry.changes.map(change => element("li", change)));
        view.entry.append(heading, changes);
      }
    }
    renderedMatches = matchKey;
    renderedEntry = entry;
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
    const selectVersion = version => { selectedVersion = version === matches[0]?.version ? null : version; render(); };
    const stepVersion = offset => { const entry = matches[position + offset]; if (entry) selectVersion(entry.version); };
    view.version.onchange = () => selectVersion(view.version.value);
    view.prev.onclick = () => stepVersion(-1);
    view.next.onclick = () => stepVersion(1);
    view.body.addEventListener("keydown", event => {
      if (event.target !== view.body || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const index = event.key === "Home" ? 0 : event.key === "End" ? matches.length - 1
        : event.key === "[" ? position - 1 : event.key === "]" ? position + 1 : -1;
      if (!["Home", "End", "[", "]"].includes(event.key) || !matches.length) return;
      event.preventDefault();
      if (matches[index]) selectVersion(matches[index].version);
    });
    view.search.oninput = () => { query = view.search.value; selectedVersion = null; render(); };
    view.newer.onchange = () => { newerOnly = view.newer.checked; selectedVersion = null; render(); };
    view.clear.onclick = () => { query = ""; newerOnly = false; selectedVersion = null; render(); view.search.focus(); };
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
