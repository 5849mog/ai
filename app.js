import { SIZE, LEVELS, hasFive } from "./engine.js";

const PAD = 46;
const STEP = 528 / (SIZE - 1);
const COLS = "ABCDEFGHIJKLMNO";
const boardSvg = document.querySelector("#boardSvg");
const stateText = document.querySelector("#stateText");
const stateIndicator = document.querySelector("#stateIndicator");
const turnChip = document.querySelector("#turnChip");
const levelRange = document.querySelector("#levelRange");
const levelName = document.querySelector("#levelName");
const levelNumber = document.querySelector("#levelNumber");
const budgetBadge = document.querySelector("#budgetBadge");
const levelDescription = document.querySelector("#levelDescription");
const engineMessage = document.querySelector("#engineMessage");
const tracePulse = document.querySelector("#tracePulse");
const roundNumber = document.querySelector("#roundNumber");
const undoButton = document.querySelector("#undoButton");
const moveList = document.querySelector("#moveList");
const moveCount = document.querySelector("#moveCount");
const board = new Uint8Array(SIZE * SIZE);
const history = [];

let currentColor = 1;
let thinking = false;
let winner = 0;
let round = 1;
let worker = null;
let requestId = 0;
let aiStats = null;
let lastMove = -1;

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

function renderBoard() {
  let svg = "";
  svg += '<defs>';
  svg += '<linearGradient id="woodSurface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#edd5a0"/><stop offset=".48" stop-color="#e4c58e"/><stop offset="1" stop-color="#d8b47b"/></linearGradient>';
  svg += '<radialGradient id="blackStone" cx=".34" cy=".26" r=".8"><stop offset="0" stop-color="#555954"/><stop offset=".36" stop-color="#282b29"/><stop offset="1" stop-color="#101211"/></radialGradient>';
  svg += '<radialGradient id="whiteStone" cx=".32" cy=".23" r=".84"><stop offset="0" stop-color="#fff"/><stop offset=".68" stop-color="#f1eee5"/><stop offset="1" stop-color="#d6d1c5"/></radialGradient>';
  svg += '<filter id="stoneShadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="2.1"/><feOffset dy="2.1"/><feComponentTransfer><feFuncA type="linear" slope=".28"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
  svg += '</defs>';
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
      const isLast = index === lastMove;
      const colorName = board[index] === 1 ? "black" : "white";
      svg += '<circle cx="' + (p.x + .5) + '" cy="' + (p.y + 1.2) + '" r="14.3" fill="' +
        (board[index] === 1 ? "url(#blackStone)" : "url(#whiteStone)") +
        '" stroke="' + (board[index] === 1 ? "rgba(0,0,0,.58)" : "rgba(105,99,86,.36)") +
        '" stroke-width=".75" filter="url(#stoneShadow)"/>';
      if (isLast) svg += '<circle class="last-ring" cx="' + p.x + '" cy="' + p.y + '" r="5.2"/>';
      if (history.length <= 40) {
        svg += '<text class="move-number ' + (colorName === "white" ? "on-white " : "") +
          (isLast ? "last-number" : "") + '" x="' + p.x + '" y="' + (p.y + .3) + '">' +
          (history.findIndex(move => move.index === index) + 1) + '</text>';
      }
    } else if (!winner && !thinking && currentColor === 1) {
      svg += '<circle class="hit-target" cx="' + p.x + '" cy="' + p.y + '" r="17" data-index="' + index +
        '" role="button" aria-label="在 ' + coordinate(index) + ' 落黑子" tabindex="-1"/>';
    }
  }
  boardSvg.innerHTML = svg;
}

function updateStatus() {
  stateIndicator.className = "state-indicator" + (thinking ? " thinking" : winner ? " finished" : "");
  turnChip.className = "turn-chip" + (thinking ? " engine-turn" : winner ? " finished" : "");
  if (winner === 1) {
    stateText.textContent = "你赢下了这一局";
    turnChip.innerHTML = '<span class="turn-stone red"></span><span>YOU WIN</span>';
  } else if (winner === 2) {
    stateText.textContent = "引擎赢下了这一局";
    turnChip.innerHTML = '<span class="turn-stone red"></span><span>ENGINE WINS</span>';
  } else if (winner === 3) {
    stateText.textContent = "棋盘已满 · 平局";
    turnChip.innerHTML = '<span class="turn-stone red"></span><span>DRAW</span>';
  } else if (thinking) {
    stateText.textContent = "引擎正在计算";
    turnChip.innerHTML = '<span class="turn-stone white"></span><span>ENGINE THINKING</span>';
  } else {
    stateText.textContent = "轮到你落子";
    turnChip.innerHTML = '<span class="turn-stone black"></span><span>YOUR TURN</span>';
  }
  undoButton.disabled = thinking || history.length === 0;
  levelRange.disabled = thinking;
  roundNumber.textContent = String(round).padStart(2, "0");
}

function updateLevel() {
  const value = Number(levelRange.value);
  const profile = LEVELS[value - 1];
  levelName.textContent = profile.name;
  levelNumber.textContent = String(value).padStart(2, "0") + " / " + String(LEVELS.length).padStart(2, "0");
  budgetBadge.textContent = "MAX " + profile.ms.toLocaleString("en-US") + " ms";
  levelDescription.textContent =
    "≤ " + profile.ms.toLocaleString("en-US") + " ms 预算 · 候选宽度 " + profile.root +
    " · 威胁延伸 " + profile.extensions + " ply";
  levelRange.style.setProperty("--range-fill", ((value - 1) / (LEVELS.length - 1) * 100) + "%");
  levelRange.setAttribute("aria-valuetext", value + "级，" + profile.name);
}

