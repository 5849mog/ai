const COMPACT = "(orientation: portrait) and (max-width: 600px) and (max-height: 800px), (orientation: portrait) and (min-width: 700px) and (max-width: 1024px) and (max-height: 1300px)";

export function setupMatchInspector(doc = document) {
  const viewport = doc.defaultView;
  const media = viewport?.matchMedia?.(COMPACT);
  if (!media) return null;
  const sidebar = doc.querySelector(".game-sidebar");
  const make = (name, css) => Object.assign(doc.createElement(name), { className: css });
  const scrim = make("div", "match-inspector-scrim");
  const panel = make("section", "match-inspector");
  const open = make("button", "match-inspector-trigger");
  const close = make("button", "match-inspector-close");
  const title = make("h2", "match-inspector-title");
  const summary = make("span", "match-inspector-summary");
  const row = make("div", "match-inspector-row");
  const settings = make("div", "match-inspector-settings");
  const analysis = make("div", "match-inspector-analysis");
  const tabs = make("div", "match-inspector-tabs");
  const showAnalysis = make("button", "match-inspector-tab");
  const showSettings = make("button", "match-inspector-tab");
  const heading = make("header", "match-inspector-header");
  panel.id = "matchInspector";
  panel.setAttribute("aria-label", "局势与对局设置");
  open.type = close.type = "button";
  open.textContent = "局势与设置";
  close.textContent = "返回棋盘";
  title.textContent = "局势与设置";
  showAnalysis.textContent = "看局势";
  showSettings.textContent = "调设置";
  showAnalysis.type = showSettings.type = "button";
  analysis.id = "compactAnalysis";
  settings.id = "compactMatchSettings";
  showAnalysis.setAttribute("aria-controls", analysis.id);
  showSettings.setAttribute("aria-controls", settings.id);
  tabs.append(showAnalysis, showSettings);
  heading.append(title, close, tabs);
  row.append(summary, open);
  panel.append(heading, analysis, settings);
  open.setAttribute("aria-controls", panel.id);
  open.setAttribute("aria-expanded", "false");
  scrim.hidden = panel.hidden = row.hidden = true;
  sidebar.append(row, scrim, panel);

  const movable = [...sidebar.querySelectorAll(".game-settings > label, .spectator-controls, .spectator-settings, .engine-analysis")].map(node => {
    const anchor = doc.createComment("compact inspector");
    return { node, anchor, destination: node.matches(".engine-analysis") ? analysis : settings };
  });
  let compact = false;
  function fit() {
    if (panel.hidden) return;
    const offset = viewport.visualViewport?.offsetTop ?? 0;
    const height = `${Math.max(112, Math.floor(sidebar.getBoundingClientRect().top - offset - 16))}px`;
    if (panel.style.maxHeight !== height) panel.style.maxHeight = height;
  }
  function dismiss(restore = true) {
    if (panel.hidden) return;
    panel.hidden = scrim.hidden = true;
    open.setAttribute("aria-expanded", "false");
    if (restore) open.focus({ preventScroll: true });
  }
  function select(showOptions) {
    settings.hidden = !showOptions;
    analysis.hidden = showOptions;
    showAnalysis.setAttribute("aria-pressed", String(!showOptions));
    showSettings.setAttribute("aria-pressed", String(showOptions));
    panel.scrollTop = 0;
  }
  function layout() {
    const next = media.matches && !doc.body.classList.contains("simple-mode");
    if (next === compact) return;
    const focused = doc.activeElement;
    dismiss(false);
    compact = next;
    row.hidden = !compact;
    sidebar.toggleAttribute("data-compact", compact);
    for (const { node, anchor, destination } of movable) {
      if (compact) { node.before(anchor); destination.append(node); }
      else anchor.replaceWith(node);
    }
    if (next && movable.some(({ node }) => node.contains(focused))) open.focus({ preventScroll: true });
    if (!next && (row.contains(focused) || panel.contains(focused))) {
      const nextFocus = !doc.body.classList.contains("simple-mode") && movable.find(({node}) => node.contains(focused));
      (nextFocus ? focused : doc.querySelector("#boardSvg"))?.focus({ preventScroll: true });
    }
  }
  open.onclick = () => {
    if (!panel.hidden) { dismiss(); return; }
    select(false);
    panel.hidden = scrim.hidden = false;
    open.setAttribute("aria-expanded", "true");
    fit();
    close.focus({ preventScroll: true });
  };
  close.onclick = () => dismiss();
  scrim.onclick = () => dismiss();
  showAnalysis.onclick = () => select(false);
  showSettings.onclick = () => select(true);
  media.addEventListener?.("change", layout);
  viewport.addEventListener("resize", fit);
  viewport.visualViewport?.addEventListener("resize", fit);
  layout();
  return { layout, dismiss, render(text, tone = "") {
    if (summary.textContent !== text) summary.textContent = text;
    if (summary.dataset.tone !== tone) summary.dataset.tone = tone;
    fit();
  } };
}
