import { SIZE, CELL_COUNT, BLACK, WHITE, validIndex, outcome, snapshot, restore } from "./game-rules.js";
import { createBoardView } from "./board-view.js";
import { GomokuEngine } from "./engine.js";
import { describeSearch } from "./search-info.js";

const boardSvg = document.querySelector("#boardSvg");
const view = createBoardView(boardSvg);
const stateText = document.querySelector("#stateText");
const stateIndicator = document.querySelector("#stateIndicator");
const timeSelect = document.querySelector("#timeSelect");
const colorSelect = document.querySelector("#colorSelect");
const ponderToggle = document.querySelector("#ponderToggle");
const undoButton = document.querySelector("#undoButton");
const retryButton = document.querySelector("#retryButton");
const searchClock = document.querySelector("#searchClock");
const board = new Uint8Array(CELL_COUNT);
const rounds = [];
let currentColor = BLACK;
let playerColor = BLACK;
let winner = 0;
let lastMove = -1;
let pendingIndex = -1;
let hoverIndex = -1;
let keyboardIndex = 7 * SIZE + 7;
let pointerType = "mouse";
let thinking = false;
let state = "loading";
let loadingProgress;
let requestId = 0;
let searchStarted = 0;
let clockTimer;
let lastResult = null;
let liveStats = null;
let statsSide = WHITE;
let statsPhase = "search";
let statsTimer;
let pondering = false;

try {
  const savedTime = localStorage.getItem("gomoku-thinking-ms");
  if ([...timeSelect.options].some(option => option.value === savedTime)) timeSelect.value = savedTime;
  const savedColor = localStorage.getItem("gomoku-player-color");
  if (["1", "2"].includes(savedColor)) playerColor = Number(savedColor);
  colorSelect.value = String(playerColor);
  ponderToggle.checked = localStorage.getItem("gomoku-pondering") !== "false";
} catch { /* storage can be unavailable */ }

const engine = new GomokuEngine({ onState: event => {
  state = event.state;
  loadingProgress = event.progress;
  pondering = Boolean(event.pondering);
  render();
}, onStats: event => {
  liveStats = event.stats;
  statsSide = event.sideToMove;
  statsPhase = event.phase;
  if (!statsTimer) statsTimer = setTimeout(() => { statsTimer = null; updateSearchInfo(); }, 100);
} });

function canInteract() { return state === "ready" && !thinking && !winner && currentColor === playerColor; }

function render() {
  const interactive = canInteract();
  view.render({ board, lastMove, pendingIndex, hoverIndex, canInteract: interactive, playerColor });
  let text = "轮到你落子";
  if (winner) text = winner === playerColor ? "你赢了" : winner === 3 ? "平局" : "AI 获胜";
  else if (state === "error") text = "AI 暂不可用，请重试或悔棋";
  else if (state === "loading" || state === "idle") text = Number.isFinite(loadingProgress)
    ? `正在加载 AI · ${Math.round(loadingProgress * 100)}%` : "正在准备 AI";
  else if (thinking) text = "AI 思考中";
  else if (pendingIndex >= 0) text = "再点一次确认落子";
  stateText.textContent = text;
  stateIndicator.className = "state-indicator" +
    (thinking || state === "loading" || state === "idle" ? " thinking" : winner || state === "error" ? " finished" : "");
  undoButton.disabled = rounds.length === 0 && pendingIndex < 0;
  retryButton.hidden = state !== "error";
  timeSelect.disabled = thinking;
  boardSvg.setAttribute("aria-disabled", String(!interactive));
  boardSvg.setAttribute("aria-label", `15 乘 15 五子棋棋盘，${text}。方向键选点，回车落子。`);
  updateClock();
  updateSearchInfo();
}

function updateClock() {
  searchClock.textContent = thinking
    ? `${((performance.now() - searchStarted) / 1000).toFixed(1)} 秒`
    : lastResult ? `上一步 ${(lastResult.elapsed / 1000).toFixed(1)} 秒`
    : `你执${playerColor === BLACK ? "黑 · 先手" : "白 · AI 先手"} · 无禁手`;
}

function stopClock() { clearInterval(clockTimer); clockTimer = null; }

function updateSearchInfo() {
  const info = describeSearch(liveStats, statsSide, 3 - playerColor);
  document.querySelector("#searchDepth").textContent = info.depth;
  document.querySelector("#searchScore").textContent = info.score;
  document.querySelector("#searchNodes").textContent = info.nodes;
  document.querySelector("#searchSpeed").textContent = info.speed;
  document.querySelector("#analysisState").textContent = thinking ? "AI 搜索中"
    : pondering ? "AI 后台思考中" : !liveStats ? "AI 搜索信息"
    : statsPhase === "ponder" ? "最近后台分析" : "上次搜索";
}

async function syncPonder() {
  if (!canInteract() || !ponderToggle.checked || document.hidden) { engine.stopPonder(); return; }
  if (engine.pondering) return;
  try { await engine.ponder({ board, sideToMove: playerColor, requestId: ++requestId }); }
  catch (error) { if (error.name !== "AbortError") render(); }
}

async function prepareEngine() {
  try {
    await engine.init();
    if (!winner && currentColor !== playerColor && !thinking) await startSearch();
    else if (!thinking) await syncPonder();
  } catch (error) { if (error.name !== "AbortError") render(); }
}

