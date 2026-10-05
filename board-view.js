import { SIZE, winningLines } from "./game-rules.js";

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

function renderBoard(boardSvg, state, idPrefix) {
  const { board, lastMove, pendingIndex, hoverIndex = -1, canInteract, playerColor = 1, recommendations = [], editable = false } = state;
  const previewFill = playerColor === 1 ? "url(#blackStone)" : "url(#whiteStone)";
  const lines = editable ? [] : winningLines(board, lastMove);
  let svg = "";
  svg += "<defs>";
  svg += '<linearGradient id="woodSurface" x1=".1" y1="0" x2=".86" y2="1"><stop offset="0" stop-color="#f0e1bb"/><stop offset=".48" stop-color="#e8d6ad"/><stop offset="1" stop-color="#deca9f"/></linearGradient>';
  svg += '<radialGradient id="blackStone" cx=".32" cy=".22" r=".8"><stop offset="0" stop-color="#686961"/><stop offset=".24" stop-color="#3a3d36"/><stop offset=".62" stop-color="#22251f"/><stop offset="1" stop-color="#10130f"/></radialGradient>';
  svg += '<radialGradient id="whiteStone" cx=".3" cy=".2" r=".86"><stop offset="0" stop-color="#fffffb"/><stop offset=".5" stop-color="#faf9f0"/><stop offset=".78" stop-color="#e9e6da"/><stop offset="1" stop-color="#c9c4b5"/></radialGradient>';
  svg += '<filter id="stoneShadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="1.4"/><feOffset dy="2.5"/><feComponentTransfer><feFuncA type="linear" slope=".3"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
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

  for (const line of lines) {
    const start = point(line[0]), end = point(line.at(-1));
    svg += `<line class="winning-connector" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"/>`;
  }
  for (let index = 0; index < board.length; index += 1) {
    const p = point(index);
    if (board[index]) {
      svg += '<circle data-stone="' + index + '" data-color="' + board[index] + '" cx="' + (p.x + .5) + '" cy="' + (p.y + 1.2) + '" r="14.3" fill="' +
        (board[index] === 1 ? "url(#blackStone)" : "url(#whiteStone)") +
        '" stroke="' + (board[index] === 1 ? "rgba(0,0,0,.58)" : "rgba(105,99,86,.36)") +
        '" stroke-width=".75" filter="url(#stoneShadow)"/>';
      const stoneTexture = "./assets/stone-satin.svg";
      const stoneTone = board[index] === 1 ? "black" : "white";
      svg += '<image class="stone-texture ' + stoneTone + '" href="' + stoneTexture + '" xlink:href="' + stoneTexture +
        '" x="' + (p.x - 14.3) + '" y="' + (p.y - 14.3) + '" width="28.6" height="28.6" preserveAspectRatio="none"/>';
      if (index === lastMove) svg += '<circle class="last-ring" cx="' + p.x + '" cy="' + p.y + '" r="5.3"/>';
      if (!editable) continue;
    }

    if (!board[index] && hoverIndex === index && pendingIndex !== index && canInteract) {
      svg += '<circle class="hover-stone" cx="' + p.x + '" cy="' + p.y + '" r="12.3" fill="' + previewFill + '"/>';
    }
    if (!board[index] && pendingIndex === index && canInteract) {
      svg += '<circle class="pending-ring" cx="' + p.x + '" cy="' + p.y + '" r="16"/>';
      svg += '<circle class="pending-stone" cx="' + p.x + '" cy="' + p.y + '" r="12.3" fill="' + previewFill + '"/>';
    }
    const rank = recommendations.slice(0, 2).findIndex(move => move.index === index);
    if (rank >= 0) {
      svg += '<g class="recommendation-marker ' + (rank === 0 ? 'first' : 'second') + '" data-recommendation="' + index + '" data-rank="' + (rank + 1) + '" aria-label="' + (rank === 0 ? '首选 ' : '次选 ') + coordinate(index) + '">';
      svg += '<circle class="recommendation-ring" cx="' + p.x + '" cy="' + p.y + '" r="14"/>';
      svg += '<text class="recommendation-number" x="' + p.x + '" y="' + p.y + '">' + (rank + 1) + '</text></g>';
    }
    if (canInteract) {
      svg += '<circle class="hit-target" cx="' + p.x + '" cy="' + p.y + '" r="17" data-index="' + index +
        '" role="button" aria-label="' + (editable ? '编辑 ' + coordinate(index) : '选择 ' + coordinate(index) + (playerColor === 1 ? ' 落黑子' : ' 落白子')) + '" tabindex="-1"/>';
    }
  }
  for (const index of new Set(lines.flat())) {
    const p = point(index);
    svg += `<circle class="winning-ring" data-winning-stone="${index}" cx="${p.x}" cy="${p.y}" r="17"/>`;
  }
  // A dialog preview shares the page with the live board. Its SVG paint servers
  // need separate IDs so a hidden preview cannot shadow the live gradients.
  if (idPrefix) {
    svg = svg.replace(/id="(woodSurface|blackStone|whiteStone|stoneShadow)"/g, (_, id) => `id="${idPrefix}${id}"`)
      .replace(/url\(#(woodSurface|blackStone|whiteStone|stoneShadow)\)/g, (_, id) => `url(#${idPrefix}${id})`)
      .replace('class="board-surface"', `class="board-surface" style="fill:url(#${idPrefix}woodSurface)"`);
  }
  boardSvg.innerHTML = svg;
}

export function createBoardView(boardSvg, { idPrefix = "" } = {}) {
  if (!/^[a-zA-Z0-9_-]*$/.test(idPrefix)) throw new Error("无效的棋盘标识");
  return {
    nearestIntersection(clientX, clientY) {
      return nearestIntersection(boardSvg, clientX, clientY);
    },
    render(state) {
      renderBoard(boardSvg, state, idPrefix);
    }
  };
}