function updateMetrics(stats = aiStats) {
  const depth = stats?.depth ?? 0;
  const nodes = stats?.nodes ?? 0;
  const hits = stats?.hits ?? 0;
  const elapsed = stats?.elapsed ?? 0;
  document.querySelector("#metricDepth").innerHTML = depth ? depth + '<small> ply</small>' : "—";
  document.querySelector("#metricNodes").textContent = nodes ? nodes.toLocaleString("en-US") : "—";
  document.querySelector("#metricHits").textContent = hits ? hits.toLocaleString("en-US") : "—";
  document.querySelector("#metricTime").innerHTML = elapsed ? elapsed + '<small> ms</small>' : "—";
  document.querySelector("#metricSpeed").textContent = stats?.nps
    ? stats.nps.toLocaleString("en-US") + " nodes / sec"
    : "不发送棋局数据";
  const fill = nodes ? Math.min(100, Math.max(8, Math.log10(nodes + 1) * 16)) : 0;
  document.querySelector("#nodesBarFill").style.width = fill + "%";
}

function renderHistory() {
  moveCount.textContent = history.length + " 手";
  if (!history.length) {
    moveList.innerHTML = '<div class="empty-history"><span class="empty-cross">＋</span><span>等待开局</span></div>';
    return;
  }
  const firstTurn = Math.max(0, Math.floor((history.length - 1) / 2) - 3);
  const rows = [];
  for (let turn = firstTurn; turn <= Math.floor((history.length - 1) / 2); turn += 1) {
    const blackMove = history[turn * 2];
    const whiteMove = history[turn * 2 + 1];
    if (!blackMove) continue;
    rows.push(
      '<div class="move-row"><span class="move-index">' + String(turn + 1).padStart(2, "0") +
      '</span><span class="move-side"><i class="turn-stone black"></i><b>' + coordinate(blackMove.index) +
      '</b></span><span class="move-side ai">' + (whiteMove
        ? '<i class="turn-stone white"></i><b>' + coordinate(whiteMove.index) + '</b>'
        : '<span>—</span>') + '</span></div>'
    );
  }
  moveList.innerHTML = rows.join("");
  moveList.scrollTop = moveList.scrollHeight;
}

function render() {
  renderBoard();
  updateStatus();
  renderHistory();
  updateMetrics();
}

function cancelSearch() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  requestId += 1;
  thinking = false;
  tracePulse.classList.remove("active");
}

function finishGame(result) {
  winner = result;
  thinking = false;
  tracePulse.classList.remove("active");
  worker?.terminate();
  worker = null;
  if (result === 1) engineMessage.textContent = "棋局结束 · 你完成了五连";
  else if (result === 2) engineMessage.textContent = "棋局结束 · 引擎完成了五连";
  else engineMessage.textContent = "棋局结束 · 棋盘已满";
  render();
}

function commitMove(index, color) {
  if (board[index] || winner) return false;
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
    engineMessage.textContent = "正在排序候选着法并加深搜索";
    tracePulse.classList.add("active");
    render();
    requestAnimationFrame(startSearch);
  } else {
    thinking = false;
    tracePulse.classList.remove("active");
    engineMessage.textContent = aiStats
      ? "引擎完成计算 · 深度 " + aiStats.depth + " ply"
      : "等待下一步棋";
    render();
  }
  return true;
}

function startSearch() {
  if (!thinking || winner) return;
  const id = ++requestId;
  const level = Number(levelRange.value);
  worker = new Worker(new URL("./engine.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = event => {
    const data = event.data;
    if (data.requestId !== requestId) return;
    worker?.terminate();
    worker = null;
    if (data.type === "error") {
      thinking = false;
      currentColor = 1;
      tracePulse.classList.remove("active");
      engineMessage.textContent = "引擎遇到问题 · " + data.message;
      render();
      return;
    }
    aiStats = data.result;
    const result = data.result;
    const label = result.reason === "win" ? "找到直接制胜点"
      : result.reason === "block" ? "识别并封住直接威胁"
        : "搜索完成 · " + result.nodes.toLocaleString("en-US") + " 个节点";
    engineMessage.textContent = label;
    commitMove(result.index, 2);
    updateMetrics(aiStats);
  };
  worker.onerror = () => {
    if (id !== requestId) return;
    worker?.terminate();
    worker = null;
    thinking = false;
    currentColor = 1;
    tracePulse.classList.remove("active");
    engineMessage.textContent = "引擎模块载入失败，请重新开局";
    render();
  };
  worker.postMessage({ board: Array.from(board), level, requestId: id });
}

function playAt(index) {
  if (thinking || winner || currentColor !== 1 || !Number.isInteger(index)) return;
  commitMove(index, 1);
}

function restart() {
  cancelSearch();
  board.fill(0);
  history.length = 0;
  currentColor = 1;
  winner = 0;
  lastMove = -1;
  aiStats = null;
  round += 1;
  engineMessage.textContent = "等待第一步棋";
  updateMetrics(null);
  render();
}

function undoRound() {
  if (thinking || history.length === 0) return;
  cancelSearch();
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
  aiStats = null;
  engineMessage.textContent = "已撤回一轮 · 轮到你落子";
  updateMetrics(null);
  render();
}

boardSvg.addEventListener("click", event => {
  const target = event.target.closest("[data-index]");
  if (target) playAt(Number(target.dataset.index));
});
boardSvg.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-index]")) {
    event.preventDefault();
    playAt(Number(event.target.dataset.index));
  }
});
levelRange.addEventListener("input", updateLevel);
document.querySelector("#restartButton").addEventListener("click", restart);
undoButton.addEventListener("click", undoRound);

updateLevel();
render();
