import { BLACK, WHITE, CELL_COUNT, validIndex, validatePosition } from "./game-rules.js";
import { createRecord } from "./game-record.js";
import { boardKeyboardIndex, coordinate, createBoardView } from "./board-view.js";

// Editing is an isolated draft. Only the explicit start action replaces a
// durable game; canceling or a validation error cannot commit any draft cell.
export function setupCustomUi({ getPosition, applyRecord, onModalChange, notify }) {
  const dialog = document.querySelector("#setupDialog"), svg = document.querySelector("#setupBoard");
  const view = createBoardView(svg, { idPrefix: "setup-" });
  const side = document.querySelector("#setupSide"), actor = document.querySelector("#setupActor");
  const start = document.querySelector("#startSetup"), undo = document.querySelector("#undoSetup"), alternate = document.querySelector("#setupAlternate");
  const clear = document.querySelector("#clearSetup");
  const message = document.querySelector("#setupMessage"), tools = [...dialog.querySelectorAll("[data-setup-tool]")];
  const draft = new Uint8Array(CELL_COUNT), history = [];
  let tool = BLACK, keyboardIndex = 112, hoverIndex = -1, keyboardActive = false, copilot = false, follow = false, alternating = false;

  function render() {
    let error = "";
    try { validatePosition(draft, Number(side.value), { allowSetup: true }); }
    catch (problem) { error = problem.message === "棋局已经结束" ? "已有五子相连，请调整后再开始。" : problem.message; }
    start.disabled = Boolean(error);
    message.textContent = error || (follow ? "开始后双方仍由你手动录入，AI 不会自动落子。" : copilot
      ? "开始后 AI 会替你下；若下一手轮到对手，请把对手的实战落子录入。"
      : "开始后将替换当前对局；摆好的棋子会作为起始局面保留。");
    message.dataset.state = error ? "error" : "ready";
    document.querySelector("#setupBlackCount").textContent = draft.filter(value => value === BLACK).length;
    document.querySelector("#setupWhiteCount").textContent = draft.filter(value => value === WHITE).length;
    undo.disabled = history.length === 0;
    clear.disabled = !draft.some(Boolean);
    alternate.setAttribute("aria-pressed", String(alternating)); alternate.textContent = `交替摆子：${alternating ? "开" : "关"}`;
    for (const button of tools) button.setAttribute("aria-pressed", String(Number(button.dataset.setupTool) === tool));
    svg.setAttribute("aria-label", `自定义棋盘，当前${tool === 0 ? "擦除棋子" : tool === BLACK ? "摆黑棋" : "摆白棋"}。${keyboardActive ? `已选 ${coordinate(keyboardIndex)}。` : ""}方向键选点，回车编辑，0 擦除、1 黑棋、2 白棋。`);
    view.render({ board: draft, lastMove: -1, pendingIndex: -1, hoverIndex: tool ? hoverIndex : -1,
      keyboardCursor: keyboardActive ? { index: keyboardIndex, available: draft[keyboardIndex] !== tool } : null,
      playerColor: tool || BLACK, canInteract: true, editable: true });
  }
  function edit(index) {
    if (!dialog.open || !validIndex(index) || draft[index] === tool) return false;
    history.push({ board: draft.slice(), placedTool: alternating && tool ? tool : null, index }); draft[index] = tool;
    if (alternating && tool) tool = 3 - tool;
    keyboardIndex = index; render(); return true;
  }
  function selected(event) {
    const target = event.target.closest("[data-index]");
    return target ? Number(target.dataset.index) : view.nearestIntersection(event.clientX, event.clientY);
  }
  document.querySelector("#openSetup").addEventListener("click", () => {
    const current = getPosition();
    copilot = current.workflow === "copilot";
    follow = current.workflow === "follow"; actor.parentElement.hidden = follow;
    actor.querySelector('[value="player"]').textContent = copilot ? "我录入对手棋" : "我来走";
    actor.querySelector('[value="ai"]').textContent = copilot ? "AI 替我落子" : "AI 来走";
    draft.set(current.board); history.length = 0; tool = BLACK; alternating = keyboardActive = false; hoverIndex = -1; keyboardIndex = 112;
    side.value = String(current.currentColor);
    actor.value = current.currentColor === current.playerColor ? (copilot ? "ai" : "player") : (copilot ? "player" : "ai");
    document.querySelector("#recordMenu").open = false;
    onModalChange(true); render(); dialog.showModal();
  });
  for (const button of tools) button.addEventListener("click", () => { tool = Number(button.dataset.setupTool); render(); });
  side.addEventListener("change", render);
  actor.addEventListener("change", render);
  alternate.addEventListener("click", () => { alternating = !alternating; render(); });
  undo.addEventListener("click", () => {
    const saved = history.pop(); if (!saved) return;
    draft.set(saved.board);
    if (alternating && saved.placedTool && tool === 3 - saved.placedTool) tool = saved.placedTool;
    if (saved.index != null) keyboardIndex = saved.index;
    render();
  });
  clear.addEventListener("click", () => {
    if (draft.some(Boolean)) { history.push({ board: draft.slice() }); draft.fill(0); hoverIndex = -1; render(); }
  });
  document.querySelector("#cancelSetup").addEventListener("click", () => dialog.close());
  svg.addEventListener("click", event => {
    const wasKeyboard = keyboardActive; keyboardActive = false;
    if (!edit(selected(event)) && wasKeyboard) render();
  });
  svg.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse") return;
    const index = selected(event); hoverIndex = validIndex(index) ? index : -1; render();
  });
  svg.addEventListener("pointerleave", () => { hoverIndex = -1; render(); });
  svg.addEventListener("focusout", event => {
    if (keyboardActive && !svg.contains(event.relatedTarget)) { keyboardActive = false; render(); }
  });
  svg.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const next = boardKeyboardIndex(keyboardIndex, event.key);
    if (next !== null) { event.preventDefault(); keyboardIndex = next; keyboardActive = true; hoverIndex = -1; render(); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); keyboardActive = true; if (!edit(keyboardIndex)) render(); }
    else if (["0", "1", "2"].includes(event.key)) { event.preventDefault(); tool = Number(event.key); render(); }
  });
  start.addEventListener("click", () => {
    try {
      const sideToMove = Number(side.value);
      validatePosition(draft, sideToMove, { allowSetup: true });
      const playerColor = follow ? getPosition().playerColor || sideToMove : actor.value === "player" ? (copilot ? 3 - sideToMove : sideToMove) : (copilot ? sideToMove : 3 - sideToMove);
      const saved = applyRecord(createRecord([], playerColor, { board: draft, sideToMove }));
      dialog.close();
      notify(saved ? "已从自定义局面开始对弈" : "局面已开始，但暂未保存；关闭前请导出棋谱", !saved);
    } catch (error) { message.textContent = error.message; message.dataset.state = "error"; }
  });
  dialog.addEventListener("close", () => {
    history.length = 0; onModalChange(false);
    const trigger = document.body.classList.contains("simple-mode") ? "[aria-controls='simpleQuickTools']" : "#recordMenu summary";
    document.querySelector(trigger)?.focus({ preventScroll: true });
  });
}
