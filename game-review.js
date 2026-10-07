import { replayRecord } from "./game-record.js";
import { OpeningSession, replaySession, colorName, coordinate } from "./opening-session.js";
import { moveVerdict } from "./renju-rules.js";

// Keep ownership and candidate choices in their original order. A proposed
// fifth is an action, not a stone; the selected fifth is placed exactly once.
export function reviewFrames(record) {
  const frames = [], moves = [];
  let rule = "freestyle", winner;
  if (record?.format === "gomoku-opening") {
    const final = replaySession(record); winner = final.winner; rule = final.rule;
    const session = new OpeningSession(record);
    const frame = label => ({ board: session.board.slice(), lastMove: session.lastMove, candidates: [...session.candidates],
      label: label + (session.forbidden ? ` · ${session.forbidden}禁手（白胜）` : ""), winner: session.winner, forbidden: session.forbidden });
    frames.push(frame(record.seed ? "起始摆局" : "开局"));
    for (const event of record.events) {
      const before = frame(""), stage = session.stage, color = session.color, actor = session.actor;
      session.apply(event);
      const label = event.type === "stone" || event.type === "select" ? `第 ${session.moves.length} 手 · ${colorName(color)} ${coordinate(event.index)}`
        : event.type === "offer" ? `第五手候选 A${session.candidates.length} · ${coordinate(event.index)}`
          : event.type === "decision" ? event.choice === "swap" ? "交换黑白" : event.choice === "ten" ? "选择十打" : "保持执色"
            : event.type === "start" ? "确定开局角色" : "AI 接手";
      frames.push(frame(label));
      if (event.type === "stone" && ["play", "w6"].includes(stage)) moves.push({ before: before.board, after: session.board.slice(), index: event.index, color, actor, ply: session.moves.length, frame: frames.length - 1, winner: session.winner });
    }
  } else {
    const game = replayRecord(record); winner = game.winner;
    const board = Uint8Array.from(record.setup?.board ?? new Uint8Array(225)), first = record.setup?.sideToMove ?? 1;
    frames.push({ board: board.slice(), lastMove: -1, candidates: [], label: record.setup ? "起始摆局" : "开局", winner: 0 });
    for (const [ply, index] of record.moves.entries()) {
      const color = ply % 2 ? 3 - first : first, before = board.slice();
      const result = moveVerdict(board, index, color); board[index] = color;
      frames.push({ board: board.slice(), lastMove: index, candidates: [], label: `第 ${ply + 1} 手 · ${colorName(color)} ${coordinate(index)}`, winner: result.winner });
      moves.push({ before, after: board.slice(), index, color, actor: color === record.playerColor ? 0 : 1, ply: ply + 1, frame: frames.length - 1, winner: result.winner });
    }
  }
  if (!winner) throw new Error("对局结束后才可复盘");
  return { frames, moves, rule, winner };
}

const aborted = signal => { if (signal?.aborted) throw new DOMException("复盘已取消", "AbortError"); };
function evaluatedMove(result, board, color, rule) {
  const index = result?.index;
  if (!Number.isInteger(index) || index < 0 || index >= 225 || board[index] || moveVerdict(board, index, color, rule).forbidden) throw new Error("引擎返回了无效复盘建议");
  if (moveVerdict(board, index, color, rule).winner === color) return { best: index, rate: 1 };
  const assessment = result.assessment;
  const rate = assessment?.winRate;
  const best = assessment?.bestIndex;
  // Rapfi may choose a different final move from its last completed PV. The
  // atomic score still describes that PV: show its matching legal suggestion,
  // never attach that score to the independently selected final move.
  if (Number.isFinite(rate) && rate >= 0 && rate <= 1 && Number.isInteger(best) && best >= 0 && best < 225 && !board[best] && !moveVerdict(board, best, color, rule).forbidden) {
    return { best, rate: moveVerdict(board, best, color, rule).winner === color ? 1 : rate };
  }
  return { best: index, rate: null };
}

// Use one equal budget for every position. Adjacent positions share results;
// live pondering and terminal 100% figures are never treated as move losses.
export async function analyzeReview(review, search, { signal, timeMs = 500, onProgress = () => {} } = {}) {
  const cache = new Map(), rows = [];
  async function evaluate(board, color) {
    aborted(signal); const key = `${color}:${board.join("")}`;
    if (!cache.has(key)) {
      const result = await search({ board: board.slice(), sideToMove: color, timeMs, allowSetup: true });
      aborted(signal); cache.set(key, evaluatedMove(result, board, color, review.rule));
    }
    return cache.get(key);
  }
  for (const [n, move] of review.moves.entries()) {
    aborted(signal);
    const before = await evaluate(move.before, move.color);
    let afterRate;
    if (move.winner) afterRate = move.winner === 3 ? null : move.winner === move.color ? 1 : 0;
    else { const after = await evaluate(move.after, 3 - move.color); afterRate = after.rate === null ? null : 1 - after.rate; }
    const loss = before.rate === null || afterRate === null ? null : before.best === move.index ? 0 : Math.max(0, before.rate - afterRate);
    rows.push({ ...move, best: before.best, beforeRate: before.rate, afterRate, loss });
    onProgress({ completed: n + 1, total: review.moves.length, rows: [...rows] });
  }
  return rows;
}

export function reviewHighlights(rows, limit = 3) {
  return rows.filter(row => row.loss !== null && row.loss >= .05 && row.best !== row.index)
    .sort((a, b) => b.loss - a.loss || a.ply - b.ply).slice(0, limit);
}
