import { BLACK, WHITE, CELL_COUNT, validIndex, validatePosition } from "./game-rules.js";
import { boardTransformMarkup, transformBoard, transformedIndex } from "./board-transform.js";
import { createRecord } from "./game-record.js";
import { boardKeyboardIndex, coordinate, createBoardView } from "./board-view.js";

// Editing is an isolated draft. Only the explicit start action replaces a
// durable game; canceling or a validation error cannot commit any draft cell.
export function setupCustomUi({ getPosition, applyRecord, onModalChange, notify }) {
  const dialog = document.querySelector("#setupDialog"), svg = document.querySelector("#setupBoard");
  const view = createBoardView(svg, { idPrefix: "setup-" });
  const side = document.querySelector("#setupSide"), actor = document.querySelector("#setupActor");
  const start = document.querySelector("#startSetup"), undo = document.querySelector("#undoSetup"), alternate = document.querySelector("#setupAlternate");
  const clear = document.querySelector("#clearSetup"), restore = document.querySelector("#restoreSetup"), redo = document.querySelector("#redoSetup");
  const transform = document.querySelector("#setupTransform"), applyTransform = document.querySelector("#applySetupTransform");
  transform.innerHTML = boardTransformMarkup();
  const message = document.querySelector("#setupMessage"), tools = [...dialog.querySelectorAll("[data-setup-tool]")];
  const draft = new Uint8Array(CELL_COUNT), history = [], future = [];
  let original, enteredSide, enteredActor;
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
    clear.disabled = applyTransform.disabled = !draft.some(Boolean);
    restore.disabled = draft.every((color, index) => color === original.board[index]) && side.value === original.side && actor.value === original.actor;
    redo.disabled = future.length === 0;
    alternate.setAttribute("aria-pressed", String(alternating)); alternate.textContent = `交替摆子：${alternating ? "开" : "关"}`;
    for (const button of tools) button.setAttribute("aria-pressed", String(Number(button.dataset.setupTool) === tool));
    svg.setAttribute("aria-label", `自定义棋盘，当前${tool === 0 ? "擦除棋子" : tool === BLACK ? "摆黑棋" : "摆白棋"}。${keyboardActive ? `已选 ${coordinate(keyboardIndex)}。` : ""}方向键选点，回车编辑，0 擦除、1 黑棋、2 白棋、Z 撤回、Y 重做。`);
    view.render({ board: draft, lastMove: -1, pendingIndex: -1, hoverIndex: tool ? hoverIndex : -1,
      keyboardCursor: keyboardActive ? { index: keyboardIndex, available: draft[keyboardIndex] !== tool } : null,
      playerColor: tool || BLACK, canInteract: true, editable: true });
  }
  function snapshot() {
    return { board: draft.slice(), side: side.value, actor: actor.value, tool, alternating, index: keyboardIndex };
  }
  function push(index = keyboardIndex, fields = {}) {
    if (history.length === CELL_COUNT) history.shift();
    history.push({ ...snapshot(), index, ...fields });
    future.length = 0;
  }
  function restoreDraft(saved) {
    draft.set(saved.board); side.value = saved.side; actor.value = saved.actor; tool = saved.tool; alternating = saved.alternating;
    keyboardIndex = saved.index; hoverIndex = -1; enteredSide = saved.side; enteredActor = saved.actor;
  }
  function edit(index) {
    if (!dialog.open || !validIndex(index) || draft[index] === tool) return false;
    push(index); draft[index] = tool;
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
    draft.set(current.board); history.length = future.length = 0; tool = BLACK; alternating = keyboardActive = false; hoverIndex = -1; keyboardIndex = 112;
    side.value = String(current.currentColor);
    actor.value = current.currentColor === current.playerColor ? (copilot ? "ai" : "player") : (copilot ? "player" : "ai");
    original = snapshot(); enteredSide = original.side; enteredActor = original.actor; transform.selectedIndex = 0; dialog.querySelector(".draft-tools").open = false;
    document.querySelector("#recordMenu").open = false;
    onModalChange(true); render(); dialog.showModal();
  });
  for (const button of tools) button.addEventListener("click", () => { tool = Number(button.dataset.setupTool); render(); });
  side.addEventListener("change", () => { push(keyboardIndex, { side: enteredSide }); enteredSide = side.value; render(); });
  actor.addEventListener("change", () => { push(keyboardIndex, { actor: enteredActor }); enteredActor = actor.value; render(); });
  alternate.addEventListener("click", () => { alternating = !alternating; render(); });
  undo.addEventListener("click", () => {
    if (!history.length) return;
    future.push(snapshot()); restoreDraft(history.pop()); render();
  });
  redo.addEventListener("click", () => {
    if (!future.length) return;
    history.push(snapshot()); restoreDraft(future.pop()); render();
  });
  clear.addEventListener("click", () => {
    if (draft.some(Boolean)) { push(); draft.fill(0); hoverIndex = -1; render(); }
  });
  restore.addEventListener("click", () => { push(); restoreDraft(original); render(); });
  applyTransform.addEventListener("click", () => {
    const action = transform.value, next = transformBoard(draft, action);
    if (next.every((color, index) => color === draft[index])) {
      message.textContent = "这个变换没有改变棋子位置或颜色。";
      return;
    }
    push();
    draft.set(next);
    if (action === "swap") enteredSide = side.value = String(BLACK + WHITE - Number(side.value));
    keyboardIndex = transformedIndex(keyboardIndex, action); hoverIndex = -1; render();
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
    else if (["Enter", " "].includes(event.key)) { event.preventDefault(); if (!event.repeat) { keyboardActive = true; if (!edit(keyboardIndex)) render(); } }
    else if (event.key.toLowerCase() === "z" && !event.repeat && !undo.disabled) { event.preventDefault(); undo.click(); }
    else if (event.key.toLowerCase() === "y" && !event.repeat && !redo.disabled) { event.preventDefault(); redo.click(); }
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
    history.length = future.length = 0; onModalChange(false);
    const trigger = document.body.classList.contains("simple-mode") ? "[aria-controls='simpleQuickTools']" : "#recordMenu summary";
    document.querySelector(trigger)?.focus({ preventScroll: true });
  });
}
