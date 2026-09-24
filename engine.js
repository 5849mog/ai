export const SIZE = 15;
const CELL_COUNT = SIZE * SIZE;
const CENTER = (SIZE - 1) / 2;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const MATE = 1_000_000_000;

// Every level uses this complete tactical/search stack. Higher levels widen
// the root and continuation search and grant more time to iterative deepening.
export const LEVELS = [
  { name: "初见", ms: 24, root: 5, branch: 3, depth: 2, extensions: 2 },
  { name: "入门", ms: 36, root: 6, branch: 3, depth: 3, extensions: 2 },
  { name: "熟练", ms: 52, root: 7, branch: 4, depth: 3, extensions: 2 },
  { name: "进阶", ms: 76, root: 8, branch: 4, depth: 4, extensions: 3 },
  { name: "老手", ms: 108, root: 9, branch: 5, depth: 4, extensions: 3 },
  { name: "强手", ms: 154, root: 10, branch: 5, depth: 5, extensions: 3 },
  { name: "专家", ms: 218, root: 11, branch: 6, depth: 5, extensions: 4 },
  { name: "大师", ms: 310, root: 12, branch: 6, depth: 6, extensions: 4 },
  { name: "竞赛", ms: 440, root: 13, branch: 7, depth: 6, extensions: 5 },
  { name: "王牌", ms: 620, root: 14, branch: 7, depth: 7, extensions: 5 },
  { name: "巅峰", ms: 870, root: 15, branch: 8, depth: 7, extensions: 6 },
  { name: "极限", ms: 1_200, root: 16, branch: 8, depth: 8, extensions: 6 }
];

const WIN_SCORE = 1_000_000;
const RUN_SCORE = {
  1: [0, 8, 28],
  2: [0, 55, 240],
  3: [0, 520, 5_600],
  4: [0, 18_000, 125_000],
  5: [WIN_SCORE, WIN_SCORE, WIN_SCORE]
};
const BROKEN_SCORE = [0, 0, 0, 1_300, 32_000, WIN_SCORE];

function makeZobrist() {
  let seed = 0x79b9_7a4d;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  return Array.from({ length: CELL_COUNT }, () => [0, next(), next()]);
}

const ZOBRIST = makeZobrist();
const SIDE_KEY = 0x6d2b_79f5;
const table = new Map();

function other(color) {
  return color === 1 ? 2 : 1;
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function boardHash(board) {
  let hash = 0;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const color = board[i];
    if (color) hash ^= ZOBRIST[i][color];
  }
  return hash >>> 0;
}

