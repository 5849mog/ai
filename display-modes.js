// The URL retains the display mode on refresh. Entering adds one history
// entry, so the system/browser Back action naturally returns to the full UI.
export function setupDisplayModes({ onChange, onNewGame, onOpenSettings }) {
  const controls = document.querySelector("#simpleControls"), newGame = document.querySelector("#simpleRestart");
  const color = document.querySelector("#simpleColor"), label = document.querySelector("#simpleRestartLabel");
  let simple = false, cancelled = false, pressStart, pointerId = null;
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
    if (event.button !== 0 || event.isPrimary === false || pointerId !== null) return;
    cancelled = false; pointerId = event.pointerId;
    pressStart = [event.clientX, event.clientY];
    newGame.setPointerCapture?.(event.pointerId);
  });
  newGame.addEventListener("pointermove", event => {
    if (event.pointerId === pointerId && pressStart && Math.hypot(event.clientX - pressStart[0], event.clientY - pressStart[1]) > 12) {
      cancelled = true;
    }
  });
  function release(event) {
    if (event && event.pointerId !== pointerId) return;
    pressStart = null; pointerId = null;
  }
  function cancel(event) {
    if (pointerId === null || event && event.pointerId !== pointerId) return;
    cancelled = true; release(event);
  }
  newGame.addEventListener("pointerup", release);
  newGame.addEventListener("pointercancel", cancel);
  newGame.addEventListener("lostpointercapture", cancel);
  window.addEventListener("blur", () => cancel());
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  newGame.addEventListener("click", event => {
    // Keep cancelled-touch suppression until the click or next pointerdown;
    // mobile synthetic clicks can arrive much later than 50 ms. Keyboard and
    // assistive clicks (detail 0) still work after a cancelled touch.
    if (cancelled && event.detail !== 0) { event.preventDefault(); cancelled = false; return; }
    onNewGame();
  });
  color.addEventListener("click", onOpenSettings);
  // A direct simple-mode link also gets a full-mode history entry. Refreshes
  // already carry this marker and do not add duplicate entries.
  if (fromUrl() && !history.state?.wumuSimpleEntry) {
    const original = new URL(location.href), full = new URL(original); full.searchParams.delete("view");
    history.replaceState({ ...history.state, wumuSimpleEntry: false }, "", full);
    history.pushState({ ...history.state, wumuSimpleEntry: true }, "", original);
  }
  apply(fromUrl());
  return {
    leave,
    get simple() { return simple; },
    render({ playerColor, winner, state, text, busy }) {
      label.textContent = "新局";
      if (simple) document.querySelector("#simpleLive").textContent = text;
      document.querySelector("#boardSvg").setAttribute("aria-busy", String(busy));
    }
  };
}
