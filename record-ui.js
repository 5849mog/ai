import { createBoardView } from "./board-view.js";
import { MAX_RECORD_BYTES, createRecord, replayRecord, parseRecord, serializeRecord, exportSgf } from "./game-record.js";

export function setupRecordUi({ getRecord, applyRecord, notify, onModalChange }) {
  const menu = document.querySelector("#recordMenu"), fileInput = document.querySelector("#recordFile");
  const dialog = document.querySelector("#recordDialog"), color = document.querySelector("#importColor");
  const preview = createBoardView(document.querySelector("#recordPreview"), { idPrefix: "preview-" });
  let pending, readSerial = 0;
  function download(format) {
    const record = getRecord();
    const text = format === "sgf" ? exportSgf(record) : serializeRecord(record);
    const blob = new Blob([text], { type: format === "sgf" ? "application/x-go-sgf;charset=utf-8" : "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `wumu-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}.${format === "sgf" ? "sgf" : "gomoku.json"}`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    menu.open = false; notify("棋谱已导出");
  }
  document.querySelector("#exportJson").addEventListener("click", () => download("json"));
  document.querySelector("#exportSgf").addEventListener("click", () => download("sgf"));
  document.querySelector("#importRecord").addEventListener("click", () => { menu.open = false; fileInput.value = ""; fileInput.click(); });
  document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener("keydown", event => { if (event.key === "Escape") menu.open = false; });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0], serial = ++readSerial;
    if (!file) return;
    try {
      if (file.size > MAX_RECORD_BYTES) throw new Error("棋谱文件过大，最多支持 1 MiB");
      const parsed = parseRecord(await file.text(), getRecord().playerColor);
      if (serial !== readSerial) return;
      pending = parsed.record;
      const game = replayRecord(pending);
      color.value = String(pending.playerColor);
      preview.render({ board: game.board, lastMove: game.lastMove, pendingIndex: -1, hoverIndex: -1, canInteract: false });
      const result = game.winner === 3 ? "平局" : game.winner ? `${game.winner === 1 ? "黑" : "白"}方已成五` : `${game.currentColor === 1 ? "黑" : "白"}方待走`;
      document.querySelector("#importSummary").textContent = pending.setup
        ? `自定义局面 · ${pending.setup.board.filter(Boolean).length} 子 · 续下 ${pending.moves.length} 手 · ${result}`
        : `${parsed.type}棋谱 · ${pending.moves.length} 手 · ${result}`;
      document.querySelector("#importNotices").textContent = parsed.notices.join(" ");
      dialog.showModal(); onModalChange(true);
    } catch (error) { if (serial === readSerial) notify(error.message, true); }
  });
  document.querySelector("#cancelImport").addEventListener("click", () => dialog.close());
  document.querySelector("#confirmImport").addEventListener("click", () => {
    if (!pending) return;
    try {
      const saved = applyRecord(createRecord(pending.moves, Number(color.value), pending.setup));
      dialog.close();
      notify(saved ? "棋谱已导入" : "棋谱已导入，但此局暂未保存；关闭前请导出棋谱", !saved);
    } catch (error) { notify(error.message, true); }
  });
  dialog.addEventListener("close", () => { pending = null; onModalChange(false); menu.querySelector("summary").focus(); });
}
