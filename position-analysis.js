const STORAGE_KEY = `gomoku-analysis:${new URL("./", import.meta.url).pathname}:v1`;
const sameMoves = (a, b) => a.length === b.length && a.every((move, i) => move === b[i]);
const validPoint = point => point && Number.isInteger(point.ply) && point.ply >= 0 &&
  point.ply <= 225 && (point.winRate === null || Number.isFinite(point.winRate) && point.winRate >= 0 && point.winRate <= 1) &&
  Number.isInteger(point.depth) && point.depth >= 0 && point.depth <= 1000 &&
  [0, 1, 2].includes(point.forcedColor) && (point.bestIndex === null || Number.isInteger(point.bestIndex) && point.bestIndex >= 0 && point.bestIndex < 225) &&
  ["engine", "continuation", "result"].includes(point.kind);

export class PositionAnalysis {
  constructor(moves = [], playerColor = 1) {
    this.moves = [...moves]; this.playerColor = playerColor; this.points = new Map(); this.job = null;
  }
  setPosition(moves, playerColor, { reset = false } = {}) {
    let common = 0;
    if (!reset && playerColor === this.playerColor) {
      while (common < Math.min(moves.length, this.moves.length) && moves[common] === this.moves[common]) common++;
    }
    if (reset || playerColor !== this.playerColor) this.points.clear();
    else for (const ply of this.points.keys()) if (ply > common) this.points.delete(ply);
    this.moves = [...moves]; this.playerColor = playerColor; this.job = null;
  }
  begin(requestId, sideToMove) {
    this.job = { requestId, sideToMove, moves: [...this.moves] };
  }
  cancel() { this.job = null; }
  accept({ requestId, sideToMove, stats }) {
    if (!this.job || this.job.requestId !== requestId || this.job.sideToMove !== sideToMove ||
        !sameMoves(this.moves, this.job.moves)) return false;
    const assessment = stats?.assessment;
    if (!assessment || !Number.isFinite(assessment.winRate) || assessment.winRate < 0 || assessment.winRate > 1 ||
        !Number.isInteger(assessment.depth) || assessment.depth < 0 || assessment.depth > 1000 ||
        !Number.isInteger(assessment.bestIndex) || assessment.bestIndex < 0 || assessment.bestIndex >= 225 ||
        assessment.mate != null && !/^[+-]?M\d+$/.test(assessment.mate)) return false;
    const forcedColor = assessment.mate ? (assessment.mate.startsWith("-") ? 3 - sideToMove : sideToMove) : 0;
    const point = { ply: this.moves.length,
      winRate: sideToMove === this.playerColor ? assessment.winRate : 1 - assessment.winRate,
      depth: assessment.depth, forcedColor, bestIndex: assessment.bestIndex, kind: "engine" };
    const previous = this.points.get(point.ply);
    // Short ponder slices cannot erase a deeper, already completed search.
    if (previous?.kind === "engine" && previous.depth > point.depth) return false;
    if (previous && JSON.stringify(previous) === JSON.stringify(point)) return false;
    this.points.set(point.ply, point); return true;
  }
  advanceAi(moves, index, assessment) {
    const previous = this.points.get(this.moves.length);
    const follows = moves.length === this.moves.length + 1 && sameMoves(moves.slice(0, -1), this.moves) && moves.at(-1) === index;
    this.setPosition(moves, this.playerColor);
    // The final PV score can follow the AI's actual best move, but never an
    // arbitrary human move or an alternative from MultiPV.
    if (follows && previous && previous.bestIndex === index && assessment?.bestIndex === index && previous.depth === assessment.depth) {
      this.points.set(moves.length, { ...previous, ply: moves.length, kind: "continuation" });
    }
  }
  finish(winner) {
    if (!winner) return;
    this.job = null;
    this.points.set(this.moves.length, { ply: this.moves.length,
      winRate: winner === 3 ? null : winner === this.playerColor ? 1 : 0,
      depth: 0, forcedColor: winner === 3 ? 0 : winner, bestIndex: null, kind: "result" });
  }
  get current() { return this.points.get(this.moves.length) ?? null; }
  get history() { return [...this.points.values()].sort((a, b) => a.ply - b.ply); }
  save(storage) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, playerColor: this.playerColor, moves: this.moves, points: this.history })); return true; }
    catch { return false; }
  }
  load(storage) {
    try {
      const data = JSON.parse(storage.getItem(STORAGE_KEY));
      if (data?.version !== 1 || data.playerColor !== this.playerColor || !Array.isArray(data.moves) ||
          !sameMoves(data.moves, this.moves) || !Array.isArray(data.points) || data.points.length > 226 ||
          !data.points.every(point => validPoint(point) && point.ply <= this.moves.length) ||
          new Set(data.points.map(point => point.ply)).size !== data.points.length) return false;
      this.points = new Map(data.points.map(point => [point.ply, { ply: point.ply, winRate: point.winRate,
        depth: point.depth, forcedColor: point.forcedColor, bestIndex: point.bestIndex, kind: point.kind }])); return true;
    } catch { return false; }
  }
}

export function describePosition(point, playerColor, winner = 0) {
  if (winner) return winner === 3 ? "平局，双方和棋收官" : winner === playerColor ? "五子连珠，你赢了" : "AI 五子连珠，对局结束";
  if (!point || point.winRate === null) return "等待引擎评估当前局势";
  if (point.forcedColor) return point.forcedColor === playerColor ? "引擎发现了你的获胜路线" : "引擎发现了 AI 的获胜路线";
  const rate = point.winRate;
  return rate >= .85 ? "你明显占优，保持攻势" : rate >= .65 ? "你占据优势，稳步推进" : rate >= .55 ? "你略占优势，耐心布局"
    : rate > .45 ? "双方势均力敌，静观变化" : rate > .35 ? "AI 略占优势，谨慎应对" : rate > .15 ? "AI 占据优势，留意防守" : "AI 明显占优，寻找转机";
}

export function trendGeometry(history, ply) {
  const left = 25, right = 350, top = 6, bottom = 68, span = Math.max(10, ply);
  const x = step => left + step / span * (right - left);
  const y = rate => bottom - rate * (bottom - top);
  const groups = []; let group = [];
  for (const point of history) {
    if (point.winRate === null) { if (group.length) groups.push(group); group = []; continue; }
    if (group.length && point.ply !== group.at(-1).ply + 1) { groups.push(group); group = []; }
    group.push({ ...point, x: x(point.ply), y: y(point.winRate) });
  }
  if (group.length) groups.push(group);
  return { groups, left, right, top, bottom, span, currentX: x(ply) };
}