export function hasFive(board, x, y, color) {
  for (const [dx, dy] of DIRS) {
    let count = 1;
    for (let sign = -1; sign <= 1; sign += 2) {
      let cx = x + dx * sign;
      let cy = y + dy * sign;
      while (
        cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE &&
        board[cy * SIZE + cx] === color
      ) {
        count += 1;
        cx += dx * sign;
        cy += dy * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

function candidatesFor(board) {
  let hasStone = false;
  const seen = new Uint8Array(CELL_COUNT);
  const moves = [];
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (!board[i]) continue;
    hasStone = true;
    const x = i % SIZE;
    const y = (i / SIZE) | 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
        const index = ny * SIZE + nx;
        if (!board[index] && !seen[index]) {
          seen[index] = 1;
          moves.push(index);
        }
      }
    }
  }
  if (!hasStone) return [CENTER * SIZE + CENTER];
  return moves;
}

function lineRunValue(length, openEnds) {
  if (length >= 5) return WIN_SCORE;
  if (length <= 0 || openEnds <= 0) return 0;
  return RUN_SCORE[length]?.[openEnds] ?? 0;
}

function localPotential(board, index, color) {
  const x = index % SIZE;
  const y = (index / SIZE) | 0;
  board[index] = color;
  let score = 0;
  for (const [dx, dy] of DIRS) {
    let length = 1;
    let open = 0;
    for (let sign = -1; sign <= 1; sign += 2) {
      let cx = x + dx * sign;
      let cy = y + dy * sign;
      while (
        cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE &&
        board[cy * SIZE + cx] === color
      ) {
        length += 1;
        cx += dx * sign;
        cy += dy * sign;
      }
      if (
        cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE &&
        board[cy * SIZE + cx] === 0
      ) open += 1;
    }
    score += lineRunValue(length, open);
  }
  board[index] = 0;
  return score;
}

function movePriority(board, index, color) {
  const attack = localPotential(board, index, color);
  const defense = localPotential(board, index, other(color));
  const x = index % SIZE;
  const y = (index / SIZE) | 0;
  const center = 26 - (Math.abs(x - CENTER) + Math.abs(y - CENTER)) * 1.6;
  return attack + defense * 1.08 + center;
}

function immediateWins(board, color, candidates = candidatesFor(board)) {
  const wins = [];
  for (const index of candidates) {
    board[index] = color;
    const win = hasFive(board, index % SIZE, (index / SIZE) | 0, color);
    board[index] = 0;
    if (win) wins.push(index);
  }
  return wins;
}

export function findImmediateWins(boardInput, color) {
  return immediateWins(Uint8Array.from(boardInput), color);
}

function scoreRunsOnLine(board, startX, startY, dx, dy, color) {
  let score = 0;
  let x = startX;
  let y = startY;
  let run = 0;
  let previous = 0;
  let runStartX = -1;
  let runStartY = -1;
  while (x >= 0 && x < SIZE && y >= 0 && y < SIZE) {
    const current = board[y * SIZE + x];
    if (current === color) {
      if (run === 0) {
        runStartX = x;
        runStartY = y;
      }
      run += 1;
    } else {
      if (previous === color) {
        const beforeX = runStartX - dx;
        const beforeY = runStartY - dy;
        const beforeOpen = beforeX >= 0 && beforeX < SIZE && beforeY >= 0 && beforeY < SIZE &&
          board[beforeY * SIZE + beforeX] === 0;
        const afterOpen = current === 0;
        score += lineRunValue(run, Number(beforeOpen) + Number(afterOpen));
      }
      run = 0;
    }
    previous = current;
    x += dx;
    y += dy;
  }
  if (previous === color) {
    const beforeX = runStartX - dx;
    const beforeY = runStartY - dy;
    const beforeOpen = beforeX >= 0 && beforeX < SIZE && beforeY >= 0 && beforeY < SIZE &&
      board[beforeY * SIZE + beforeX] === 0;
    score += lineRunValue(run, Number(beforeOpen));
  }
  return score;
}

function evaluateColor(board, color) {
  let score = 0;
  for (let y = 0; y < SIZE; y += 1) {
    score += scoreRunsOnLine(board, 0, y, 1, 0, color);
  }
  for (let x = 0; x < SIZE; x += 1) {
    score += scoreRunsOnLine(board, x, 0, 0, 1, color);
  }
  for (let x = 0; x < SIZE; x += 1) {
    score += scoreRunsOnLine(board, x, 0, 1, 1, color);
    score += scoreRunsOnLine(board, x, SIZE - 1, 1, -1, color);
  }
  for (let y = 1; y < SIZE; y += 1) {
    score += scoreRunsOnLine(board, 0, y, 1, 1, color);
    score += scoreRunsOnLine(board, 0, y, 1, -1, color);
  }

  // The five-cell scan recognizes broken shapes such as XXX.X and XX.XX.
  for (const [dx, dy] of DIRS) {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const endX = x + dx * 4;
        const endY = y + dy * 4;
        if (endX < 0 || endX >= SIZE || endY < 0 || endY >= SIZE) continue;
        let own = 0;
        let blocked = false;
        for (let step = 0; step < 5; step += 1) {
          const cell = board[(y + dy * step) * SIZE + x + dx * step];
          if (cell === other(color)) {
            blocked = true;
            break;
          }
          if (cell === color) own += 1;
        }
        if (!blocked && own >= 2) score += BROKEN_SCORE[own];
      }
    }
  }
  return score;
}

function evaluate(board, color) {
  const score = evaluateColor(board, color) - evaluateColor(board, other(color));
  return Math.max(-MATE / 3, Math.min(MATE / 3, score));
}