async function startSearch() {
  if (thinking || winner || currentColor === playerColor) return;
  engine.stopPonder();
  const id = ++requestId;
  thinking = true;
  pondering = false;
  liveStats = null;
  statsPhase = "search";
  statsSide = 3 - playerColor;
  hoverIndex = pendingIndex = -1;
  searchStarted = performance.now();
  stopClock();
  clockTimer = setInterval(updateClock, 100);
  render();
  try {
    const result = await engine.search({ board, sideToMove: 3 - playerColor, timeMs: Number(timeSelect.value), requestId: id });
    if (id !== requestId || winner || currentColor === playerColor) return;
    if (!validIndex(result.index) || board[result.index]) throw new Error("无效落点");
    board[result.index] = 3 - playerColor;
    lastMove = result.index;
    lastResult = result;
    liveStats = result;
    winner = outcome(board, lastMove);
    currentColor = playerColor;
  } catch (error) {
    if (id !== requestId || error.name === "AbortError") return;
    state = "error";
  } finally {
    if (id === requestId) { thinking = false; stopClock(); render(); void syncPonder(); }
  }
}

function place(index) {
  if (!canInteract() || !validIndex(index) || board[index]) return;
  rounds.push(snapshot(board, lastMove));
  engine.stopPonder();
  board[index] = playerColor;
  lastMove = index;
  pendingIndex = hoverIndex = -1;
  winner = outcome(board, index);
  if (winner) { render(); return; }
  currentColor = 3 - playerColor;
  void startSearch();
}

function selectedIndex(event) {
  const cell = event.target.closest("[data-index]");
  return cell ? Number(cell.dataset.index) : view.nearestIntersection(event.clientX, event.clientY);
}

function invalidateSearch() {
  requestId += 1;
  thinking = false;
  stopClock();
  engine.reset();
  state = "idle";
  pondering = false;
  liveStats = null;
  clearTimeout(statsTimer); statsTimer = null;
  pendingIndex = hoverIndex = -1;
}

function undo() {
  if (pendingIndex >= 0 && !thinking) { pendingIndex = -1; render(); return; }
  const saved = rounds.pop();
  if (!saved) return;
  invalidateSearch();
  lastMove = restore(board, saved);
  currentColor = playerColor;
  winner = 0;
  lastResult = null;
  render();
  void prepareEngine();
}

function restart() {
  invalidateSearch();
  board.fill(0);
  rounds.length = 0;
  currentColor = BLACK;
  winner = 0;
  lastMove = -1;
  keyboardIndex = 7 * SIZE + 7;
  lastResult = null;
  render();
  void prepareEngine();
}

boardSvg.addEventListener("pointerdown", event => { pointerType = event.pointerType; });
boardSvg.addEventListener("pointermove", event => {
  if (event.pointerType !== "mouse" || !canInteract()) return;
  const index = selectedIndex(event);
  const next = validIndex(index) && !board[index] ? index : -1;
  if (hoverIndex !== next) { hoverIndex = next; render(); }
});
boardSvg.addEventListener("pointerleave", () => { if (hoverIndex >= 0) { hoverIndex = -1; render(); } });
boardSvg.addEventListener("click", event => {
  if (!canInteract()) return;
  const index = selectedIndex(event);
  if (!validIndex(index) || board[index]) return;
  if ((event.pointerType || pointerType) !== "mouse" && event.detail !== 0 && pendingIndex !== index) {
    pendingIndex = index;
    hoverIndex = -1;
    render();
  } else place(index);
});
boardSvg.addEventListener("keydown", event => {
  if (!canInteract()) return;
  const x = keyboardIndex % SIZE;
  const y = Math.floor(keyboardIndex / SIZE);
  const shifts = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (shifts[event.key]) {
    event.preventDefault();
    const [dx, dy] = shifts[event.key];
    keyboardIndex = Math.max(0, Math.min(SIZE - 1, y + dy)) * SIZE + Math.max(0, Math.min(SIZE - 1, x + dx));
    hoverIndex = board[keyboardIndex] ? -1 : keyboardIndex;
    render();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault(); place(keyboardIndex);
  } else if (event.key === "Escape") { pendingIndex = hoverIndex = -1; render(); }
});
timeSelect.addEventListener("change", () => {
  try { localStorage.setItem("gomoku-thinking-ms", timeSelect.value); } catch { /* optional preference */ }
});
colorSelect.addEventListener("change", () => {
  playerColor = Number(colorSelect.value);
  try { localStorage.setItem("gomoku-player-color", colorSelect.value); } catch { /* optional preference */ }
  restart();
});
ponderToggle.addEventListener("change", () => {
  try { localStorage.setItem("gomoku-pondering", String(ponderToggle.checked)); } catch { /* optional preference */ }
  void syncPonder();
});
document.addEventListener("visibilitychange", () => { void syncPonder(); });
undoButton.addEventListener("click", undo);
document.querySelector("#restartButton").addEventListener("click", restart);
retryButton.addEventListener("click", () => { engine.reset(); void prepareEngine(); });

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("./sw.js", import.meta.url), { scope: "./" })
    .then(() => {
      document.querySelector("#offlineState").textContent = "资源缓存后可离线使用";
      navigator.serviceWorker.controller?.postMessage({ type: "offline-status" });
    })
    .catch(() => { /* local computation also works without a service worker */ });
  navigator.serviceWorker.addEventListener("message", ({ data }) => {
    if (data.type === "offline-ready") document.querySelector("#offlineState").textContent = "已缓存 · 可离线使用";
  });
}

render();
void prepareEngine();
