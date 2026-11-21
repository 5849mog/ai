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
  const summary = make("span", "match-inspector-summary");
  const row = make("div", "match-inspector-row");
  const settings = make("div", "match-inspector-settings");
  const heading = make("header", "match-inspector-header");
  panel.id = "matchInspector";
  panel.setAttribute("aria-label", "局势与对局设置");
  open.type = close.type = "button";
  open.textContent = "局势与设置";
  close.textContent = "返回棋盘";
  heading.append(close);
  row.append(summary, open);
  panel.append(heading, settings);
  open.setAttribute("aria-controls", panel.id);
  open.setAttribute("aria-expanded", "false");
  scrim.hidden = panel.hidden = row.hidden = true;
  sidebar.append(row, scrim, panel);

  const movable = [...sidebar.querySelectorAll(".game-settings > label, .spectator-controls, .spectator-settings, .engine-analysis")].map(node => {
    const anchor = doc.createComment("compact inspector");
    return { node, anchor, destination: node.matches(".engine-analysis") ? panel : settings };
  });
  let compact = false;
  function fit() {
    if (panel.hidden) return;
    const offset = viewport.visualViewport?.offsetTop ?? 0;
    panel.style.maxHeight = `${Math.max(112, sidebar.getBoundingClientRect().top - offset - 16)}px`;
  }
  function dismiss(restore = true) {
    if (panel.hidden) return;
    panel.hidden = scrim.hidden = true;
    open.setAttribute("aria-expanded", "false");
    if (restore) open.focus({ preventScroll: true });
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
    if (!next && row.contains(focused)) doc.querySelector("#boardSvg")?.focus({ preventScroll: true });
  }
  open.onclick = () => {
    if (!panel.hidden) { dismiss(); return; }
    panel.hidden = scrim.hidden = false;
    open.setAttribute("aria-expanded", "true");
    fit();
    close.focus({ preventScroll: true });
  };
  close.onclick = () => dismiss();
  scrim.onclick = () => dismiss();
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
