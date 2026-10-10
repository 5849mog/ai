import { moveVerdict, distinctCandidates } from "./renju-rules.js";
import { replaySession } from "./opening-session.js";
const reliableRate = result => {
  const rate = result.assessment?.winRate ?? result.winRate;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error("开局评估尚未完成，请重试");
  return rate;
};
const blackRate = (result, color) => color === 1 ? reliableRate(result) : 1 - reliableRate(result);
const swapAdvice = (session, rate, result, note) => {
  const current = session.actor === session.blackSeat ? rate : 1 - rate;
  return { choice: current < .5 ? "swap" : "keep", result, note };
};
const legalPoints = (result, allowed, limit) => [...new Set([
  ...(result.recommendations ?? []).map(move => move.index), result.index
])].filter(index => allowed.includes(index)).slice(0, limit);

// One representative per symmetry class lets the engine spend its MultiPV
// budget on the required distinct fifths instead of 32 mostly unused lines.
async function proposals(board, allowed, existing, count, run, timeMs) {
  const choices = distinctCandidates(board, [...existing, ...allowed]).slice(existing.length);
  if (choices.length < count) throw new Error("合法非等价候选不足");
  const result = await run(board, 1, { multiPV: count, allowedMoves: choices, timeMs });
  const points = legalPoints(result, choices, count);
  if (points.length !== count) throw new Error("未完成整组候选，可重试或手动录入实际候选");
  return { points, result };
}

async function proposalFloor(board, allowed, count, run, timeMs) {
  // Completed PVs contain rates from the same depth. A partial batch or a
  // final move outside that batch cannot supply a score for another fifth.
  const budget = Math.max(1, Math.floor(timeMs * .8));
  const offered = await proposals(board, allowed, [], count, run, budget);
  const rates = [];
  for (const index of offered.points) {
    const point = offered.result.recommendations?.find(move => move.index === index);
    if (Number.isFinite(point?.winRate) && point.winRate >= 0 && point.winRate <= 1) rates.push(point.winRate);
    else {
      const next = board.slice(); next[index] = 1;
      rates.push(1 - reliableRate(await run(next, 2, { timeMs: Math.max(1, Math.floor((timeMs - budget) / count)) })));
    }
  }
  return { ...offered, rate: Math.min(...rates) };
}

async function rifFourth(session, run, timeMs) {
  const allowed = session.allowedMoves({ safe: true });
  const root = await run(session.board, 2, { multiPV: Math.min(3, allowed.length), allowedMoves: allowed,
    timeMs: Math.max(1, Math.floor(timeMs / 4)) });
  const candidates = legalPoints(root, allowed, 3);
  if (!candidates.length) throw new Error("第四手评估未完成，请重试");
  const outcomes = [];
  for (const index of candidates) {
    const board = session.board.slice(); board[index] = 2;
    const fifths = Array.from({ length: 225 }, (_, i) => i).filter(i => !board[i] && !moveVerdict(board, i, 1, session.rule).forbidden);
    const proposal = await proposalFloor(board, fifths, 2, run, Math.max(1, Math.floor(timeMs * .75 / candidates.length)));
    outcomes.push({ index, blackRate: proposal.rate });
  }
  outcomes.sort((a, b) => a.blackRate - b.blackRate);
  return { points: outcomes.slice(0, 2).map(item => item.index), result: root, blackRate: outcomes[0].blackRate,
    note: "第四手同时比较黑方两打与白方选点；采用有限候选的开局延续评估。" };
}

export async function adviseOpening(session, search, timeMs = 1000, { includeAlternative = true } = {}) {
  const run = (board, color, options = {}) => search({ board, sideToMove: color, timeMs, allowSetup: true, ...options });
  if (session.decision) {
    if (session.rule === "rif" && session.stage === "swap3") {
      // Ownership changes, stones do not. Both choices reach the same white
      // fourth / black two-fifth / white selection opening game.
      const next = replaySession(session.record()); next.apply({ type: "decision", choice: "keep" });
      const continuation = await rifFourth(next, run, timeMs);
      return swapAdvice(session, continuation.blackRate, continuation.result,
        "换色建议已考虑白棋第四手、黑方两打和白方选点；按外部对局确认实际选择。");
    }
    if (session.rule === "taraguchi10" && session.stage === "route4") {
      const fifths = Array.from({ length: 225 }, (_, i) => i).filter(i => !session.board[i] && !moveVerdict(session.board, i, 1, session.rule).forbidden);
      const ten = await proposalFloor(session.board, fifths, 10, run, Math.max(1, Math.floor(timeMs * .6)));
      const next = replaySession(session.record()); next.apply({ type: "decision", choice: "keep" });
      const result = await run(session.board, 1, { balance: true, allowedMoves: next.allowedMoves({ safe: true }),
        timeMs: Math.max(1, Math.floor(timeMs * .4)) });
      const rate = blackRate(result, 1), normal = Math.min(rate, 1 - rate);
      return { choice: ten.rate > normal + .02 ? "ten" : "keep", result,
        note: "已比较平衡第五手与十个非等价提案；十打按白方最有利的选点评估。" };
    }
    const result = await run(session.board, session.color);
    return swapAdvice(session, blackRate(result, session.color), result,
      session.stage === "swap5" ? "按第五手后的实际执色比较保持与交换。" : "当前执色的短时评估；后续仍有换色，请按外部棋局确认。");
  }
  if (session.stage === "choose") {
    const scores = [];
    for (const index of session.candidates) {
      const board = session.board.slice(); board[index] = 1;
      const result = await run(board, 2, { timeMs: Math.max(30, Math.floor(timeMs / session.candidates.length)) });
      const rate = reliableRate(result);
      scores.push({ index, rate });
    }
    scores.sort((a, b) => b.rate - a.rate);
    return { points: scores.slice(0, 2).map(i => i.index), note: "绿圈首选：从白棋角度逐一比较已提出的第五手。" };
  }
  if (session.offerCount) {
    const offered = await proposals(session.board, session.allowedMoves({ safe: true }), session.candidates,
      session.offerCount - session.candidates.length, run, timeMs);
    return { ...offered, note: "集中搜索所需的非等价候选；按整组提案评估，白方选定后才成为实子。" };
  }
  if (session.rule === "rif" && session.stage === "w4") return rifFourth(session, run, timeMs);
  const allowed = session.allowedMoves({ safe: true });
  if (!allowed.length) throw new Error("当前没有合法推荐落点");
  if (allowed.length === 1) return { points: allowed, note: session.stage === "b1" ? "第一手必须落天元 H8。" : "当前仅有一个合法落点。" };
  const balance = session.rule === "rif" && ["w2", "b3"].includes(session.stage)
    || session.rule === "taraguchi10" && ["w2", "b3", "w4", "b5"].includes(session.stage);
  const result = await run(session.board, session.color, { multiPV: balance || !includeAlternative ? 1 : 2, balance, allowedMoves: allowed });
  if (!allowed.includes(result.index) || moveVerdict(session.board, result.index, session.color, session.rule).forbidden) throw new Error("引擎建议不符合当前规则，请重试");
  return { points: [...new Set([result.index, ...(result.recommendations ?? []).map(i => i.index)])].filter(i => allowed.includes(i)).slice(0, 2), result,
    note: balance ? session.rule === "taraguchi10" ? "落子后对方仍可换色，使用平衡搜索避免把单方优势交给对方。" : "前三子由同一方摆出，平衡搜索避免给交换方明显优势。" : "推荐只标出落点，请录入外部实际下法。" };
}

