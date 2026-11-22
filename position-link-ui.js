import { createBoardView } from "./board-view.js";
import { coordinate, RULES } from "./opening-session.js";
import { decodePositionLink, encodePositionLink } from "./position-link.js";

export function setupPositionLinks({ getRecord, onModal, onLoad, notify }) {
  const root = document.createElement("div");
  root.innerHTML = `<dialog class="record-dialog position-link-dialog" aria-labelledby="positionLinkTitle">
    <h2 id="positionLinkTitle"></h2>
    <div class="record-preview-frame"><svg viewBox="20 20 580 580" class="board-svg" role="img" aria-label="共享棋盘预览"></svg></div>
    <p class="position-link-context"></p>
    <label class="position-link-field" hidden>棋局链接<input type="url" readonly></label>
    <div class="dialog-actions"><button type="button" data-dismiss>关闭</button><button type="button" class="confirm-import" data-proceed></button></div>
  </dialog>`;
  document.body.append(root);
  const dialog = root.querySelector("dialog"), preview = root.querySelector("svg");
  const view = createBoardView(preview, { idPrefix: "position-link-" });
  const title = root.querySelector("h2"), caption = root.querySelector(".position-link-context");
  const field = root.querySelector("label"), input = field.querySelector("input");
  const cancel = root.querySelector("[data-dismiss]"), proceed = root.querySelector("[data-proceed]");
  const menu = document.querySelector("#recordMenu");
  let incoming, restoreFocus;
  function clearLink() {
    if (!location.hash.startsWith("#position=")) return;
    const url = new URL(location.href);
    url.hash = "";
    history.replaceState(history.state, "", url);
  }
  function show(session) {
    view.render({ board: session.board, lastMove: session.lastMove, canInteract: false, editable: Boolean(session.forbidden), pendingIndex: -1 });
    // Proposals are still editable choices, so their positions are also shown
    // in text when a formal opening is shared halfway through.
    const proposed = session.candidates.length ? ` · 候选 ${session.candidates.map(coordinate).join("、")}` : "";
    caption.textContent = `${RULES[session.rule]} · ${session.moves.length} 手${proposed} · ${session.description()}`;
    title.textContent = incoming ? "收到一盘棋" : "分享当前棋局";
    cancel.textContent = incoming ? "保留本局" : "返回棋盘";
    proceed.textContent = incoming ? "载入这盘棋" : "复制链接";
    field.hidden = Boolean(incoming);
    onModal(true);
    dialog.showModal();
  }
  function showSharedPosition() {
    if (document.querySelector("dialog[open]")) return;
    try {
      incoming = decodePositionLink(location.hash);
      if (incoming) { restoreFocus = document.querySelector("#boardSvg"); show(incoming); }
    } catch {
      incoming = null;
      clearLink();
      notify("棋局链接不完整或无效，已保留本局", true);
    }
  }
  cancel.onclick = () => dialog.close();
  proceed.onclick = async () => {
    if (incoming) {
      try { onLoad(incoming.record()); dialog.close(); }
      catch { notify("无法载入共享棋局，已保留本局", true); }
      return;
    }
    try { await navigator.clipboard.writeText(input.value); notify("棋局链接已复制"); dialog.close(); }
    catch { input.focus(); input.select(); notify("已选中链接，可直接复制"); }
  };
  dialog.addEventListener("close", () => {
    if (incoming) clearLink();
    incoming = null;
    onModal(false);
    restoreFocus?.focus({ preventScroll: true });
  });
  window.addEventListener("hashchange", showSharedPosition);
  return {
    showSharedPosition,
    share(trigger) {
      if (dialog.open) return;
      const record = getRecord(), url = encodePositionLink(record, location.href);
      input.value = url.href;
      restoreFocus = trigger;
      if (menu) menu.open = false;
      show(decodePositionLink(url.hash));
    }
  };
}
