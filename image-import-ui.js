import { createBoardView } from "./board-view.js";
import { createRecord } from "./game-record.js";
import { validateSeed } from "./renju-rules.js";
import { boardRectangle, recognizeBoard } from "./image-board.js";
import { updateControlMarkup } from "./app-update.js";

// Some mobile WebViews lack ImageBitmap or reject images that <img> can decode.
export async function decodeScreenshot(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch { /* try the image decoder */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = () => reject(new Error("无法读取这张图片，请重新保存为 PNG 或 JPEG")); image.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight, source: image, close() {} };
  } finally { URL.revokeObjectURL(url); }
}

export function createImageImport(root, { getPosition, applyRecord, close }) {
  root.innerHTML = `<header class="tool-header"><h2>截图导入</h2><label class="image-picker">选择截图<input type="file" accept="image/png,image/jpeg,image/webp" /></label><button type="button" data-close>返回原局</button></header>
    ${updateControlMarkup()}
    <p class="tool-message" role="status">选择正视的 15 × 15 棋盘截图。图片只在本机处理。</p>
    <div class="tool-workspace"><div class="tool-board-area"><canvas class="import-image" hidden aria-label="拖动框内区域移动，拖动四角把手调整识别范围"></canvas><canvas class="import-loupe" width="144" height="144" hidden aria-label="选框角点放大预览"></canvas><svg class="board-svg import-board" width="580" height="580" viewBox="20 20 580 580" preserveAspectRatio="xMidYMid meet" tabindex="0" role="group" aria-label="校正识别棋盘" hidden></svg></div>
    <div class="tool-panel"><div class="calibration-actions" hidden><button type="button" data-reset-frame>重置选框</button><button type="button" data-grid aria-pressed="true">网格参考：开</button><button type="button" data-recognize disabled>识别棋子</button></div>
      <div class="image-correction" hidden><p class="image-counts"></p><div class="tool-buttons" role="group" aria-label="校正工具"><button type="button" data-color="1" aria-pressed="true">黑棋</button><button type="button" data-color="2" aria-pressed="false">白棋</button><button type="button" data-color="0" aria-pressed="false">擦除</button><button type="button" data-undo disabled>撤回</button></div>
      <div class="tool-fields"><label>下一手棋色<select data-side><option value="1">黑棋</option><option value="2">白棋</option></select></label><label>这一手谁走<select data-actor></select></label></div>
      <p class="image-rule"></p><p>截图没有手序和换色记录。确认后作为中盘摆局续下，跳过开局交换与打点。</p>
      <button type="button" class="tool-primary" data-confirm>确认棋盘，替换当前对局</button><button type="button" data-recalibrate>返回截图标定</button></div>
    </div></div>`;
  const $ = selector => root.querySelector(selector), canvas = $(".import-image"), loupe = $(".import-loupe"), svg = $("svg"), context = canvas.getContext("2d", { willReadFrequently: true });
  const view = createBoardView(svg, { idPrefix: "image-import-" });
  let image = null, frame = null, drag = null, board = new Uint8Array(225), uncertain = new Set(), tool = 1, history = [], generation = 0, active = false, loading = false, correcting = false, grid = true;
  const message = text => { $(".tool-message").textContent = text; };
  function controls() {
    $("[data-recognize]").disabled = loading || !image || !frame;
    $("[data-confirm]").disabled = loading || !correcting;
    $("[data-reset-frame]").disabled = $("[data-grid]").disabled = loading;
    for (const button of root.querySelectorAll("[data-color]")) button.disabled = loading;
    $("[data-side]").disabled = $("[data-actor]").disabled = loading;
    $("[data-undo]").disabled = loading || history.length === 0;
  }
  const defaultFrame = () => {
    const size = Math.min(canvas.width, canvas.height) * .88;
    return { left: (canvas.width - size) / 2, top: (canvas.height - size) / 2, right: (canvas.width + size) / 2, bottom: (canvas.height + size) / 2 };
  };
  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height); if (!image) return;
    context.drawImage(image.source ?? image, 0, 0, canvas.width, canvas.height);
    if (!frame) return;
    const { left, top, right, bottom } = frame;
    context.fillStyle = "rgba(20, 24, 19, .38)";
    context.fillRect(0, 0, canvas.width, top);
    context.fillRect(0, bottom, canvas.width, canvas.height - bottom);
    context.fillRect(0, top, left, bottom - top);
    context.fillRect(right, top, canvas.width - right, bottom - top);
    context.strokeStyle = "#e44724"; context.lineWidth = Math.max(2, canvas.width / 350);
    context.strokeRect(left, top, right - left, bottom - top);
    if (grid) {
      context.strokeStyle = "rgba(228, 71, 36, .42)"; context.lineWidth = Math.max(1, canvas.width / 700);
      context.beginPath();
      for (let i = 1; i < 14; i++) {
        const x = left + (right - left) * i / 14, y = top + (bottom - top) * i / 14;
        context.moveTo(x, top); context.lineTo(x, bottom); context.moveTo(left, y); context.lineTo(right, y);
      }
      context.stroke();
    }
    const bounds = canvas.getBoundingClientRect();
    const handleRadius = Math.max(10, 21 * canvas.width / Math.max(1, bounds.width));
    context.fillStyle = "#fffdf6"; context.strokeStyle = "#3f583c"; context.lineWidth = Math.max(2, canvas.width / 450);
    for (const p of corners(frame)) {
      context.beginPath(); context.arc(p.x, p.y, handleRadius, 0, 2 * Math.PI); context.fill(); context.stroke();
    }
    loupe.hidden = !drag || drag.mode === "move";
    if (!loupe.hidden) {
      const point = corners(frame).find(p => p.key === drag.mode), zoom = loupe.getContext("2d"), side = loupe.width;
      // Draw the original image, with a crosshair at the exact corner, away from the finger.
      const sample = 48 * canvas.width / Math.max(1, bounds.width);
      zoom.clearRect(0, 0, side, side); zoom.fillStyle = "#f5f2ea"; zoom.fillRect(0, 0, side, side);
      zoom.drawImage(image.source ?? image, 0, 0, image.width, image.height,
        side / 2 - point.x * side / sample, side / 2 - point.y * side / sample, canvas.width * side / sample, canvas.height * side / sample);
      zoom.strokeStyle = "#e44724"; zoom.lineWidth = 2; zoom.beginPath();
      zoom.moveTo(side / 2, 0); zoom.lineTo(side / 2, side); zoom.moveTo(0, side / 2); zoom.lineTo(side, side / 2); zoom.stroke();
      loupe.style.left = point.x > canvas.width / 2 ? "8px" : "auto"; loupe.style.right = point.x > canvas.width / 2 ? "auto" : "8px";
    }
  }
  function corners(rect) { return [
    { key: "nw", x: rect.left, y: rect.top }, { key: "ne", x: rect.right, y: rect.top },
    { key: "se", x: rect.right, y: rect.bottom }, { key: "sw", x: rect.left, y: rect.bottom }
  ]; }
  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
  }
  function renderBoard() {
    view.render({ board, lastMove: -1, pendingIndex: -1, playerColor: tool || 1, canInteract: true, editable: true, uncertain: [...uncertain] });
    $(".image-counts").textContent = `黑 ${board.filter(c => c === 1).length} · 白 ${board.filter(c => c === 2).length} · 待检查 ${uncertain.size} 点（橙框）`;
    controls();
  }
  function calibrate(resetFrame = false) {
    if (image && (resetFrame || !frame)) frame = defaultFrame();
    drag = null; correcting = false; loupe.hidden = true; svg.toggleAttribute("hidden", true); canvas.hidden = !image; $(".image-correction").hidden = true; $(".calibration-actions").hidden = !image; controls();
    message("框的是 15 条横线和 15 条竖线的范围。拖四角对准最外层黑线交点（左上 A15、右下 O1）；不要框进木质边框或外侧留白。拖角时可看放大预览，红色网格应与黑线重合。"); draw();
  }
  async function load(file) {
    if (!file) return;
    const token = ++generation; loading = true; drag = null; loupe.hidden = true; controls();
    try {
      if (file.size > 12 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择不超过 12 MiB 的 PNG、JPEG 或 WebP 图片");
      message("正在读取截图…");
      const bitmap = await decodeScreenshot(file);
      if (!active || token !== generation) { bitmap.close(); return; }
      if (bitmap.width * bitmap.height > 40_000_000) { bitmap.close(); throw new Error("图片像素过多，请先裁剪棋盘"); }
      if (Math.min(bitmap.width, bitmap.height) < 100) { bitmap.close(); throw new Error("图片太小，请使用清晰的棋盘截图"); }
      image?.close(); image = bitmap;
      const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      calibrate(true);
    } catch (error) { if (active && token === generation) message(error.message); }
    finally { if (active && token === generation) { loading = false; controls(); } }
  }
  $("input[type=file]").onchange = event => { const file = event.target.files[0]; event.target.value = ""; void load(file); };
  function paste(event) {
    if (!active) return; const file = [...(event.clipboardData?.items ?? [])].find(item => item.type.startsWith("image/"))?.getAsFile();
    if (file) { event.preventDefault(); void load(file); }
  }
  document.addEventListener("paste", paste);
  canvas.onpointerdown = event => {
    if (!image || !frame || loading || correcting || drag || event.isPrimary === false || event.button > 0) return;
    const point = canvasPoint(event); if (!point) return;
    const bounds = canvas.getBoundingClientRect(), handleHitX = 26 * canvas.width / bounds.width, handleHitY = 26 * canvas.height / bounds.height;
    const handle = corners(frame).map(corner => ({ corner, distance: Math.hypot((point.x - corner.x) / handleHitX, (point.y - corner.y) / handleHitY) })).sort((a, b) => a.distance - b.distance)[0];
    if (handle.distance <= 1) {
      drag = { pointerId: event.pointerId, mode: handle.corner.key, offsetX: frame[handle.corner.key.endsWith("w") ? "left" : "right"] - point.x, offsetY: frame[handle.corner.key.startsWith("n") ? "top" : "bottom"] - point.y };
    } else if (point.x >= frame.left && point.x <= frame.right && point.y >= frame.top && point.y <= frame.bottom) {
      drag = { pointerId: event.pointerId, mode: "move", offsetX: point.x - frame.left, offsetY: point.y - frame.top };
    } else return;
    canvas.setPointerCapture?.(event.pointerId); event.preventDefault?.(); draw();
  };
  canvas.onpointermove = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = canvasPoint(event); if (!point) return;
    if (drag.mode === "move") {
      const width = frame.right - frame.left, height = frame.bottom - frame.top;
      frame.left = Math.max(0, Math.min(canvas.width - width - 1, point.x - drag.offsetX)); frame.top = Math.max(0, Math.min(canvas.height - height - 1, point.y - drag.offsetY));
      frame.right = frame.left + width; frame.bottom = frame.top + height;
    } else {
      const west = drag.mode.endsWith("w"), north = drag.mode.startsWith("n"), minSize = 84;
      const x = Math.max(0, Math.min(canvas.width - 1, point.x + drag.offsetX)), y = Math.max(0, Math.min(canvas.height - 1, point.y + drag.offsetY));
      if (west) frame.left = Math.max(0, Math.min(frame.right - minSize, x)); else frame.right = Math.min(canvas.width - 1, Math.max(frame.left + minSize, x));
      if (north) frame.top = Math.max(0, Math.min(frame.bottom - minSize, y)); else frame.bottom = Math.min(canvas.height - 1, Math.max(frame.top + minSize, y));
    }
    draw();
  };
  const finishDrag = event => { if (drag?.pointerId === event.pointerId) {
    drag = null; loupe.hidden = true;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  } };
  canvas.onpointerup = finishDrag; canvas.onpointercancel = finishDrag;
  canvas.onlostpointercapture = finishDrag;
  $("[data-recognize]").onclick = () => {
    if (loading || !image || !frame) return;
    try {
      const rectangle = boardRectangle({ x: frame.left, y: frame.top }, { x: frame.right, y: frame.bottom }, canvas.width, canvas.height);
      // Markers are instructions only; they must not enter recognition pixels.
      context.drawImage(image.source ?? image, 0, 0, canvas.width, canvas.height);
      const recognized = recognizeBoard(context.getImageData(0, 0, canvas.width, canvas.height), rectangle);
      board = recognized.board; uncertain = new Set(recognized.uncertain); history = [];
      renderBoard(); correcting = true; canvas.hidden = loupe.hidden = true;
      // SVGElement has no HTMLElement.hidden reflection: change the attribute itself.
      svg.toggleAttribute("hidden", false); $(".calibration-actions").hidden = true; $(".image-correction").hidden = false; controls();
      message("逐点核对黑白棋，橙框优先检查。选择黑棋、白棋或擦除后点击棋盘校正；核对完成再确认。");
    } catch (error) { message(error.message); draw(); }
  };
  for (const button of root.querySelectorAll("[data-recalibrate]")) button.onclick = () => { if (!loading) calibrate(); };
  $("[data-reset-frame]").onclick = () => { if (!loading) calibrate(true); };
  $("[data-grid]").onclick = () => {
    grid = !grid; $("[data-grid]").setAttribute("aria-pressed", String(grid)); $("[data-grid]").textContent = `网格参考：${grid ? "开" : "关"}`; draw();
  };
  for (const button of root.querySelectorAll("[data-color]")) button.onclick = () => {
    tool = Number(button.dataset.color);
    for (const b of root.querySelectorAll("[data-color]")) b.setAttribute("aria-pressed", String(b === button)); renderBoard();
  };
  svg.onclick = event => {
    if (!correcting || loading) return;
    const target = event.target.closest("[data-index]"), index = target ? Number(target.dataset.index) : view.nearestIntersection(event.clientX, event.clientY);
    if (index < 0 || index >= 225) return;
    history.push({ index, color: board[index], uncertain: uncertain.has(index) }); board[index] = tool; uncertain.delete(index); renderBoard();
  };
  $("[data-undo]").onclick = () => { const saved = history.pop(); if (saved) { board[saved.index] = saved.color; if (saved.uncertain) uncertain.add(saved.index); renderBoard(); } };
  $("[data-confirm]").onclick = () => {
    if (!correcting || loading) return;
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
      correcting = loading = false; svg.toggleAttribute("hidden", true); canvas.hidden = loupe.hidden = true; frame = null; drag = null; $(".image-correction").hidden = $(".calibration-actions").hidden = true; controls();
      message("选择截图或粘贴图片。图片只在本机处理，请使用正视的 15 × 15 棋盘。");
    },
    dispose() { active = false; generation++; image?.close(); image = null; frame = drag = null; canvas.width = canvas.height = 1; history = []; }
  };
}
