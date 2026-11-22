import { THINKING_OPTIONS } from "./thinking-options.js";
import { updateControlMarkup } from "./app-update.js";

const PAGES = [["game", "对局"], ["board", "棋盘"], ["tools", "工具"]];
const TRACK = '<span class="quick-switch-track" aria-hidden="true"></span>';

export function createQuickSettings(document, status) {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "更多";
  toggle.dataset.uiIcon = "settings";
  toggle.dataset.quickTrigger = "";
  toggle.setAttribute("aria-label", "更多对局设置");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "simpleQuickTools");
  const scrim = document.createElement("div");
  scrim.className = "quick-tools-scrim";
  scrim.hidden = true;
  scrim.setAttribute("aria-hidden", "true");
  status.before(scrim);
  const panel = document.createElement("section");
  panel.id = "simpleQuickTools";
  panel.className = "simple-quick-tools";
  panel.setAttribute("aria-labelledby", "quickToolsTitle");
  panel.hidden = true;
  status.append(toggle, panel);

  panel.innerHTML = `<header class="quick-tools-header">
      <h2 id="quickToolsTitle" data-ui-icon="settings">快捷设置</h2>
      <button type="button" data-collapse aria-label="收起快捷设置">关闭</button>
    </header>
    <div class="quick-tabs" role="tablist" aria-label="快捷设置分类">
      ${PAGES.map(([key, label], index) => `<button type="button" role="tab" id="quick-tab-${key}" data-quick-tab="${key}" aria-controls="quick-page-${key}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`).join("")}
    </div>
    <div class="quick-tools-body">
      <section class="quick-page" id="quick-page-game" role="tabpanel" aria-labelledby="quick-tab-game">
        <div class="quick-game-layout">
          <section class="quick-timing" aria-labelledby="quickTimeTitle">
            <div class="quick-section-heading"><h3 id="quickTimeTitle">每步思考</h3><span>自动落子</span></div>
            <div class="quick-time-grid" role="radiogroup" aria-labelledby="quickTimeTitle" aria-describedby="quickTimeNote">
              ${THINKING_OPTIONS.map(([value, label]) => `<button type="button" data-time="${value}" role="radio" aria-checked="false">${value === "adaptive" ? '<span>自适应深思</span><small>按局势分配 0–6 秒</small>' : label}</button>`).join("")}
            </div>
            <p id="quickTimeNote">推荐落点固定搜索 1 秒</p>
          </section>
          <div class="quick-game-controls">
            <label class="quick-perspective" data-quick-perspective hidden>分析视角
              <select aria-label="分析视角"><option value="1">看黑棋</option><option value="2">看白棋</option></select>
            </label>
            <div class="quick-switches" role="group" aria-label="对局辅助">
              <button class="quick-switch" type="button" data-hints data-ui-icon="eye" role="switch" aria-checked="true">棋盘提示${TRACK}</button>
              <button class="quick-switch" type="button" data-ponder data-ui-icon="engine" role="switch" aria-checked="true">后台思考${TRACK}</button>
              <button class="quick-switch" type="button" data-sound data-ui-icon="audio" role="switch" aria-checked="false">落子音效${TRACK}</button>
            </div>
            <button class="quick-takeover" type="button" data-takeover data-ui-icon="bot" aria-pressed="false" hidden>AI 接管我方</button>
          </div>
        </div>
        <div data-quick-spectator></div>
      </section>
      <section class="quick-page" id="quick-page-board" role="tabpanel" aria-labelledby="quick-tab-board" hidden>
        <div data-board-appearance="inline"></div>
        <div data-board-facts></div>
      </section>
      <section class="quick-page quick-page-tools" id="quick-page-tools" role="tabpanel" aria-labelledby="quick-tab-tools" hidden>
        <div class="quick-tools-actions" aria-label="棋局工具">
          <button type="button" data-image data-ui-icon="camera">截图导入</button>
          <button type="button" data-quick-share data-ui-icon="export">分享棋局</button>
          <button type="button" data-quick-import data-ui-icon="import">导入棋谱</button>
          <button type="button" data-quick-setup data-ui-icon="board">自定义摆局</button>
          <button type="button" data-quick-save data-ui-icon="export">保存棋盘图</button>
          <button type="button" data-copy-board data-ui-icon="copy">复制棋盘图</button>
          <button type="button" data-archive data-ui-icon="guide">最近对局</button>
        </div>
        <div class="quick-tools-links">
          <button type="button" data-quick-copy="sgf" data-ui-icon="copy">复制 SGF</button>
          <button type="button" data-quick-copy="json" data-ui-icon="copy">复制五目棋谱</button>
          <button type="button" data-remote-menu data-ui-icon="engine">电脑引擎</button>
          <button type="button" data-full-view data-ui-icon="layout">完整界面</button>
        </div>
        <div data-release-notes="simple"></div>
        ${updateControlMarkup()}
      </section>
    </div>`;

  const closeButton = panel.querySelector("[data-collapse]");
  const scrollArea = panel.querySelector(".quick-tools-body");
  const tabList = panel.querySelector(".quick-tabs");
  const tabs = [...panel.querySelectorAll("[data-quick-tab]")];
  const pages = PAGES.map(([key]) => panel.querySelector(`#quick-page-${key}`));
  const scroll = PAGES.map(() => 0);
  const window = document.defaultView;
  let selected = 0, opened = false, animation;
  function fit() {
    if (!opened) return;
    const viewport = window?.visualViewport;
    const top = viewport?.offsetTop ?? 0, bottom = top + (viewport?.height ?? window?.innerHeight ?? Infinity);
    const anchor = status.getBoundingClientRect().top, lift = Math.max(0, anchor - bottom);
    panel.style.setProperty("--quick-lift", `${lift}px`);
    panel.style.setProperty("--quick-room", `${Math.max(0, anchor - lift - top - 18)}px`);
  }
  function switchTab(index, focus = false) {
    if (index !== selected) {
      scroll[selected] = scrollArea.scrollTop;
      selected = index;
      tabList.style.setProperty("--quick-tab", index);
      for (let i = 0; i < tabs.length; i++) {
        const active = i === index;
        tabs[i].setAttribute("aria-selected", String(active));
        tabs[i].tabIndex = active ? 0 : -1;
        pages[i].hidden = !active;
      }
      scrollArea.scrollTop = scroll[index];
    }
    if (focus) tabs[index].focus({ preventScroll: true });
  }
  for (const [index, tab] of tabs.entries()) {
    tab.onclick = () => switchTab(index);
    tab.onkeydown = event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      let next;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else return;
      event.preventDefault();
      switchTab(next, true);
    };
  }
  const rest = { opacity: 1, transform: "none" };
  const tucked = { opacity: 0, transform: "translateY(8px) scale(.985)" };
  function animate(from, to, timing) {
    if (!panel.animate || window?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    return panel.animate([from, to], timing);
  }
  function show() {
    animation?.cancel();
    animation = null;
    opened = true;
    status.dataset.quickOpen = "";
    panel.hidden = scrim.hidden = false;
    panel.inert = false;
    toggle.setAttribute("aria-expanded", "true");
    scrollArea.scrollTop = scroll[selected];
    fit();
    animation = animate(tucked, rest, { duration: 220, easing: "cubic-bezier(.2,.8,.25,1)" });
    closeButton.focus({ preventScroll: true });
  }
  function close({ restoreFocus = true, immediate = false } = {}) {
    if (!opened && (panel.hidden || !immediate)) return;
    const focusedInside = Boolean(document.activeElement && panel.contains(document.activeElement));
    if (opened) scroll[selected] = scrollArea.scrollTop;
    opened = false;
    delete status.dataset.quickOpen;
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus && focusedInside) toggle.focus({ preventScroll: true });
    scrim.hidden = true;
    panel.inert = true;
    animation?.cancel();
    const closing = animation = immediate ? null : animate(rest, tucked, { duration: 145, easing: "cubic-bezier(.35,0,.8,.35)", fill: "forwards" });
    if (!closing) panel.hidden = true;
    else closing.finished.then(() => {
      if (animation !== closing || opened) return;
      panel.hidden = true;
      closing.cancel();
      animation = null;
    }).catch(() => {});
  }
  toggle.onclick = () => opened ? close() : show();
  closeButton.onclick = () => close();
  scrim.onclick = () => close();
  panel.addEventListener("focusout", event => {
    if (opened && event.relatedTarget && event.relatedTarget !== toggle && !panel.contains(event.relatedTarget)) close({ restoreFocus: false });
  });
  panel.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "PageUp" && event.key !== "PageDown") return;
    if (!event.target.closest(".quick-tabs, .quick-tools-header")) return;
    event.preventDefault();
    scrollArea.scrollBy({ top: (event.key === "PageDown" ? 1 : -1) * scrollArea.clientHeight });
  });
  window?.addEventListener("resize", fit);
  window?.visualViewport?.addEventListener("resize", fit);
  window?.visualViewport?.addEventListener("scroll", fit);
  return { panel, toggle, close, fit, get opened() { return opened; } };
}
