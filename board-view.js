import { SIZE } from "./engine.js";
import { mirrorIndex } from "./game-rules.js";

const PAD = 46;
const STEP = 528 / (SIZE - 1);
const COLS = "ABCDEFGHIJKLMNO";

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

function nearestIntersection(boardSvg, clientX, clientY) {
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

function renderBoard(boardSvg, state) {
  const { board, lastMove, pendingIndex, selectedSkill, selectedTargets, canInteract } = state;
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
      if (selectedSkill === "removeWhite" && board[index] === 2 && canInteract) {
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
    if (pendingIndex === index && canInteract) {
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
    if (canInteract && selectedSkill !== "removeWhite") {
      svg += '<circle class="hit-target" cx="' + p.x + '" cy="' + p.y + '" r="17" data-index="' + index +
        '" role="button" aria-label="选择 ' + coordinate(index) + ' 落黑子" tabindex="-1"/>';
    }
  }
  boardSvg.innerHTML = svg;
}

export function createBoardView(boardSvg) {
  return {
    nearestIntersection(clientX, clientY) {
      return nearestIntersection(boardSvg, clientX, clientY);
    },
    render(state) {
      renderBoard(boardSvg, state);
    }
  };
}
