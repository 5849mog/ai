// The URL retains the display mode on refresh. Entering adds one history
// entry, so the system/browser Back action naturally returns to the full UI.
export function setupDisplayModes({ onChange, onNewGame, onToggleColor }) {
  const controls = document.querySelector("#simpleControls"), newGame = document.querySelector("#simpleRestart");
  const color = document.querySelector("#simpleColor"), label = document.querySelector("#simpleRestartLabel");
  let simple = false, holdTimer, held = false, releaseTimer, pressStart;
  const fromUrl = () => new URL(location.href).searchParams.get("view") === "simple";
  function apply(value) {
    if (value === simple && controls.hidden === !value) return;
    simple = value;
    document.body.classList.toggle("simple-mode", simple); controls.hidden = !simple;
    document.documentElement.classList.toggle("simple-view", simple);
    document.querySelector("#boardSvg").setAttribute("viewBox", simple ? "30 30 560 560" : "20 20 580 580");
    onChange(simple);
  }
  function leave() {
    if (!simple) return;
    if (history.state?.wumuSimpleEntry) history.back();
    else {
      const url = new URL(location.href); url.searchParams.delete("view");
      history.replaceState({ ...history.state, wumuSimpleEntry: false }, "", url);
      apply(false);
    }
  }
  document.querySelector("#enterSimpleMode").addEventListener("click", () => {
    document.querySelector("#recordMenu").open = false;
    const url = new URL(location.href); url.searchParams.set("view", "simple");
    history.pushState({ ...history.state, wumuSimpleEntry: true }, "", url); apply(true);
  });
  window.addEventListener("popstate", () => apply(fromUrl()));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && simple && !document.querySelector("dialog[open]")) { event.preventDefault(); leave(); }
  });
  newGame.addEventListener("contextmenu", event => event.preventDefault());
  newGame.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    clearTimeout(holdTimer); clearTimeout(releaseTimer); held = false;
    pressStart = [event.clientX, event.clientY];
    newGame.setPointerCapture(event.pointerId);
    holdTimer = setTimeout(() => { held = true; leave(); }, 700);
  });
  newGame.addEventListener("pointermove", event => {
    if (pressStart && Math.hypot(event.clientX - pressStart[0], event.clientY - pressStart[1]) > 12) {
      clearTimeout(holdTimer); held = true;
    }
  });
  function release() { clearTimeout(holdTimer); pressStart = null; releaseTimer = setTimeout(() => { held = false; }, 50); }
  newGame.addEventListener("pointerup", release);
  newGame.addEventListener("pointercancel", release);
  window.addEventListener("blur", release);
  newGame.addEventListener("click", event => {
    if (held) { event.preventDefault(); held = false; return; }
    onNewGame();
  });
  color.addEventListener("click", onToggleColor);
  // A direct simple-mode link also gets a full-mode history entry. Refreshes
  // already carry this marker and do not add duplicate entries.
  if (fromUrl() && !history.state?.wumuSimpleEntry) {
    const original = new URL(location.href), full = new URL(original); full.searchParams.delete("view");
    history.replaceState({ ...history.state, wumuSimpleEntry: false }, "", full);
    history.pushState({ ...history.state, wumuSimpleEntry: true }, "", original);
  }
  apply(fromUrl());
  return {
    get simple() { return simple; },
    render({ playerColor, winner, state, text, busy }) {
      const playerBlack = playerColor === 1;
      document.querySelector("#simpleColorLabel").textContent = playerBlack ? "你执黑" : "AI 执黑";
      color.setAttribute("aria-pressed", String(playerBlack));
      color.setAttribute("aria-label", `当前${playerBlack ? "你执黑" : "AI 执黑"}，点击切换并开始新局`);
      label.textContent = winner ? `${winner === 3 ? "平局" : winner === playerColor ? "你赢了" : "AI 赢了"} · 新局`
        : state === "error" ? "重试 · 新局" : "新局";
      if (simple) document.querySelector("#simpleLive").textContent = text;
      document.querySelector("#boardSvg").setAttribute("aria-busy", String(busy));
    }
  };
}