function orderedMoves(board, color, width, ttBest = -1) {
  const moves = candidatesFor(board);
  const wins = immediateWins(board, color, moves);
  if (wins.length) return wins;

  const blocks = immediateWins(board, other(color), moves);
  if (blocks.length === 1) return blocks;

  const ranked = moves.map(index => ({
    index,
    score: movePriority(board, index, color) +
      (blocks.length > 1 ? movePriority(board, index, other(color)) * 1.4 : 0) +
      (index === ttBest ? MATE / 2 : 0)
  }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(1, width)).map(move => move.index);
}

function forcingMoves(board, color, context) {
  const moves = [];
  for (const index of candidatesFor(board)) {
    context.threatProbes += 1;
    if ((context.threatProbes & 7) === 0 && now() >= context.deadline) {
      context.interrupted = true;
      break;
    }
    board[index] = color;
    const wins = hasFive(board, index % SIZE, (index / SIZE) | 0, color)
      ? [index]
      : immediateWins(board, color);
    board[index] = 0;
    if (wins.length) moves.push(index);
  }
  moves.sort((a, b) => movePriority(board, b, color) - movePriority(board, a, color));
  return moves.slice(0, context.branch);
}

export function findForcingMoves(boardInput, color) {
  const context = {
    deadline: Number.POSITIVE_INFINITY,
    branch: CELL_COUNT,
    threatProbes: 0,
    interrupted: false
  };
  return forcingMoves(Uint8Array.from(boardInput), color, context);
}

function negamax(board, depth, alpha, beta, color, ply, hash, context, extensions = 0) {
  context.nodes += 1;
  if ((context.nodes & 31) === 0 && now() >= context.deadline) {
    context.interrupted = true;
    return 0;
  }
  const ownWins = immediateWins(board, color);
  if (ownWins.length) return MATE - ply;
  const opponentWins = immediateWins(board, other(color));
  if (opponentWins.length > 1) return -MATE + ply;
  if (depth <= 0) {
    let tacticalMoves = opponentWins.length === 1 ? opponentWins : [];
    if (!tacticalMoves.length && extensions < context.maxExtensions) {
      tacticalMoves = forcingMoves(board, color, context);
    }
    if (context.interrupted) return 0;
    if (!tacticalMoves.length) return evaluate(board, color);

    let best = -MATE;
    for (const index of tacticalMoves) {
      board[index] = color;
      const nextHash = (hash ^ ZOBRIST[index][color]) >>> 0;
      const value = hasFive(board, index % SIZE, (index / SIZE) | 0, color)
        ? MATE - (ply + 1)
        : -negamax(board, 0, -beta, -alpha, other(color), ply + 1, nextHash, context, extensions + 1);
      board[index] = 0;
      if (context.interrupted) return 0;
      if (value > best) best = value;
      if (value > alpha) alpha = value;
      if (alpha >= beta) break;
    }
    return best;
  }

  const key = (hash ^ (color === 2 ? SIDE_KEY : 0)) >>> 0;
  const alphaOriginal = alpha;
  const cached = table.get(key);
  let ttBest = -1;
  if (cached) {
    ttBest = cached.move;
    if (cached.depth >= depth) {
      context.hits += 1;
      const value = cached.value > MATE - 10_000
        ? cached.value - ply
        : cached.value < -MATE + 10_000
          ? cached.value + ply
          : cached.value;
      if (cached.flag === 0) return value;
      if (cached.flag === 1 && value >= beta) return value;
      if (cached.flag === 2 && value <= alpha) return value;
    }
  }

  const moves = orderedMoves(board, color, context.branch, ttBest);
  if (!moves.length) return 0;
  let best = -MATE;
  let bestMove = moves[0];
  for (const index of moves) {
    board[index] = color;
    const nextHash = (hash ^ ZOBRIST[index][color]) >>> 0;
    let value;
    if (hasFive(board, index % SIZE, (index / SIZE) | 0, color)) {
      value = MATE - (ply + 1);
    } else {
      value = -negamax(board, depth - 1, -beta, -alpha, other(color), ply + 1, nextHash, context);
    }
    board[index] = 0;
    if (context.interrupted) return 0;
    if (value > best) {
      best = value;
      bestMove = index;
    }
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }

  let flag = 0;
  if (best <= alphaOriginal) flag = 2;
  else if (best >= beta) flag = 1;
  let storedValue = best;
  if (best > MATE - 10_000) storedValue += ply;
  else if (best < -MATE + 10_000) storedValue -= ply;
  if (table.size > 190_000) table.clear();
  table.set(key, { depth, value: storedValue, flag, move: bestMove });
  return best;
}

function rootMove(board, color, profile, deadline, context) {
  const wins = immediateWins(board, color);
  if (wins.length) return { move: wins[0], reason: "win" };
  const blocks = immediateWins(board, other(color));
  if (blocks.length === 1) return { move: blocks[0], reason: "block" };

  let bestMove = orderedMoves(board, color, profile.root)[0];
  let completedDepth = 0;
  for (let depth = 1; depth <= profile.depth; depth += 1) {
    if (now() >= deadline) break;
    const ttKey = (boardHash(board) ^ (color === 2 ? SIDE_KEY : 0)) >>> 0;
    const cached = table.get(ttKey);
    const moves = orderedMoves(board, color, profile.root, cached?.move ?? -1);
    let iterationBest = moves[0];
    let iterationScore = -MATE;
    let alpha = -MATE;
    const beta = MATE;

    for (const index of moves) {
      board[index] = color;
      const hash = (boardHash(board)) >>> 0;
      let value;
      if (hasFive(board, index % SIZE, (index / SIZE) | 0, color)) {
        value = MATE - 1;
      } else {
        value = -negamax(board, depth - 1, -beta, -alpha, other(color), 1, hash, context);
      }
      board[index] = 0;
      if (context.interrupted) break;
      if (value > iterationScore) {
        iterationScore = value;
        iterationBest = index;
      }
      if (value > alpha) alpha = value;
    }
    if (context.interrupted) break;
    bestMove = iterationBest;
    completedDepth = depth;
    if (iterationScore >= MATE - 4) break;
  }
  return { move: bestMove, reason: "search", depth: completedDepth };
}

export function chooseMove(boardInput, level = 6) {
  const board = Uint8Array.from(boardInput);
  if (board.length !== CELL_COUNT) throw new Error("Board must contain exactly 225 cells.");
  const profile = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, (level | 0) - 1))];
  const color = 2;
  const started = now();
  const deadline = started + profile.ms;
  const context = {
    deadline,
    nodes: 0,
    hits: 0,
    interrupted: false,
    branch: profile.branch,
    maxExtensions: profile.extensions,
    threatProbes: 0
  };

  const result = rootMove(board, color, profile, deadline, context);
  const elapsed = Math.max(1, Math.round(now() - started));
  return {
    index: result.move,
    x: result.move % SIZE,
    y: (result.move / SIZE) | 0,
    reason: result.reason,
    depth: result.depth ?? 0,
    nodes: context.nodes,
    hits: context.hits,
    elapsed,
    nps: Math.round(context.nodes * 1000 / elapsed)
  };
}
