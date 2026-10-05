import { BLACK, WHITE, SIZE, CELL_COUNT, validIndex, validatePosition } from "./game-rules.js";
import { createRecord } from "./game-record.js";
import { createBoardView } from "./board-view.js";

// Editing is an isolated draft. Only the explicit start action replaces a
// durable game; canceling or a validation error cannot commit any draft cell.
export function setupCustomUi({ getPosition, applyRecord, onModalChange, notify }) {
  const dialog = document.querySelector("#setupDialog"), svg = document.querySelector("#setupBoard");
  const view = createBoardView(svg, { idPrefix: "setup-" });
  const side = document.querySelector("#setupSide"), actor = document.querySelector("#setupActor");
  const start = document.querySelector("#startSetup"), undo = document.querySelector("#undoSetup");
  const message = document.querySelector("#setupMessage"), tools = [...dialog.querySelectorAll("[data-setup-tool]")];
  const draft = new Uint8Array(CELL_COUNT), history = [];
  let tool = BLACK, keyboardIndex = 112, hoverIndex = -1;

  function render() {
    let error = "";
    try { validatePosition(draft, Number(side.value), { allowSetup: true }); }
    catch (problem) { error = problem.message === "棋局已经结束" ? "已有五子相连，请调整后再开始。" : problem.message; }
    start.disabled = Boolean(error);
    message.textContent = error || "开始后将替换当前对局；摆好的棋子会作为起始局面保留。";
    message.dataset.state = error ? "error" : "ready";
    document.querySelector("#setupBlackCount").textContent = draft.filter(value => value === BLACK).length;
    document.querySelector("#setupWhiteCount").textContent = draft.filter(value => value === WHITE).length;
    undo.disabled = history.length === 0;
    for (const button of tools) button.setAttribute("aria-pressed", String(Number(button.dataset.setupTool) === tool));
    svg.setAttribute("aria-label", `自定义棋盘，当前${tool === 0 ? "擦除棋子" : tool === BLACK ? "摆黑棋" : "摆白棋"}。点一下编辑；方向键选点，回车编辑。`);
    view.render({ board: draft, lastMove: -1, pendingIndex: -1, hoverIndex: tool ? hoverIndex : -1,
      playerColor: tool || BLACK, canInteract: true, editable: true });
  }
  function edit(index) {
    if (!dialog.open || !validIndex(index) || draft[index] === tool) return;
    history.push(draft.slice()); draft[index] = tool; keyboardIndex = index; render();
  }
  function selected(event) {
    const target = event.target.closest("[data-index]");
    return target ? Number(target.dataset.index) : view.nearestIntersection(event.clientX, event.clientY);
  }
  document.querySelector("#openSetup").addEventListener("click", () => {
    const current = getPosition();
    draft.set(current.board); history.length = 0; tool = BLACK; hoverIndex = -1; keyboardIndex = 112;
    side.value = String(current.currentColor);
    actor.value = current.currentColor === current.playerColor ? "player" : "ai";
    document.querySelector("#recordMenu").open = false;
    onModalChange(true); render(); dialog.showModal();
  });
  for (const button of tools) button.addEventListener("click", () => { tool = Number(button.dataset.setupTool); render(); });
  side.addEventListener("change", render);
  actor.addEventListener("change", render);
  undo.addEventListener("click", () => { const saved = history.pop(); if (saved) { draft.set(saved); render(); } });
  document.querySelector("#clearSetup").addEventListener("click", () => {
    if (draft.some(Boolean)) { history.push(draft.slice()); draft.fill(0); hoverIndex = -1; render(); }
  });
  document.querySelector("#cancelSetup").addEventListener("click", () => dialog.close());
  svg.addEventListener("click", event => edit(selected(event)));
  svg.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse") return;
    const index = selected(event); hoverIndex = validIndex(index) ? index : -1; render();
  });
  svg.addEventListener("pointerleave", () => { hoverIndex = -1; render(); });
  svg.addEventListener("keydown", event => {
    const shifts = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (shifts[event.key]) {
      event.preventDefault();
      const [dx, dy] = shifts[event.key];
      keyboardIndex = Math.max(0, Math.min(SIZE - 1, Math.floor(keyboardIndex / SIZE) + dy)) * SIZE
        + Math.max(0, Math.min(SIZE - 1, keyboardIndex % SIZE + dx));
      hoverIndex = keyboardIndex; render();
    } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); edit(keyboardIndex); }
  });
  start.addEventListener("click", () => {
    try {
      const sideToMove = Number(side.value);
      validatePosition(draft, sideToMove, { allowSetup: true });
      const playerColor = actor.value === "player" ? sideToMove : 3 - sideToMove;
      const saved = applyRecord(createRecord([], playerColor, { board: draft, sideToMove }));
      dialog.close();
      notify(saved ? "已从自定义局面开始对弈" : "局面已开始，但暂未保存；关闭前请导出棋谱", !saved);
    } catch (error) { message.textContent = error.message; message.dataset.state = "error"; }
  });
  dialog.addEventListener("close", () => {
    history.length = 0; onModalChange(false); document.querySelector("#recordMenu summary").focus();
  });
}
