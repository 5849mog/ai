import { SIZE, LEVELS, hasFive } from "./engine.js";
import {
  SKILLS,
  applyPlayerMove,
  applyWhiteRemoval,
  captureTurnSnapshot,
  mirrorIndex,
  planPlayerMove,
  planWhiteRemoval,
  restoreTurnSnapshot
} from "./game-rules.js";

const PAD = 46;
const STEP = 528 / (SIZE - 1);
const COLS = "ABCDEFGHIJKLMNO";
const boardSvg = document.querySelector("#boardSvg");
const stateText = document.querySelector("#stateText");
const stateIndicator = document.querySelector("#stateIndicator");
const levelButton = document.querySelector("#levelButton");
const levelButtonLabel = document.querySelector("#levelButtonLabel");
const modeButton = document.querySelector("#modeButton");
const levelDialog = document.querySelector("#levelDialog");
const levelOptions = document.querySelector("#levelOptions");
const skillTray = document.querySelector("#skillTray");
const undoButton = document.querySelector("#undoButton");
const board = new Uint8Array(SIZE * SIZE);
const completedRounds = [];

const SKILL_LABELS = {
  double: "双星连落",
  mirror: "镜像",
  freeze: "冻结",
  removeWhite: "除白"
};

let currentColor = 1;
let thinking = false;
let winner = 0;
let worker = null;
let requestId = 0;
let lastMove = -1;
let pendingIndex = -1;
let activeLevel = 1;
let entertainmentMode = false;
let selectedSkill = null;
let selectedTargets = [];
let usedSkills = new Set();
let activeRound = null;
let extraMoveAvailable = false;
let awaitingMoveAfterSkill = false;
let engineError = false;
let statusMessage = "";

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

function canInteract() {
  return !thinking && !winner && !engineError && currentColor === 1;
}

function canUseSkills() {
  return entertainmentMode && canInteract() && !extraMoveAvailable && !awaitingMoveAfterSkill;
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
  svg += '<image class="wood-texture" href="./assets/board-wood.svg" xlink:href="./assets/board-wood.svg" x="23" y="23" width="574" height="574" preserveAspectRatio="none"/>';
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
      const stoneTexture = "./assets/stone-satin.svg";
      const stoneTone = board[index] === 1 ? "black" : "white";
      svg += '<image class="stone-texture ' + stoneTone + '" href="' + stoneTexture + '" xlink:href="' + stoneTexture +
        '" x="' + (p.x - 14.3) + '" y="' + (p.y - 14.3) + '" width="28.6" height="28.6" preserveAspectRatio="none"/>';
      if (index === lastMove) svg += '<circle class="last-ring" cx="' + p.x + '" cy="' + p.y + '" r="5.3"/>';
      if (selectedSkill === "removeWhite" && board[index] === 2 && canInteract()) {
        svg += '<circle class="remove-target' + (pendingIndex === index ? " pending" : "") + '" cx="' + p.x + '" cy="' + p.y + '" r="17"/>';
        svg += '<circle class="hit-target" cx="' + p.x + '" cy="' + p.y + '" r="17" data-index="' + index +
          '" role="button" aria-label="选择白子 ' + coordinate(index) + '" tabindex="-1"/>';
      }
      continue;
    }

    const confirmed = selectedSkill === "double" && selectedTargets.includes(index);
    if (confirmed) {
      svg += '<circle class="confirmed-ring" cx="' + p.x + '" cy="' + p.y + '" r="16"/>';
      svg += '<circle class="ghost-stone" cx="' + p.x + '" cy="' + p.y + '" r="12.3" fill="url(#blackStone)"/>';
    }
    if (pendingIndex === index && canInteract()) {
      svg += '<circle class="pending-ring" cx="' + p.x + '" cy="' + p.y + '" r="16"/>';
      svg += '<circle class="pending-stone" cx="' + p.x + '" cy="' + p.y + '" r="12.3" fill="url(#blackStone)"/>';
      if (selectedSkill === "mirror") {
        const other = mirrorIndex(index);
        const otherPoint = point(other);
        if (other !== index && board[other] === 0) {
          svg += '<circle class="mirror-ghost" cx="' + otherPoint.x + '" cy="' + otherPoint.y + '" r="12.3"/>';
        } else {
          svg += '<circle class="mirror-blocked" cx="' + otherPoint.x + '" cy="' + otherPoint.y + '" r="15"/>';
          svg += '<path class="mirror-blocked-mark" d="M ' + (otherPoint.x - 4) + ' ' + (otherPoint.y - 4) + ' l 8 8 m 0 -8 l -8 8"/>';
        }
      }
    }
    if (canInteract() && selectedSkill !== "removeWhite") {
      svg += '<circle class="hit-target" cx="' + p.x + '" cy="' + p.y + '" r="17" data-index="' + index +
        '" role="button" aria-label="选择 ' + coordinate(index) + ' 落黑子" tabindex="-1"/>';
    }
  }
  boardSvg.innerHTML = svg;
}

