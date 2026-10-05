import { moveVerdict, distinctCandidates } from "./renju-rules.js";
export async function adviseOpening(session, search, timeMs = 1000) {
  const run = (board, color, options = {}) => search({ board, sideToMove: color, timeMs, allowSetup: true, ...options });
  if (session.decision) {
    const result = await run(session.board, session.color);
    const rate = result.assessment?.winRate ?? result.winRate;
    if (!Number.isFinite(rate)) throw new Error("尚无可靠换色评估，请重试");
    const blackRate = session.color === 1 ? rate : 1 - rate;
    const currentRate = session.actor === session.blackSeat ? blackRate : 1 - blackRate;
    const choice = currentRate < .5 ? "swap" : "keep";
    return { choice, result, note: `建议${choice === "swap" ? "交换黑白" : "保持执色"}。短时评估仅比较保持与交换，十打可按实际棋局录入。` };
  }
  if (session.stage === "choose") {
    const scores = [];
    for (const index of session.candidates) {
      const board = session.board.slice(); board[index] = 1;
      const result = await run(board, 2, { timeMs: Math.max(30, Math.floor(timeMs / session.candidates.length)) });
      const rate = result.assessment?.winRate ?? result.winRate;
      if (!Number.isFinite(rate)) throw new Error("候选评估未完成，请重试");
      scores.push({ index, rate });
    }
    scores.sort((a, b) => b.rate - a.rate);
    return { points: scores.slice(0, 2).map(i => i.index), note: "绿圈首选：从白棋角度逐一比较已提出的第五手。" };
  }
  if (session.offerCount) {
    const remaining = session.offerCount - session.candidates.length, selected = []; let result;
    for (let attempt = 0; selected.length < remaining && attempt < remaining; attempt++) {
      const existing = [...session.candidates, ...selected];
      const allowed = session.allowedMoves({ safe: true }).filter(i => distinctCandidates(session.board, [...existing, i]).length > existing.length);
      if (!allowed.length) throw new Error("合法非等价候选不足");
      result = await run(session.board, 1, { multiPV: Math.min(32, allowed.length), allowedMoves: allowed, timeMs: Math.max(30, Math.floor(timeMs / remaining)) });
      for (const index of [result.index, ...(result.recommendations ?? []).map(i => i.index)]) {
        if (selected.length === remaining) break;
        const points = [...session.candidates, ...selected];
        if (allowed.includes(index) && !moveVerdict(session.board, index, 1, session.rule).forbidden && distinctCandidates(session.board, [...points, index]).length === points.length + 1) selected.push(index);
      }
    }
    if (selected.length !== remaining) throw new Error("未完成整组候选，可重试或手动录入实际候选");
    return { points: selected, result, note: "按黑棋搜索排序并排除对称等价；候选由白方选定后才成为实子。" };
  }
  const allowed = session.allowedMoves({ safe: true });
  if (!allowed.length) throw new Error("当前没有合法推荐落点");
  if (allowed.length === 1) return { points: allowed, note: session.stage === "b1" ? "第一手必须落天元 H8。" : "当前仅有一个合法落点。" };
  const balance = session.rule === "rif" && ["w2", "b3"].includes(session.stage);
  const result = await run(session.board, session.color, { multiPV: balance ? 1 : 2, balance, allowedMoves: allowed });
  if (!allowed.includes(result.index) || moveVerdict(session.board, result.index, session.color, session.rule).forbidden) throw new Error("引擎建议不符合当前规则，请重试");
  return { points: [...new Set([result.index, ...(result.recommendations ?? []).map(i => i.index)])].filter(i => allowed.includes(i)).slice(0, 2), result,
    note: balance ? "前三子由同一方摆出，平衡搜索避免给交换方明显优势。" : "推荐只标出落点，请录入外部实际下法。" };
}
