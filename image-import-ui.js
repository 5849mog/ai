import { boardKeyboardIndex, coordinate, createBoardView } from "./board-view.js";
import { boardTransformMarkup, transformBoard, transformedIndex } from "./board-transform.js";
import { createRecord } from "./game-record.js";
import { validateSeed } from "./renju-rules.js";
import { boardRectangle, recognizeBoard } from "./image-board.js";
import { findBoardGrid } from "./image-grid.js";
import { updateControlMarkup } from "./app-update.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const isScreenshot = file => IMAGE_TYPES.includes(file.type) || (!file.type && /\.(png|jpe?g|webp)$/i.test(file.name));

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
  root.innerHTML = `<header class="tool-header"><h2>截图导入</h2><span data-import-step hidden></span><label class="image-picker">选择截图<input type="file" id="boardScreenshotFile" aria-label="选择截图" accept="image/png,image/jpeg,image/webp" /></label><button type="button" data-close>返回原局</button></header>
    ${updateControlMarkup()}
    <p class="tool-message" role="status">选择或粘贴正视的 15 × 15 棋盘截图。图片只在本机处理。</p>
    <div class="tool-workspace" data-screenshot-drop><div class="tool-board-area"><label class="screenshot-empty" for="boardScreenshotFile"><span data-ui-icon="camera">选择或拖入截图</span></label><canvas class="import-image" hidden tabindex="0" aria-label="截图选框。方向键移动，Shift 加速，加减号缩放，Home 重置，G 切换网格，回车识别。可拖动四角调整范围。"></canvas><canvas class="import-loupe" width="144" height="144" hidden aria-label="选框角点放大预览"></canvas><canvas class="import-reference" width="580" height="580" hidden role="img" aria-label="截图中的原始棋盘"></canvas><svg class="board-svg import-board" width="580" height="580" viewBox="20 20 580 580" preserveAspectRatio="xMidYMid meet" tabindex="0" role="group" aria-label="校正识别棋盘，方向键选点，回车编辑，1 黑棋、2 白棋、0 擦除" hidden></svg></div>
    <div class="tool-panel"><div class="calibration-actions" hidden><button type="button" data-reset-frame>重置选框</button><button type="button" data-grid aria-pressed="true">网格参考：开</button><button type="button" data-undo-frame disabled>撤回选框</button><output data-frame-size aria-live="off"></output><button type="button" data-recognize disabled>识别棋子</button></div>
      <div class="image-correction" hidden><div class="image-compare-row"><p class="image-counts"></p><button type="button" data-prev-uncertain>上一疑点</button><button type="button" data-next-uncertain>下一疑点</button><button type="button" data-accept-point hidden>保留此点</button><button type="button" data-compare aria-pressed="false">查看原图</button></div><div class="tool-buttons" role="group" aria-label="校正工具"><button type="button" data-color="1" aria-pressed="true">黑棋</button><button type="button" data-color="2" aria-pressed="false">白棋</button><button type="button" data-color="0" aria-pressed="false">擦除</button><button type="button" data-undo disabled>撤回</button><button type="button" data-redo disabled>重做</button></div>
      <details class="draft-tools"><summary>调整盘面</summary>
        <label>变换盘面<select data-image-transform>${boardTransformMarkup()}</select></label><button type="button" data-apply-transform>应用</button>
        <button type="button" data-reset-correction>恢复识别结果</button></details>
      <div class="tool-fields"><label>下一手棋色<select data-side><option value="1">黑棋</option><option value="2">白棋</option></select></label><label>这一手谁走<select data-actor></select></label></div>
      <p class="image-rule"></p><p>截图没有手序和换色记录。确认后作为中盘摆局续下，跳过开局交换与打点。</p>
      <button type="button" class="tool-primary" data-confirm>确认棋盘，替换当前对局</button><button type="button" data-recalibrate>返回截图标定</button></div>
    </div></div>`;
  const $ = selector => root.querySelector(selector), canvas = $(".import-image"), loupe = $(".import-loupe"), reference = $(".import-reference"), svg = $("svg"), context = canvas.getContext("2d", { willReadFrequently: true });
  const view = createBoardView(svg, { idPrefix: "image-import-" });
  let image = null, frame = null, initialFrame = null, autoLocated = false, drag = null, board = new Uint8Array(225), uncertain = new Set(), checkIndex = -1, keyboardIndex = 112, keyboardActive = false, tool = 1, history = [], generation = 0, active = false, loading = false, correcting = false, comparing = false, grid = true;
  let initialCorrection, recognizedFrame, future = [], transforms = [], frameHistory = [], editedSide = "", editedActor = "";
  let referenceIndex = -1, changedFrame = null;
  const compareMedia = root.ownerDocument?.defaultView?.matchMedia?.("(min-width: 850px) and (min-height: 480px)");
  const frameKeys = ["left", "right", "top", "bottom"];
  const sameFrame = (a, b) => a && b && frameKeys.every(edge => a[edge] === b[edge]);
  const message = (text, error = false) => {
    const status = $(".tool-message"); status.textContent = text; status.dataset.state = error ? "error" : "ready";
  };
  function controls() {
    const step = $("[data-import-step]");
    step.hidden = !loading && !image;
    step.textContent = loading ? "读取中" : comparing ? "原图对照" : correcting ? "核对棋子" : "校准棋盘";
    root.setAttribute("aria-busy", String(loading));
    $("[data-recognize]").disabled = loading || !image || !frame;
    $("[data-recognize]").textContent = sameFrame(frame, recognizedFrame) ? "继续校正" : "识别棋子";
    $("[data-confirm]").disabled = loading || !correcting || comparing;
    $("[data-compare]").disabled = loading || !correcting;
    $("[data-prev-uncertain]").disabled = $("[data-next-uncertain]").disabled = loading || !correcting || comparing || !uncertain.size;
    $("[data-reset-frame]").disabled = loading || sameFrame(frame, initialFrame ?? defaultFrame());
    $("[data-grid]").disabled = loading;
    $("[data-undo-frame]").disabled = loading || !frameHistory.length;
    const accept = $("[data-accept-point]");
    accept.hidden = checkIndex < 0 || comparing;
    accept.disabled = loading || comparing;
    for (const button of root.querySelectorAll("[data-color]")) button.disabled = loading || comparing;
    $("[data-side]").disabled = $("[data-actor]").disabled = loading || comparing;
    $("[data-undo]").disabled = loading || comparing || history.length === 0;
    $("[data-redo]").disabled = loading || comparing || future.length === 0;
    $("[data-reset-correction]").disabled = loading || comparing || !initialCorrection || (
      $("[data-side]").value === initialCorrection.side && $("[data-actor]").value === initialCorrection.actor
      && uncertain.size === initialCorrection.uncertain.size && [...uncertain].every(index => initialCorrection.uncertain.has(index)) && !transforms.length
      && board.every((color, index) => color === initialCorrection.board[index]));
    $("[data-image-transform]").disabled = $("[data-apply-transform]").disabled = loading || comparing || !board.some(Boolean) && !uncertain.size;
  }
  const defaultFrame = () => {
    const size = Math.min(canvas.width, canvas.height) * .88;
    return { left: (canvas.width - size) / 2, top: (canvas.height - size) / 2, right: (canvas.width + size) / 2, bottom: (canvas.height + size) / 2 };
  };
  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height); if (!image) return;
    context.drawImage(image.source ?? image, 0, 0, canvas.width, canvas.height);
    if (!frame) return;
    if (!sameFrame(frame, changedFrame)) changedFrame = null;
    const { left, top, right, bottom } = frame;
    const frameSize = `${Math.round((right - left) * image.width / canvas.width)} × ${Math.round((bottom - top) * image.height / canvas.height)} px`;
    const output = $("[data-frame-size]");
    if (output.textContent !== frameSize) output.textContent = frameSize;
    const ratio = (right - left) / (bottom - top);
    const adjustFrame = ratio < .7 || ratio > 1.4;
    output.toggleAttribute("data-adjust-frame", adjustFrame);
    output.title = adjustFrame ? "选框应接近正方形" : "";
    $("[data-recognize]").textContent = sameFrame(frame, recognizedFrame) ? "继续校正" : "识别棋子";
    $("[data-reset-frame]").disabled = loading || sameFrame(frame, initialFrame ?? defaultFrame());
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
    if (!uncertain.has(checkIndex)) checkIndex = -1;
    const cursor = keyboardActive ? { index: keyboardIndex, available: board[keyboardIndex] !== tool || uncertain.has(keyboardIndex) } : null;
    const point = board[keyboardIndex];
    svg.setAttribute("aria-label", `校正识别棋盘。${cursor ? `已选 ${coordinate(keyboardIndex)} · ${point === 1 ? "黑棋" : point === 2 ? "白棋" : "空点"}${uncertain.has(keyboardIndex) ? " · 待检查" : ""}。` : ""}方向键选点，回车编辑，1 黑棋、2 白棋、0 擦除、Z 撤回、Y 重做。`);
    const changed = view.render({ board, lastMove: -1, pendingIndex: -1, keyboardCursor: cursor, playerColor: tool || 1, canInteract: true, editable: true, uncertain: [...uncertain], overlayKey: `check:${checkIndex}` });
    if (changed && checkIndex >= 0) {
      const focus = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      focus.setAttribute("class", "image-check-focus"); focus.setAttribute("data-check-focus", String(checkIndex));
      focus.setAttribute("cx", String(46 + checkIndex % 15 * 528 / 14)); focus.setAttribute("cy", String(46 + Math.floor(checkIndex / 15) * 528 / 14)); focus.setAttribute("r", "19");
      svg.append(focus);
    }
    $(".image-counts").textContent = `黑 ${board.filter(c => c === 1).length} · 白 ${board.filter(c => c === 2).length} · ${uncertain.size ? `待检查 ${uncertain.size} 点${checkIndex >= 0 ? `（当前 ${coordinate(checkIndex)}）` : "（橙框）"}` : "疑点已核对"}`;
    controls();
  }
  function resetComparison() {
    comparing = false; reference.hidden = true;
    referenceIndex = -1;
    delete root.dataset.compareSideBySide;
    $("[data-compare]").setAttribute("aria-pressed", "false");
    $("[data-compare]").textContent = "查看原图";
  }
  function drawReference() {
    // Match the SVG's viewBox and grid insets: its intersections run from
    // 26 to 554 within a 580 square, regardless of the source screenshot size.
    const zoom = reference.getContext("2d"), sx = 528 / (frame.right - frame.left), sy = 528 / (frame.bottom - frame.top);
    zoom.clearRect(0, 0, 580, 580); zoom.fillStyle = "#f5f2ea"; zoom.fillRect(0, 0, 580, 580);
    if (transforms.length) {
      zoom.save(); zoom.translate(290, 290);
      for (const action of [...transforms].reverse()) {
        if (action === "rotateLeft") zoom.rotate(-Math.PI / 2);
        if (action === "rotateRight") zoom.rotate(Math.PI / 2);
        if (action === "mirror") zoom.scale(-1, 1);
        if (action === "flip") zoom.scale(1, -1);
      }
      zoom.translate(-290, -290);
    }
    zoom.drawImage(image.source ?? image, 26 - frame.left * sx, 26 - frame.top * sy, canvas.width * sx, canvas.height * sy);
    if (transforms.length) zoom.restore();
    const index = referenceIndex >= 0 ? referenceIndex : checkIndex;
    if (index >= 0) {
      const x = 26 + (index % 15) * 528 / 14, y = 26 + Math.floor(index / 15) * 528 / 14;
      zoom.beginPath(); zoom.arc(x, y, 16, 0, Math.PI * 2);
      zoom.lineWidth = 6; zoom.strokeStyle = "#fffdf8"; zoom.stroke();
      zoom.lineWidth = 3; zoom.strokeStyle = "#9b3c2c"; zoom.stroke();
    }
  }
  function showCorrection() {
    correcting = true;
    canvas.hidden = loupe.hidden = true;
    svg.toggleAttribute("hidden", false);
    $(".calibration-actions").hidden = true;
    $(".image-correction").hidden = false;
    renderBoard();
    svg.focus({ preventScroll: true });
  }
  function calibrate(resetFrame = false) {
    changedFrame = null;
    if (image && (resetFrame || !frame)) frame = { ...(initialFrame ?? defaultFrame()) };
    resetComparison(); drag = null; correcting = false; loupe.hidden = true; svg.toggleAttribute("hidden", true); canvas.hidden = !image; $(".image-correction").hidden = true; $(".calibration-actions").hidden = !image; controls();
    message(`${autoLocated ? "已尝试自动定位，" : "请手动定位，"}检查红色网格是否与棋盘黑线重合。拖四角对准最外层交点（左上 A15、右下 O1），不要框进木质边框或外侧留白；拖动时可看放大预览。`); draw();
  }
  async function load(file) {
    if (!file) return;
    const token = ++generation; loading = true; drag = null; loupe.hidden = true; controls();
    try {
      if (file.size > 12 * 1024 * 1024 || !isScreenshot(file)) throw new Error("请选择不超过 12 MiB 的 PNG、JPEG 或 WebP 图片");
      message("正在读取截图…");
      const bitmap = await decodeScreenshot(file);
      if (!active || token !== generation) { bitmap.close(); return; }
      if (bitmap.width * bitmap.height > 40_000_000) { bitmap.close(); throw new Error("图片像素过多，请先裁剪棋盘"); }
      if (Math.min(bitmap.width, bitmap.height) < 100) { bitmap.close(); throw new Error("图片太小，请使用清晰的棋盘截图"); }
      // A failed or unsupported automatic scan is never allowed to block the
      // existing manual calibration workflow. Only the small scan canvas is read.
      let suggestion = null, scanWidth = 0, scanHeight = 0;
      try {
        const scan = document.createElement("canvas"), scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
        scan.width = scanWidth = Math.round(bitmap.width * scale); scan.height = scanHeight = Math.round(bitmap.height * scale);
        const scanContext = scan.getContext("2d", { willReadFrequently: true });
        scanContext.drawImage(bitmap.source ?? bitmap, 0, 0, scanWidth, scanHeight);
        suggestion = findBoardGrid(scanContext.getImageData(0, 0, scanWidth, scanHeight));
      } catch { /* retain manual crop */ }
      image?.close(); image = bitmap; frameHistory = []; recognizedFrame = changedFrame = null; initialCorrection = null;
      const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      autoLocated = Boolean(suggestion);
      initialFrame = suggestion && { left: suggestion.left * canvas.width / scanWidth, right: suggestion.right * canvas.width / scanWidth,
        top: suggestion.top * canvas.height / scanHeight, bottom: suggestion.bottom * canvas.height / scanHeight };
      calibrate(true);
      canvas.focus({ preventScroll: true });
    } catch (error) { if (active && token === generation) message(error.message, true); }
    finally { if (active && token === generation) { loading = false; controls(); } }
  }
  $("input[type=file]").onchange = event => { const file = event.target.files[0]; event.target.value = ""; void load(file); };
  function paste(event) {
    if (!active) return; const file = [...(event.clipboardData?.items ?? [])].find(item => item.type.startsWith("image/"))?.getAsFile();
    if (file) { event.preventDefault(); void load(file); }
  }
  document.addEventListener("paste", paste);
  const dropZone = $("[data-screenshot-drop]");
  const fileDrag = event => active && Array.from(event.dataTransfer?.types ?? []).includes("Files");
  for (const type of ["dragenter", "dragover"]) dropZone.addEventListener(type, event => {
    if (!fileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    dropZone.dataset.dragActive = "true";
  });
  dropZone.addEventListener("dragleave", event => {
    if (!event.relatedTarget || !dropZone.contains(event.relatedTarget)) delete dropZone.dataset.dragActive;
  });
  dropZone.addEventListener("drop", event => {
    delete dropZone.dataset.dragActive;
    const file = event.dataTransfer?.files[0];
    if (!active || !file) return;
    event.preventDefault(); void load(file);
  });
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
    drag.start = { ...frame };
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
  function rememberFrame(previous) {
    if (sameFrame(previous, frame)) return;
    if (frameHistory.length === 24) frameHistory.shift();
    frameHistory.push(previous);
    controls();
  }
  const finishDrag = event => { if (drag?.pointerId === event.pointerId) {
    const { start } = drag; drag = null; loupe.hidden = true;
    if (event.type === "pointerup") rememberFrame(start);
    else { frame = start; draw(); controls(); }
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  } };
  canvas.onpointerup = finishDrag; canvas.onpointercancel = finishDrag;
  canvas.onlostpointercapture = finishDrag;
  canvas.onkeydown = event => {
    if (!frame || loading || correcting || drag || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Home" || event.key.toLowerCase() === "z") { event.preventDefault(); if (!event.repeat) $(event.key === "Home" ? "[data-reset-frame]" : "[data-undo-frame]").click(); return; }
    if (event.key === "Enter" || event.key.toLowerCase() === "g") {
      event.preventDefault();
      if (!event.repeat) $(event.key === "Enter" ? "[data-recognize]" : "[data-grid]").click();
      return;
    }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const previous = { ...frame };
    if (["+", "=", "-"].includes(event.key)) {
      event.preventDefault();
      const step = (event.shiftKey ? 10 : 2) * (event.key === "-" ? -1 : 1);
      const limit = step > 0
        ? Math.min(frame.left, frame.top, canvas.width - 1 - frame.right, canvas.height - 1 - frame.bottom)
        : Math.min((frame.right - frame.left - 84) / 2, (frame.bottom - frame.top - 84) / 2);
      const delta = Math.sign(step) * Math.max(0, Math.min(Math.abs(step), limit));
      frame.left -= delta; frame.right += delta; frame.top -= delta; frame.bottom += delta;
      draw(); rememberFrame(previous); return;
    }
    if (!Object.hasOwn(direction, event.key)) return;
    event.preventDefault();
    const [dx, dy] = direction[event.key], step = event.shiftKey ? 10 : 1;
    const x = Math.max(-frame.left, Math.min(canvas.width - 1 - frame.right, dx * step));
    const y = Math.max(-frame.top, Math.min(canvas.height - 1 - frame.bottom, dy * step));
    frame.left += x; frame.right += x; frame.top += y; frame.bottom += y;
    draw(); rememberFrame(previous);
  };
  canvas.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight Home Enter G Z");
  svg.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight Home Enter 0 1 2 B C N V Y Z");
  $("[data-recognize]").onclick = () => {
    if (loading || !image || !frame) return;
    if (sameFrame(frame, recognizedFrame) && initialCorrection) {
      showCorrection(); message("已回到上次校正，棋子、疑点和撤回记录都已保留。"); return;
    }
    if (recognizedFrame && (history.length || future.length) && !sameFrame(frame, changedFrame)) {
      changedFrame = { ...frame };
      message("选框已改变。再点一次「识别棋子」会重新识别并替换之前的校正；撤回选框可继续旧校正。");
      return;
    }
    try {
      const rectangle = boardRectangle({ x: frame.left, y: frame.top }, { x: frame.right, y: frame.bottom }, canvas.width, canvas.height);
      // Markers are instructions only; they must not enter recognition pixels.
      context.drawImage(image.source ?? image, 0, 0, canvas.width, canvas.height);
      const recognized = recognizeBoard(context.getImageData(0, 0, canvas.width, canvas.height), rectangle);
      board = recognized.board; uncertain = new Set(recognized.uncertain); checkIndex = -1; keyboardIndex = 112; keyboardActive = false; history = []; future = []; transforms = [];
      recognizedFrame = { ...frame }; changedFrame = null;
      initialCorrection = snapshot(); editedSide = initialCorrection.side; editedActor = initialCorrection.actor;
      $(".draft-tools").open = false; $("[data-image-transform]").selectedIndex = 0;
      selectTool(1);
      showCorrection();
      message("逐点核对黑白棋，橙框优先检查。选择黑棋、白棋或擦除后点击棋盘校正；核对完成再确认。");
    } catch (error) { message(error.message, true); draw(); }
  };
  for (const button of root.querySelectorAll("[data-recalibrate]")) button.onclick = () => { if (!loading) { calibrate(); canvas.focus({ preventScroll: true }); } };
  $("[data-reset-frame]").onclick = () => {
    if (loading || !frame) return;
    const previous = { ...frame }; calibrate(true); rememberFrame(previous);
    canvas.focus({ preventScroll: true });
  };
  $("[data-undo-frame]").onclick = () => {
    if (loading || !frameHistory.length) return;
    frame = frameHistory.pop(); draw(); controls();
    canvas.focus({ preventScroll: true });
    message("已撤回上次选框调整。");
  };
  $("[data-grid]").onclick = () => {
    grid = !grid; $("[data-grid]").setAttribute("aria-pressed", String(grid)); $("[data-grid]").textContent = `网格参考：${grid ? "开" : "关"}`; draw();
  };
  function layoutComparison() {
    const split = comparing && Boolean(compareMedia?.matches);
    reference.hidden = !comparing;
    svg.toggleAttribute("hidden", comparing && !split);
    root.toggleAttribute("data-compare-side-by-side", split);
  }
  compareMedia?.addEventListener?.("change", layoutComparison);
  $("[data-compare]").onclick = () => {
    if (!correcting || loading || !image || !frame) return;
    try {
      if (!comparing) { referenceIndex = -1; drawReference(); }
      comparing = !comparing;
      layoutComparison();
      $("[data-compare]").setAttribute("aria-pressed", String(comparing));
      $("[data-compare]").textContent = comparing ? "返回识别结果" : "查看原图";
      message(comparing && compareMedia?.matches ? "左边是识别结果，右边是原图。对照后返回继续校正。"
        : comparing ? "正在查看截图原图。点击「返回识别结果」或按 V 继续校正。" : "逐点核对黑白棋，橙框优先检查。选择黑棋、白棋或擦除后点击棋盘校正；核对完成再确认。");
      controls();
    } catch { message("暂时无法显示原图，识别结果仍然保留。", true); }
  };
  $("[data-compare]").onkeydown = event => {
    if (event.key.toLowerCase() !== "v" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); $("[data-compare]").click();
    if (!comparing) svg.focus({ preventScroll: true });
  };
  function jumpUncertain(reverse = false) {
    if (loading || !correcting || comparing || !uncertain.size) return;
    const points = [...uncertain].sort((a, b) => reverse ? b - a : a - b);
    checkIndex = points.find(index => reverse ? index < checkIndex : index > checkIndex) ?? points[0];
    keyboardIndex = checkIndex; keyboardActive = document.activeElement === svg; renderBoard();
    message(`待检查 ${coordinate(checkIndex)}。可保留识别结果，或改为黑棋、白棋、空点。`);
  }
  $("[data-next-uncertain]").onclick = () => jumpUncertain();
  $("[data-prev-uncertain]").onclick = () => jumpUncertain(true);
  $("[data-accept-point]").onclick = () => {
    if (!uncertain.has(checkIndex) || loading || comparing || !correcting) return;
    const focus = document.activeElement === $("[data-accept-point]");
    if (focus) svg.focus({ preventScroll: true });
    const index = checkIndex;
    pushCorrection(); uncertain.delete(index);
    if (uncertain.size) jumpUncertain();
    else { renderBoard(); message("已核对最后一个疑点，请确认下一手棋色。"); }
  };
  function snapshot() {
    return { board: board.slice(), uncertain: new Set(uncertain), checkIndex, keyboardIndex, transforms: [...transforms], side: $("[data-side]").value, actor: $("[data-actor]").value };
  }
  function pushCorrection(overrides = {}) {
    if (history.length === board.length) history.shift();
    history.push({ ...snapshot(), ...overrides });
    future.length = 0;
  }
  function restoreCorrection(saved) {
    board = saved.board.slice(); uncertain = new Set(saved.uncertain); checkIndex = saved.checkIndex;
    keyboardIndex = saved.keyboardIndex; transforms = [...saved.transforms];
    editedSide = $("[data-side]").value = saved.side; editedActor = $("[data-actor]").value = saved.actor;
    renderBoard();
  }
  $("[data-apply-transform]").onclick = () => {
    const action = $("[data-image-transform]").value;
    pushCorrection();
    board = transformBoard(board, action);
    uncertain = new Set([...uncertain].map(index => transformedIndex(index, action)));
    if (checkIndex >= 0) checkIndex = transformedIndex(checkIndex, action);
    keyboardIndex = transformedIndex(keyboardIndex, action);
    if (action === "swap") editedSide = $("[data-side]").value = $("[data-side]").value === "1" ? "2" : "1";
    else transforms.push(action);
    renderBoard();
  };
  $("[data-reset-correction]").onclick = () => {
    if (!initialCorrection || loading || comparing) return;
    pushCorrection(); restoreCorrection(initialCorrection);
    svg.focus({ preventScroll: true });
    message("已恢复截图识别结果，可撤回这次恢复。");
  };
  $("[data-side]").onchange = () => { pushCorrection({ side: editedSide }); editedSide = $("[data-side]").value; controls(); };
  $("[data-actor]").onchange = () => { pushCorrection({ actor: editedActor }); editedActor = $("[data-actor]").value; controls(); };
  function selectTool(color) {
    tool = color;
    for (const button of root.querySelectorAll("[data-color]")) button.setAttribute("aria-pressed", String(Number(button.dataset.color) === color));
  }
  for (const button of root.querySelectorAll("[data-color]")) button.onclick = () => {
    selectTool(Number(button.dataset.color)); renderBoard();
  };
  function editPoint(index) {
    if (!correcting || loading || comparing || !Number.isInteger(index) || index < 0 || index >= 225) return false;
    if (board[index] === tool && !uncertain.has(index)) return false;
    pushCorrection();
    board[index] = tool; uncertain.delete(index); keyboardIndex=index; renderBoard();
    message(`${coordinate(index)} 已${tool ? `设为${tool === 1 ? "黑" : "白"}棋` : "设为空点"}。${!uncertain.size ? "请核对黑白棋和下一手棋色。" : ""}`);
    return true;
  }
  svg.onclick = event => {
    const target = event.target.closest("[data-index]"), index = target ? Number(target.dataset.index) : view.nearestIntersection(event.clientX, event.clientY);
    if (comparing && compareMedia?.matches && index >= 0 && index < board.length) {
      referenceIndex = index;
      drawReference(); message(`原图对应交点 · ${coordinate(index)}`);
      return;
    }
    const wasKeyboard = keyboardActive; keyboardActive = false;
    if (!editPoint(index) && wasKeyboard) renderBoard();
  };
  svg.addEventListener("focusout", event => {
    if (keyboardActive && !svg.contains(event.relatedTarget)) { keyboardActive = false; renderBoard(); }
  });
  svg.onkeydown = event => {
    if (!correcting || loading || comparing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const next = boardKeyboardIndex(keyboardIndex, event.key);
    if (next !== null) { event.preventDefault(); keyboardIndex = next; keyboardActive = true; renderBoard(); }
    else if (["Enter", " "].includes(event.key)) { event.preventDefault(); if (!event.repeat) { keyboardActive = true; if (!editPoint(keyboardIndex)) renderBoard(); } }
    else if(event.key.toLowerCase()==="z"&&!event.repeat&&!$("[data-undo]").disabled){event.preventDefault();$("[data-undo]").click();}
    else if (event.key.toLowerCase() === "y" && !event.repeat && !$("[data-redo]").disabled) { event.preventDefault(); $("[data-redo]").click(); }
    else if (["0", "1", "2"].includes(event.key)) { event.preventDefault(); root.querySelector(`button[data-color="${event.key}"]`).click(); }
    else if (["n", "b", "v", "c"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const key = event.key.toLowerCase();
      if (!event.repeat) $({ n: "[data-next-uncertain]", b: "[data-prev-uncertain]", v: "[data-compare]", c: "[data-accept-point]" }[key]).click();
      if (key === "v" && comparing) $("[data-compare]").focus({ preventScroll: true });
    }
  };
  $("[data-undo]").onclick = () => {
    if (!history.length) return;
    const focus = document.activeElement === $("[data-undo]");
    future.push(snapshot()); restoreCorrection(history.pop());
    if (focus && !history.length) svg.focus({ preventScroll: true });
    message("已撤回上次校正。");
  };
  $("[data-redo]").onclick = () => {
    if (!future.length) return;
    const focus = document.activeElement === $("[data-redo]");
    history.push(snapshot()); restoreCorrection(future.pop());
    if (focus && !future.length) svg.focus({ preventScroll: true });
    message("已重做上次校正。");
  };
  $("[data-confirm]").onclick = () => {
    if (!correcting || loading || comparing) return;
    try {
      validateSeed(board); const side = Number($("[data-side]").value), actor = $("[data-actor]").value, copilot = getPosition().workflow === "copilot";
      const playerColor = ["follow", "local"].includes(getPosition().workflow) ? getPosition().playerColor || side : actor === "player" ? copilot ? 3 - side : side : copilot ? side : 3 - side;
      // Validate/apply atomically before closing; rejected imports preserve the game.
      const saved = applyRecord(createRecord([], playerColor, { board, sideToMove: side }));
      close({ imported: true, saved });
    } catch (error) { message(`不能开始：${error.message}。请校正棋盘；当前对局保持不变。`, true); }
  };
  $("[data-close]").onclick = () => close();
  return {
    open() {
      active = true; const position = getPosition(), copilot = position.workflow === "copilot";
      $("[data-actor]").parentElement.hidden = ["follow", "local"].includes(position.workflow);
      board = new Uint8Array(225); uncertain = new Set(); checkIndex = -1; keyboardIndex=112; keyboardActive=false; history = []; grid = true;
      $("[data-grid]").setAttribute("aria-pressed", "true"); $("[data-grid]").textContent = "网格参考：开";
      selectTool(1);
      $("[data-side]").value = String(position.currentColor || 1);
      $("[data-actor]").replaceChildren(...["player", "ai"].map((value, i) => { const option = document.createElement("option"); option.value = value; option.textContent = copilot ? ["录入对手棋", "AI 替我落子"][i] : ["我来走", "AI 来走"][i]; return option; }));
      $("[data-actor]").value = position.playerColor && position.currentColor === position.playerColor ? copilot ? "ai" : "player" : copilot ? "player" : "ai";
      $(".image-rule").textContent = `续局规则：${position.ruleLabel ?? "无禁手"}。${["follow", "local"].includes(position.workflow) ? "双方继续由你手动录入。" : "下一手棋色和行棋方由你确定。"}`;
      correcting = loading = false; resetComparison(); svg.toggleAttribute("hidden", true); canvas.hidden = loupe.hidden = true; frame = initialFrame = null; autoLocated = false; drag = null; $(".image-correction").hidden = $(".calibration-actions").hidden = true; controls();
      message("选择截图或粘贴图片。图片只在本机处理，请使用正视的 15 × 15 棋盘。");
    },
    dispose() { delete dropZone.dataset.dragActive; active = false; generation++; image?.close(); image = null; frame = initialFrame = drag = recognizedFrame = changedFrame = null; autoLocated = comparing = false; checkIndex = -1; canvas.width = canvas.height = 1; reference.hidden = true; history = []; future = []; initialCorrection = null; transforms = []; frameHistory = []; delete root.dataset.compareSideBySide; }
  };
}
