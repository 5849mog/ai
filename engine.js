export const SIZE = 15;
const CELL_COUNT = SIZE * SIZE;
const CENTER = (SIZE - 1) / 2;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const MATE = 1_000_000_000;

function makeEvalLines() {
  const lines = [];
  for (const [dx, dy] of DIRS) {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const previousX = x - dx;
        const previousY = y - dy;
        if (previousX >= 0 && previousX < SIZE && previousY >= 0 && previousY < SIZE) continue;
        const line = [];
        let cx = x;
        let cy = y;
        while (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE) {
          line.push(cy * SIZE + cx);
          cx += dx;
          cy += dy;
        }
        lines.push(line);
      }
    }
  }
  return lines;
}

const EVAL_LINES = makeEvalLines();

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
  { name: "极限", ms: 1_200, root: 16, branch: 8, depth: 8, extensions: 6 },
  { name: "超凡", ms: 1_700, root: 18, branch: 8, depth: 8, extensions: 7 },
  { name: "宗师", ms: 2_400, root: 20, branch: 9, depth: 9, extensions: 8 },
  { name: "天元", ms: 3_400, root: 22, branch: 10, depth: 10, extensions: 8 }
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

function transpositionKey(hash, color, extensions = 0) {
  const extensionKey = Math.imul(extensions, 0x9e37_79b1);
  return (hash ^ (color === 2 ? SIDE_KEY : 0) ^ extensionKey) >>> 0;
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

function evaluate(board, color) {
  const scores = [0, 0, 0];
  for (const line of EVAL_LINES) {
    let runColor = 0;
    let runLength = 0;
    let runStart = 0;
    for (let offset = 0; offset < line.length; offset += 1) {
      const cell = board[line[offset]];
      if (runLength && cell === runColor) {
        runLength += 1;
        continue;
      }
      if (runLength) {
        const beforeOpen = runStart > 0 && board[line[runStart - 1]] === 0;
        const afterOpen = cell === 0;
        scores[runColor] += lineRunValue(runLength, Number(beforeOpen) + Number(afterOpen));
      }
      if (cell === 1 || cell === 2) {
        runColor = cell;
        runLength = 1;
        runStart = offset;
      } else {
        runColor = 0;
        runLength = 0;
      }
    }
    if (runLength) {
      const beforeOpen = runStart > 0 && board[line[runStart - 1]] === 0;
      scores[runColor] += lineRunValue(runLength, Number(beforeOpen));
    }

    for (let start = 0; start <= line.length - 5; start += 1) {
      let black = 0;
      let white = 0;
      for (let step = 0; step < 5; step += 1) {
        const cell = board[line[start + step]];
        if (cell === 1) black += 1;
        else if (cell === 2) white += 1;
      }
      if (!white && black >= 2) scores[1] += BROKEN_SCORE[black];
      if (!black && white >= 2) scores[2] += BROKEN_SCORE[white];
    }
  }
  const score = scores[color] - scores[other(color)];
  return Math.max(-MATE / 3, Math.min(MATE / 3, score));
}

function orderedMoves(board, color, width, ttBest = -1, prepared = null) {
  const moves = prepared?.candidates ?? candidatesFor(board);
  const wins = prepared?.wins ?? immediateWins(board, color, moves);
  if (wins.length) return wins;

  const blocks = prepared?.blocks ?? immediateWins(board, other(color), moves);
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

function immediateWinsNear(board, index, color) {
  const wins = [];
  const x = index % SIZE;
  const y = (index / SIZE) | 0;
  for (const [dx, dy] of DIRS) {
    for (let offset = -4; offset <= 4; offset += 1) {
      if (!offset) continue;
      const nx = x + dx * offset;
      const ny = y + dy * offset;
      if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
      const target = ny * SIZE + nx;
      if (board[target]) continue;
      board[target] = color;
      const win = hasFive(board, nx, ny, color);
      board[target] = 0;
      if (win) wins.push(target);
    }
  }
  return wins;
}

function forcingMoves(board, color, context) {
  const moves = [];
  const candidates = candidatesFor(board);
  const existingWins = immediateWins(board, color, candidates);
  for (const index of candidates) {
    context.threatProbes += 1;
    if ((context.threatProbes & 7) === 0 && now() >= context.deadline) {
      context.interrupted = true;
      break;
    }
    board[index] = color;
    const wins = hasFive(board, index % SIZE, (index / SIZE) | 0, color) ||
      existingWins.some(win => win !== index) || immediateWinsNear(board, index, color).length > 0;
    board[index] = 0;
    if (wins) moves.push(index);
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

function canForceThreatWin(board, attacker, remainingPairs, context) {
  if (now() >= context.deadline) {
    context.interrupted = true;
    return false;
  }
  if (immediateWins(board, attacker).length) return true;
  const defender = other(attacker);
  if (immediateWins(board, defender).length || remainingPairs <= 0) return false;

  for (const attack of forcingMoves(board, attacker, context)) {
    board[attack] = attacker;
    const wins = immediateWins(board, attacker);
    const defenderWins = immediateWins(board, defender);
    let forced = false;
    if (!defenderWins.length) {
      if (wins.length > 1) {
        forced = true;
      } else if (wins.length === 1) {
        const block = wins[0];
        board[block] = defender;
        forced = !hasFive(board, block % SIZE, (block / SIZE) | 0, defender) &&
          canForceThreatWin(board, attacker, remainingPairs - 1, context);
        board[block] = 0;
      }
    }
    board[attack] = 0;
    if (forced) return true;
    if (context.interrupted) return false;
  }
  return false;
}

function findThreatWinMove(board, attacker, remainingPairs, context) {
  if (immediateWins(board, attacker).length || immediateWins(board, other(attacker)).length) return -1;

  for (const attack of forcingMoves(board, attacker, context)) {
    board[attack] = attacker;
    const wins = immediateWins(board, attacker);
    const defenderWins = immediateWins(board, other(attacker));
    let forced = false;
    if (!defenderWins.length) {
      if (wins.length > 1) {
        forced = true;
      } else if (wins.length === 1) {
        const block = wins[0];
        board[block] = other(attacker);
        forced = !hasFive(board, block % SIZE, (block / SIZE) | 0, other(attacker)) &&
          canForceThreatWin(board, attacker, remainingPairs - 1, context);
        board[block] = 0;
      }
    }
    board[attack] = 0;
    if (forced) return attack;
    if (context.interrupted) return -1;
  }
  return -1;
}

function negamax(board, depth, alpha, beta, color, ply, hash, context, extensions = 0) {
  context.nodes += 1;
  if ((context.nodes & 31) === 0 && now() >= context.deadline) {
    context.interrupted = true;
    return 0;
  }
  const key = transpositionKey(hash, color, extensions);
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

  const candidates = candidatesFor(board);
  const ownWins = immediateWins(board, color, candidates);
  if (ownWins.length) return MATE - ply;
  const opponentWins = immediateWins(board, other(color), candidates);
  const prepared = { candidates, wins: ownWins, blocks: opponentWins };
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

  const moves = orderedMoves(board, color, context.branch, ttBest, prepared);
  if (!moves.length) return 0;
  let best = -MATE;
  let bestMove = moves[0];
  let firstMove = true;
  for (const index of moves) {
    board[index] = color;
    const nextHash = (hash ^ ZOBRIST[index][color]) >>> 0;
    let value;
    if (hasFive(board, index % SIZE, (index / SIZE) | 0, color)) {
      value = MATE - (ply + 1);
    } else if (firstMove) {
      value = -negamax(board, depth - 1, -beta, -alpha, other(color), ply + 1, nextHash, context);
    } else {
      value = -negamax(board, depth - 1, -alpha - 1, -alpha, other(color), ply + 1, nextHash, context);
      if (!context.interrupted && value > alpha && value < beta) {
        value = -negamax(board, depth - 1, -beta, -alpha, other(color), ply + 1, nextHash, context);
      }
    }
    board[index] = 0;
    if (context.interrupted) return 0;
    firstMove = false;
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
  const candidates = candidatesFor(board);
  const wins = immediateWins(board, color, candidates);
  if (wins.length) return { move: wins[0], reason: "win" };
  const blocks = immediateWins(board, other(color), candidates);
  if (blocks.length === 1) return { move: blocks[0], reason: "block" };
  const prepared = { candidates, wins, blocks };

  const proofContext = {
    deadline: Math.min(deadline, now() + Math.min(240, profile.ms * .24)),
    branch: Math.max(context.branch, profile.root),
    threatProbes: 0,
    interrupted: false
  };
  const proofPairs = Math.min(4, profile.extensions);
  const forcedMove = findThreatWinMove(board, color, proofPairs, proofContext);
  if (forcedMove >= 0) return { move: forcedMove, reason: "threat-win" };

  const unsafeRootMoves = new Set();
  for (const candidate of orderedMoves(board, color, profile.root, -1, prepared)) {
    if (now() >= proofContext.deadline) break;
    board[candidate] = color;
    const opponentCanForce = canForceThreatWin(board, other(color), proofPairs, proofContext);
    board[candidate] = 0;
    if (opponentCanForce) unsafeRootMoves.add(candidate);
    if (proofContext.interrupted) break;
  }

  const firstRanked = orderedMoves(board, color, profile.root + unsafeRootMoves.size, -1, prepared);
  const firstSafe = firstRanked.filter(move => !unsafeRootMoves.has(move));
  let bestMove = (firstSafe.length ? firstSafe : firstRanked)[0];
  let completedDepth = 0;
  for (let depth = 1; depth <= profile.depth; depth += 1) {
    if (now() >= deadline) break;
    const ttKey = transpositionKey(boardHash(board), color);
    const cached = table.get(ttKey);
    const ranked = orderedMoves(board, color, profile.root + unsafeRootMoves.size, cached?.move ?? -1, prepared);
    const safe = ranked.filter(move => !unsafeRootMoves.has(move));
    const moves = (safe.length ? safe : ranked).slice(0, profile.root);
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
      } else if (index === moves[0]) {
        value = -negamax(board, depth - 1, -beta, -alpha, other(color), 1, hash, context);
      } else {
        value = -negamax(board, depth - 1, -alpha - 1, -alpha, other(color), 1, hash, context);
        if (!context.interrupted && value > alpha && value < beta) {
          value = -negamax(board, depth - 1, -beta, -alpha, other(color), 1, hash, context);
        }
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
    if (table.size > 190_000) table.clear();
    table.set(ttKey, { depth, value: iterationScore, flag: 0, move: iterationBest });
    if (iterationScore >= MATE - 4) break;
  }
  return { move: bestMove, reason: "search", depth: completedDepth };
}

export function chooseMove(boardInput, level = 6) {
  const board = Uint8Array.from(boardInput);
  if (board.length !== CELL_COUNT) throw new Error("Board must contain exactly 225 cells.");
  table.clear();
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
