import { SIZE, LEVELS, hasFive } from "./engine.js";

const PAD = 46;
const STEP = 528 / (SIZE - 1);
const COLS = "ABCDEFGHIJKLMNO";
const boardSvg = document.querySelector("#boardSvg");
const stateText = document.querySelector("#stateText");
const stateIndicator = document.querySelector("#stateIndicator");
const levelButton = document.querySelector("#levelButton");
const levelButtonLabel = document.querySelector("#levelButtonLabel");
const levelDialog = document.querySelector("#levelDialog");
const levelOptions = document.querySelector("#levelOptions");
const undoButton = document.querySelector("#undoButton");
const board = new Uint8Array(SIZE * SIZE);
const history = [];

let currentColor = 1;
let thinking = false;
let winner = 0;
let worker = null;
let requestId = 0;
let lastMove = -1;
let pendingIndex = -1;
let activeLevel = 1;

function point(index) {
  return {
    x: PAD + (index % SIZE) * STEP,
    y: PAD + Math.floor(index / SIZE) * STEP
  };
}

function coordinate(index) {
  const x = index % SIZE;
  const y = Math.floor(index / SIZE);
  return COLS[x] + String(SIZE - y);
}

function nearestIntersection(clientX, clientY) {
  const matrix = boardSvg.getScreenCTM();
  if (!matrix) return -1;
  const screenPoint = boardSvg.createSVGPoint();
  screenPoint.x = clientX;
  screenPoint.y = clientY;
  const localPoint = screenPoint.matrixTransform(matrix.inverse());
  const x = Math.round((localPoint.x - PAD) / STEP);
  const y = Math.round((localPoint.y - PAD) / STEP);
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return -1;
  const index = y * SIZE + x;
  const p = point(index);
  return Math.abs(localPoint.x - p.x) <= STEP * .5 && Math.abs(localPoint.y - p.y) <= STEP * .5
    ? index
    : -1;
}

function renderBoard() {
  let svg = "";
  svg += "<defs>";
  svg += '<linearGradient id="woodSurface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#edd5a0"/><stop offset=".48" stop-color="#e4c58e"/><stop offset="1" stop-color="#d8b47b"/></linearGradient>';
  svg += '<radialGradient id="blackStone" cx=".34" cy=".26" r=".8"><stop offset="0" stop-color="#555954"/><stop offset=".36" stop-color="#282b29"/><stop offset="1" stop-color="#101211"/></radialGradient>';
  svg += '<radialGradient id="whiteStone" cx=".32" cy=".23" r=".84"><stop offset="0" stop-color="#fff"/><stop offset=".68" stop-color="#f1eee5"/><stop offset="1" stop-color="#d6d1c5"/></radialGradient>';
  svg += '<filter id="stoneShadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="2.1"/><feOffset dy="2.1"/><feComponentTransfer><feFuncA type="linear" slope=".28"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
  svg += "</defs>";
  svg += '<rect class="board-surface" x="23" y="23" width="574" height="574" rx="8"/>';
  svg += '<rect class="board-border" x="23.5" y="23.5" width="573" height="573" rx="8"/>';

  for (let i = 0; i < SIZE; i += 1) {
    const p = PAD + i * STEP;
    svg += '<line class="grid-line" x1="' + p + '" y1="' + PAD + '" x2="' + p + '" y2="' + (PAD + (SIZE - 1) * STEP) + '"/>';
    svg += '<line class="grid-line" x1="' + PAD + '" y1="' + p + '" x2="' + (PAD + (SIZE - 1) * STEP) + '" y2="' + p + '"/>';
  }
  for (const x of [3, 7, 11]) {
    for (const y of [3, 7, 11]) {
      const p = point(y * SIZE + x);
      svg += '<circle class="star-point" cx="' + p.x + '" cy="' + p.y + '" r="3.2"/>';
    }
  }

  for (let index = 0; index < board.length; index += 1) {
    const p = point(index);
    if (board[index]) {
      svg += '<circle cx="' + (p.x + .5) + '" cy="' + (p.y + 1.2) + '" r="14.3" fill="' +
        (board[index] === 1 ? "url(#blackStone)" : "url(#whiteStone)") +
        '" stroke="' + (board[index] === 1 ? "rgba(0,0,0,.58)" : "rgba(105,99,86,.36)") +
        '" stroke-width=".75" filter="url(#stoneShadow)"/>';
      if (index === lastMove) {
        svg += '<circle class="last-ring" cx="' + p.x + '" cy="' + p.y + '" r="5.3"/>';
      }
    } else {
      if (index === pendingIndex && !thinking && !winner) {
        svg += '<circle class="pending-ring" cx="' + p.x + '" cy="' + p.y + '" r="16"/>';
        svg += '<circle class="pending-stone" cx="' + p.x + '" cy="' + p.y + '" r="12.3" fill="url(#blackStone)" stroke="rgba(255,255,255,.8)" stroke-width=".8"/>';
      }
      if (!winner && !thinking && currentColor === 1) {
        svg += '<circle class="hit-target" cx="' + p.x + '" cy="' + p.y + '" r="17" data-index="' + index +
          '" role="button" aria-label="选择 ' + coordinate(index) + ' 落黑子" tabindex="-1"/>';
      }
    }
  }
  boardSvg.innerHTML = svg;
}

