import { createBoardView } from "./board-view.js";
import { MAX_RECORD_BYTES, createRecord } from "./game-record.js";
import { sessionFromRecord, parseSessionRecord, sessionSgf } from "./session-records.js";
import { RULES } from "./opening-session.js";

export function setupRecordUi({ getRecord, applyRecord, notify, onModalChange }) {
  const $ = selector => document.querySelector(selector), menu = $("#recordMenu"), fileInput = $("#recordFile");
  const dialog = $("#recordDialog"), color = $("#importColor"), preview = createBoardView($("#recordPreview"), { idPrefix: "preview-" });
  let pending, readSerial = 0;
  function download(format) {
    const record = sessionFromRecord(getRecord()).record();
    const text = format === "sgf" ? sessionSgf(record) : JSON.stringify(record, null, 2) + "\n";
    const blob = new Blob([text], { type: format === "sgf" ? "application/x-go-sgf;charset=utf-8" : "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `wumu-${Date.now()}.${format === "sgf" ? "sgf" : "gomoku.json"}`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    menu.open = false; notify("棋谱已导出");
  }
  $("#exportJson").onclick = () => download("json"); $("#exportSgf").onclick = () => download("sgf");
  $("#importRecord").onclick = () => { menu.open = false; fileInput.value = ""; fileInput.click(); };
  document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener("keydown", event => { if (event.key === "Escape") menu.open = false; });
  fileInput.onchange = async () => {
    const file = fileInput.files[0], serial = ++readSerial; if (!file) return;
    try {
      if (file.size > MAX_RECORD_BYTES) throw Error("棋谱文件过大，最多支持 1 MiB");
      const parsed = parseSessionRecord(await file.text(), sessionFromRecord(getRecord()).playerColor || 1);
      if (serial !== readSerial) return; pending = parsed;
      const game = parsed.session;
      color.parentElement.hidden = !parsed.legacy; color.value = String(game.playerColor || 1);
      preview.render({ board: game.board, lastMove: game.lastMove, pendingIndex: -1, hoverIndex: -1, canInteract: false });
      $("#importSummary").textContent = `${RULES[game.rule]} · ${game.moves.length} 手 · ${game.description()}`;
      $("#importNotices").textContent = parsed.notices.join(" ");
      onModalChange(true); dialog.showModal();
    } catch (error) { if (serial === readSerial) notify(error.message, true); }
  };
  $("#cancelImport").onclick = () => dialog.close();
  $("#confirmImport").onclick = () => {
    if (!pending) return;
    try {
      const record = pending.legacy ? sessionFromRecord(createRecord(pending.legacy.moves, Number(color.value), pending.legacy.setup)).record() : pending.session.record();
      const saved = applyRecord(record); dialog.close();
      notify(saved ? "棋谱已导入" : "棋谱已导入，但此局暂未保存；关闭前请导出棋谱", !saved);
    } catch (error) { notify(error.message, true); }
  };
  dialog.addEventListener("close", () => { pending = null; onModalChange(false); menu.querySelector("summary").focus(); });
}
