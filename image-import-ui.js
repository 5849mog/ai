import { createBoardView } from "./board-view.js";
import { createRecord } from "./game-record.js";
import { validateSeed } from "./renju-rules.js";
import { boardRectangle, recognizeBoard } from "./image-board.js";

export function createImageImport(root, { getPosition, applyRecord, close }) {
  root.innerHTML = `<header class="tool-header"><h2>截图导入</h2><label class="image-picker">选择截图<input type="file" accept="image/png,image/jpeg,image/webp" /></label><button type="button" data-close>返回原局</button></header>
    <p class="tool-message" role="status">选择正视的 15 × 15 棋盘截图。图片只在本机处理。</p>
    <div class="tool-workspace"><div class="tool-board-area"><canvas class="import-image" hidden aria-label="点击棋盘左上和右下交点"></canvas><svg class="board-svg import-board" viewBox="20 20 580 580" tabindex="0" role="group" aria-label="校正识别棋盘" hidden></svg></div>
    <div class="tool-panel"><div class="calibration-actions" hidden><button type="button" data-recalibrate>重新标定</button><button type="button" data-recognize disabled>识别棋子</button></div>
      <div class="image-correction" hidden><p class="image-counts"></p><div class="tool-buttons" role="group" aria-label="校正工具"><button type="button" data-color="1" aria-pressed="true">黑棋</button><button type="button" data-color="2" aria-pressed="false">白棋</button><button type="button" data-color="0" aria-pressed="false">擦除</button><button type="button" data-undo disabled>撤回</button></div>
      <div class="tool-fields"><label>下一手棋色<select data-side><option value="1">黑棋</option><option value="2">白棋</option></select></label><label>这一手谁走<select data-actor></select></label></div>
      <p class="image-rule"></p><p>截图没有手序和换色记录。确认后作为中盘摆局续下，跳过开局交换与打点。</p>
      <button type="button" class="tool-primary" data-confirm>确认棋盘，替换当前对局</button><button type="button" data-recalibrate>返回截图标定</button></div>
    </div></div>`;
  const $ = selector => root.querySelector(selector), canvas = $("canvas"), svg = $("svg"), context = canvas.getContext("2d", { willReadFrequently: true });
  const view = createBoardView(svg, { idPrefix: "image-import-" });
  let image = null, points = [], board = new Uint8Array(225), uncertain = new Set(), tool = 1, history = [], generation = 0, active = false;
  const message = text => { $(".tool-message").textContent = text; };
  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height); if (!image) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#e44724"; context.lineWidth = Math.max(2, canvas.width / 350);
    for (const p of points) { context.beginPath(); context.arc(p.x, p.y, Math.max(5, canvas.width / 100), 0, 2 * Math.PI); context.stroke(); }
    if (points.length === 2) { const [a, b] = points; context.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); }
  }
  function renderBoard() {
    view.render({ board, lastMove: -1, pendingIndex: -1, playerColor: tool || 1, canInteract: true, editable: true, uncertain: [...uncertain] });
    $(".image-counts").textContent = `黑 ${board.filter(c => c === 1).length} · 白 ${board.filter(c => c === 2).length} · 待检查 ${uncertain.size} 点（橙框）`;
    $("[data-undo]").disabled = history.length === 0;
  }
  function calibrate() {
    points = []; svg.hidden = true; canvas.hidden = !image; $(".image-correction").hidden = true; $(".calibration-actions").hidden = !image; $("[data-recognize]").disabled = true;
    message("依次点棋盘左上角 A15、右下角 O1 的交点（不是棋盘边框）。可随时重新标定。"); draw();
  }
  async function load(file) {
    if (!file) return;
    const token = ++generation; $("[data-confirm]").disabled = true;
    try {
      if (file.size > 12 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择不超过 12 MiB 的 PNG、JPEG 或 WebP 图片");
      message("正在读取截图…");
      const bitmap = await createImageBitmap(file);
      if (!active || token !== generation) { bitmap.close(); return; }
      if (bitmap.width * bitmap.height > 40_000_000) { bitmap.close(); throw new Error("图片像素过多，请先裁剪棋盘"); }
      image?.close(); image = bitmap;
      const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      calibrate();
    } catch (error) { if (active && token === generation) message(error.message); }
    finally { if (active && token === generation) $("[data-confirm]").disabled = false; }
  }
  $("input[type=file]").onchange = event => { const file = event.target.files[0]; event.target.value = ""; void load(file); };
  function paste(event) {
    if (!active) return; const file = [...(event.clipboardData?.items ?? [])].find(item => item.type.startsWith("image/"))?.getAsFile();
    if (file) { event.preventDefault(); void load(file); }
  }
  document.addEventListener("paste", paste);
  canvas.onclick = event => {
    if (!image || points.length >= 2) return;
    const rect = canvas.getBoundingClientRect();
    points.push({ x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }); draw();
    message(points.length === 1 ? "现在点右下角 O1 的交点。" : "检查红框是否从左上交点到右下交点，再点击识别棋子。");
    $("[data-recognize]").disabled = points.length !== 2;
  };
  $("[data-recognize]").onclick = () => {
    try {
      const rectangle = boardRectangle(points[0], points[1], canvas.width, canvas.height);
      // Markers are instructions only; they must not enter recognition pixels.
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const recognized = recognizeBoard(context.getImageData(0, 0, canvas.width, canvas.height), rectangle);
      board = recognized.board; uncertain = new Set(recognized.uncertain); history = [];
      canvas.hidden = true; svg.hidden = false; $(".calibration-actions").hidden = true; $(".image-correction").hidden = false;
      message("逐点核对黑白棋，橙框优先检查。选择黑棋、白棋或擦除后点击棋盘校正；核对完成再确认。"); renderBoard();
    } catch (error) { message(error.message); draw(); }
  };
  for (const button of root.querySelectorAll("[data-recalibrate]")) button.onclick = calibrate;
  for (const button of root.querySelectorAll("[data-color]")) button.onclick = () => {
    tool = Number(button.dataset.color);
    for (const b of root.querySelectorAll("[data-color]")) b.setAttribute("aria-pressed", String(b === button)); renderBoard();
  };
  svg.onclick = event => {
    const target = event.target.closest("[data-index]"), index = target ? Number(target.dataset.index) : view.nearestIntersection(event.clientX, event.clientY);
    if (index < 0 || index >= 225) return;
    history.push({ index, color: board[index], uncertain: uncertain.has(index) }); board[index] = tool; uncertain.delete(index); renderBoard();
  };
  $("[data-undo]").onclick = () => { const saved = history.pop(); if (saved) { board[saved.index] = saved.color; if (saved.uncertain) uncertain.add(saved.index); renderBoard(); } };
  $("[data-confirm]").onclick = () => {
    try {
      validateSeed(board); const side = Number($("[data-side]").value), actor = $("[data-actor]").value, copilot = getPosition().workflow === "copilot";
      const playerColor = actor === "player" ? copilot ? 3 - side : side : copilot ? side : 3 - side;
      // Validate/apply atomically before closing; rejected imports preserve the game.
      applyRecord(createRecord([], playerColor, { board, sideToMove: side })); close();
    } catch (error) { message(`不能开始：${error.message}。请校正棋盘；当前对局保持不变。`); }
  };
  $("[data-close]").onclick = close;
  return {
    open() {
      active = true; const position = getPosition(), copilot = position.workflow === "copilot";
      board = new Uint8Array(225); uncertain = new Set(); history = []; tool = 1;
      for (const button of root.querySelectorAll("[data-color]")) button.setAttribute("aria-pressed", String(button.dataset.color === "1"));
      $("[data-side]").value = String(position.currentColor || 1);
      $("[data-actor]").replaceChildren(...["player", "ai"].map((value, i) => { const option = document.createElement("option"); option.value = value; option.textContent = copilot ? ["录入对手棋", "AI 替我落子"][i] : ["我来走", "AI 来走"][i]; return option; }));
      $("[data-actor]").value = position.playerColor && position.currentColor === position.playerColor ? copilot ? "ai" : "player" : copilot ? "player" : "ai";
      $(".image-rule").textContent = `续局规则：${position.ruleLabel ?? "无禁手"}。下一手棋色和行棋方由你确定。`;
      svg.hidden = true; canvas.hidden = true; $(".image-correction").hidden = $(".calibration-actions").hidden = true;
      message("选择截图或粘贴图片。图片只在本机处理，请使用正视的 15 × 15 棋盘。");
    },
    dispose() { active = false; generation++; image?.close(); image = null; points = []; canvas.width = canvas.height = 1; history = []; }
  };
}