function currentStatus() {
  if (winner === 1) return "你赢了";
  if (winner === 2) return "AI 获胜";
  if (winner === 3) return "平局";
  if (thinking) return "AI 思考中";
  if (engineError) return "AI 暂不可用";
  if (statusMessage) return statusMessage;
  if (selectedSkill === "double") {
    if (pendingIndex >= 0) return "再点确认";
    return selectedTargets.length ? "选择第 2 枚" : "选择第 1 枚";
  }
  if (selectedSkill === "mirror") return pendingIndex >= 0 ? "再点确认" : "选择镜像落点";
  if (selectedSkill === "freeze") return pendingIndex >= 0 ? "再点确认" : "选择冻结落点";
  if (selectedSkill === "removeWhite") return pendingIndex >= 0 ? "再点确认" : "选择一枚白子";
  if (extraMoveAvailable) return "额外落子";
  if (awaitingMoveAfterSkill) return "轮到你落子";
  if (pendingIndex >= 0) return "再点确认";
  return "轮到你落子";
}

function updateStatus() {
  stateIndicator.className = "state-indicator" +
    (thinking ? " thinking" : winner || engineError ? " finished" : pendingIndex >= 0 || selectedSkill ? " selected" : "");
  stateText.textContent = currentStatus();
  const hasTransientSelection = pendingIndex >= 0 || selectedSkill || selectedTargets.length > 0;
  undoButton.disabled = thinking || !(hasTransientSelection || activeRound || completedRounds.length);
  levelButton.disabled = thinking;
  modeButton.disabled = thinking || board.some(Boolean) || Boolean(activeRound) || completedRounds.length > 0;
  modeButton.setAttribute("aria-pressed", String(entertainmentMode));
  modeButton.classList.toggle("is-active", entertainmentMode);
  document.querySelector(".app-shell").classList.toggle("entertainment-mode", entertainmentMode);

  for (const button of skillTray.querySelectorAll("[data-skill]")) {
    const skill = button.dataset.skill;
    const selected = skill === selectedSkill;
    const removeUnavailable = skill === "removeWhite" && !board.includes(2);
    const canChoose = canUseSkills() && !usedSkills.has(skill) && !removeUnavailable;
    button.disabled = !selected && !canChoose;
    button.classList.toggle("is-selected", selected);
    button.classList.toggle("is-used", usedSkills.has(skill));
    button.setAttribute("aria-pressed", String(selected));
    const charge = button.querySelector(".skill-charge");
    charge.textContent = usedSkills.has(skill) ? "✓" : "1";
  }
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

function clearSelection() {
  selectedSkill = null;
  selectedTargets = [];
  pendingIndex = -1;
  statusMessage = "";
}

function beginRound() {
  if (!activeRound) activeRound = captureTurnSnapshot(board, usedSkills, lastMove);
}

function completeRound() {
  if (activeRound) {
    completedRounds.push(activeRound);
    activeRound = null;
  }
  extraMoveAvailable = false;
  awaitingMoveAfterSkill = false;
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
  clearSelection();
  cancelSearch();
  completeRound();
  render();
}

function placementWins(placements) {
  return placements.some(index => hasFive(board, index % SIZE, Math.floor(index / SIZE), 1));
}

function checkFullBoard() {
  return board.every(value => value !== 0);
}

function commitPlayerAction(skillId, selected) {
  const plan = planPlayerMove(board, skillId, selected);
  if (!plan.ok) {
    statusMessage = plan.error;
    render();
    return false;
  }

  beginRound();
  const applied = applyPlayerMove(board, skillId, selected);
  if (!applied.ok) {
    statusMessage = applied.error;
    render();
    return false;
  }
  if (applied.consumedSkill) usedSkills.add(applied.consumedSkill);
  lastMove = applied.placements[applied.placements.length - 1];
  clearSelection();

  if (placementWins(applied.placements)) {
    finishGame(1);
    return true;
  }
  if (checkFullBoard()) {
    finishGame(3);
    return true;
  }
  if (applied.skipAI) {
    extraMoveAvailable = true;
    currentColor = 1;
    render();
    return true;
  }

  extraMoveAvailable = false;
  awaitingMoveAfterSkill = false;
  currentColor = 2;
  thinking = true;
  render();
  requestAnimationFrame(startSearch);
  return true;
}

function failSearch() {
  worker?.terminate();
  worker = null;
  thinking = false;
  currentColor = 1;
  engineError = true;
  statusMessage = "撤回或重新开局";
  render();
}

function startSearch() {
  if (!thinking || winner || engineError) return;
  const id = ++requestId;
  const level = activeLevel;
  try {
    worker = new Worker(new URL("./engine.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = event => {
      const data = event.data;
      if (data.requestId !== requestId) return;
      worker?.terminate();
      worker = null;
      if (data.type === "error" || !data.result || !Number.isInteger(data.result.index) ||
          data.result.index < 0 || data.result.index >= board.length || board[data.result.index] !== 0) {
        failSearch();
        return;
      }

      const index = data.result.index;
      board[index] = 2;
      lastMove = index;
      thinking = false;
      if (hasFive(board, index % SIZE, Math.floor(index / SIZE), 2)) {
        finishGame(2);
        return;
      }
      if (checkFullBoard()) {
        finishGame(3);
        return;
      }
      currentColor = 1;
      completeRound();
      render();
    };
    worker.onerror = () => {
      if (id !== requestId) return;
      failSearch();
    };
    worker.postMessage({ board: Array.from(board), level, requestId: id });
  } catch {
    failSearch();
  }
}

function commitRemoval(index) {
  const check = planWhiteRemoval(board, index);
  if (!check.ok) {
    statusMessage = check.error;
    pendingIndex = -1;
    render();
    return false;
  }
  beginRound();
  const plan = applyWhiteRemoval(board, index);
  if (!plan.ok) {
    statusMessage = plan.error;
    render();
    return false;
  }
  usedSkills.add("removeWhite");
  if (lastMove === index) lastMove = -1;
  awaitingMoveAfterSkill = true;
  currentColor = 1;
  clearSelection();
  render();
  return true;
}

function selectSkillTarget(index) {
  statusMessage = "";
  if (selectedSkill === "removeWhite") {
    if (board[index] !== 2) {
      statusMessage = "只能选择白子";
      render();
      return;
    }
    if (pendingIndex === index) {
      commitRemoval(index);
      return;
    }
    pendingIndex = index;
    render();
    return;
  }

  if (board[index] !== 0) {
    statusMessage = "该位置已被占用";
    render();
    return;
  }
  if (selectedSkill === "double" && selectedTargets.includes(index)) {
    statusMessage = "请选择另一个位置";
    render();
    return;
  }
  if (pendingIndex !== index) {
    pendingIndex = index;
    render();
    return;
  }

  if (selectedSkill === "double" && selectedTargets.length === 0) {
    selectedTargets = [index];
    pendingIndex = -1;
    render();
    return;
  }

  const selected = selectedSkill === "double" ? [...selectedTargets, index] : [index];
  const plan = planPlayerMove(board, selectedSkill, selected);
  if (!plan.ok) {
    statusMessage = plan.error;
    pendingIndex = -1;
    render();
    return;
  }
  commitPlayerAction(selectedSkill, selected);
}

function playAt(index) {
  if (!canInteract() || !Number.isInteger(index) || index < 0 || index >= board.length) return;
  if (selectedSkill) {
    selectSkillTarget(index);
    return;
  }
  if (board[index]) return;
  statusMessage = "";
  if (pendingIndex === index) {
    const usesExtraMove = extraMoveAvailable;
    commitPlayerAction(null, [index]);
    if (usesExtraMove && !winner && !thinking) {
      extraMoveAvailable = false;
      awaitingMoveAfterSkill = false;
    }
    return;
  }
  pendingIndex = index;
  render();
}

function restart() {
  cancelSearch();
  board.fill(0);
  completedRounds.length = 0;
  activeRound = null;
  usedSkills = new Set();
  currentColor = 1;
  winner = 0;
  lastMove = -1;
  extraMoveAvailable = false;
  awaitingMoveAfterSkill = false;
  engineError = false;
  clearSelection();
  render();
}

function undoRound() {
  if (thinking) return;
  cancelSearch();
  if (pendingIndex >= 0 || selectedSkill || selectedTargets.length) {
    clearSelection();
    render();
    return;
  }

  const snapshot = activeRound || completedRounds.pop();
  if (!snapshot) return;
  activeRound = null;
  const restored = restoreTurnSnapshot(board, snapshot);
  usedSkills = restored.usedSkills;
  lastMove = restored.lastMove;
  winner = 0;
  currentColor = 1;
  extraMoveAvailable = false;
  awaitingMoveAfterSkill = false;
  engineError = false;
  statusMessage = "";
  render();
}

levelOptions.innerHTML = LEVELS.map((profile, index) => {
  const level = index + 1;
  return '<button class="level-option" type="button" data-level="' + level +
    '" aria-pressed="false"><span>' + String(level).padStart(2, "0") +
    '</span><strong>' + profile.name + "</strong></button>";
}).join("");

skillTray.addEventListener("click", event => {
  const button = event.target.closest("[data-skill]");
  if (!button || button.disabled) return;
  const skill = button.dataset.skill;
  if (selectedSkill === skill) {
    clearSelection();
  } else {
    selectedSkill = skill;
    selectedTargets = [];
    pendingIndex = -1;
    statusMessage = "";
  }
  render();
});

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
modeButton.addEventListener("click", () => {
  if (modeButton.disabled) return;
  entertainmentMode = !entertainmentMode;
  clearSelection();
  render();
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