function updateStatus() {
  stateIndicator.className = "state-indicator" +
    (thinking ? " thinking" : winner ? " finished" : pendingIndex >= 0 ? " selected" : "");
  if (winner === 1) stateText.textContent = "你赢了";
  else if (winner === 2) stateText.textContent = "AI 获胜";
  else if (winner === 3) stateText.textContent = "平局";
  else if (thinking) stateText.textContent = "AI 思考中";
  else if (pendingIndex >= 0) stateText.textContent = "再点一次确认";
  else stateText.textContent = "轮到你落子";

  undoButton.disabled = thinking || history.length === 0;
  levelButton.disabled = thinking;
}

function updateLevelButton() {
  const profile = LEVELS[activeLevel - 1];
  levelButtonLabel.textContent = String(activeLevel).padStart(2, "0") + " · " + profile.name;
  levelButton.setAttribute("aria-label", "切换 AI 等级，当前" + activeLevel + "级 " + profile.name);
  for (const button of levelOptions.querySelectorAll("[data-level]")) {
    const selected = Number(button.dataset.level) === activeLevel;
    button.setAttribute("aria-pressed", String(selected));
  }
}

function render() {
  renderBoard();
  updateStatus();
}

function cancelSearch() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  requestId += 1;
  thinking = false;
}

function finishGame(result) {
  winner = result;
  pendingIndex = -1;
  thinking = false;
  worker?.terminate();
  worker = null;
  render();
}

function commitMove(index, color) {
  if (!Number.isInteger(index) || index < 0 || index >= board.length || board[index] || winner) return false;
  pendingIndex = -1;
  board[index] = color;
  history.push({ index, color });
  lastMove = index;

  if (hasFive(board, index % SIZE, Math.floor(index / SIZE), color)) {
    finishGame(color);
    return true;
  }
  if (history.length === board.length) {
    finishGame(3);
    return true;
  }

  currentColor = color === 1 ? 2 : 1;
  if (color === 1) {
    thinking = true;
    render();
    requestAnimationFrame(startSearch);
  } else {
    thinking = false;
    render();
  }
  return true;
}

function startSearch() {
  if (!thinking || winner) return;
  const id = ++requestId;
  const level = activeLevel;
  worker = new Worker(new URL("./engine.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = event => {
    const data = event.data;
    if (data.requestId !== requestId) return;
    worker?.terminate();
    worker = null;
    if (data.type === "error") {
      thinking = false;
      currentColor = 1;
      render();
      return;
    }
    commitMove(data.result.index, 2);
  };
  worker.onerror = () => {
    if (id !== requestId) return;
    worker?.terminate();
    worker = null;
    thinking = false;
    currentColor = 1;
    render();
  };
  worker.postMessage({ board: Array.from(board), level, requestId: id });
}

function playAt(index) {
  if (thinking || winner || currentColor !== 1 || !Number.isInteger(index) || board[index]) return;
  if (pendingIndex === index) {
    commitMove(index, 1);
    return;
  }
  pendingIndex = index;
  render();
}

function restart() {
  cancelSearch();
  board.fill(0);
  history.length = 0;
  currentColor = 1;
  winner = 0;
  lastMove = -1;
  pendingIndex = -1;
  render();
}

function undoRound() {
  if (thinking || history.length === 0) return;
  cancelSearch();
  pendingIndex = -1;
  if (history[history.length - 1]?.color === 2) {
    const aiMove = history.pop();
    board[aiMove.index] = 0;
  }
  if (history[history.length - 1]?.color === 1) {
    const humanMove = history.pop();
    board[humanMove.index] = 0;
  }
  winner = 0;
  currentColor = 1;
  lastMove = history.length ? history[history.length - 1].index : -1;
  render();
}

levelOptions.innerHTML = LEVELS.map((profile, index) => {
  const level = index + 1;
  return '<button class="level-option" type="button" data-level="' + level +
    '" aria-pressed="false"><span>' + String(level).padStart(2, "0") +
    '</span><strong>' + profile.name + "</strong></button>";
}).join("");

boardSvg.addEventListener("click", event => {
  const target = event.target.closest("[data-index]");
  const index = target ? Number(target.dataset.index) : nearestIntersection(event.clientX, event.clientY);
  if (index >= 0) playAt(index);
});
boardSvg.addEventListener("keydown", event => {
  const target = event.target.closest("[data-index]");
  if (target && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    playAt(Number(target.dataset.index));
  }
});
levelButton.addEventListener("click", () => {
  if (!thinking) levelDialog.showModal();
});
levelOptions.addEventListener("click", event => {
  const option = event.target.closest("[data-level]");
  if (!option) return;
  activeLevel = Number(option.dataset.level);
  updateLevelButton();
  levelDialog.close();
});
document.querySelector("#closeLevelDialog").addEventListener("click", () => levelDialog.close());
levelDialog.addEventListener("click", event => {
  if (event.target === levelDialog) levelDialog.close();
});
document.querySelector("#restartButton").addEventListener("click", restart);
undoButton.addEventListener("click", undoRound);

updateLevelButton();
render();
