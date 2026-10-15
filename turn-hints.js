import { moveVerdict } from "./renju-rules.js";

export const HINT_COUNT = 3;
export const HINT_SLICE_MS = 400;
const legal = (p, index) => Number.isInteger(index) && index >= 0 && index < 225 && !p.board[index]
  && (!p.allowedMoves || p.allowedMoves.includes(index)) && !moveVerdict(p.board, index, p.color, p.rule).forbidden;

// Hints belong to a position and its actual next stone color, never a player
// preference, previous move, hypothetical continuation or completed AI answer.
export class TurnHints {
  constructor() { this.position = null; this.job = null; }
  setPosition({ board, color, rule = "freestyle", stage = "play", allowedMoves, enabled = true }) {
    const key = JSON.stringify([Array.from(board), color, rule, stage, allowedMoves, enabled]);
    if (key === this.position?.key) return;
    this.job = null;
    const p = this.position = { key, board: Uint8Array.from(board), color, rule, allowedMoves, enabled, points: [], depth: -1 };
    // Immediate opening references require neither model loading nor a search.
    // Formal opening restrictions still take precedence over these free points.
    if (enabled && !board.some(Boolean)) p.points = [112, 111, 97].filter(index => legal(p, index));
  }
  begin(requestId) { this.job = this.position?.enabled ? { requestId, key: this.position.key, color: this.position.color } : null; }
  cancel({ keepPoints = false } = {}) { this.job = null; if (this.position && !keepPoints) this.position.points = []; }
  accept({ requestId, sideToMove, stats }) {
    const p = this.position, j = this.job;
    if (!p?.enabled || !j || j.requestId !== requestId || j.key !== p.key || j.color !== sideToMove) return false;
    let points, depth;
    if (stats?.recommendations?.length) {
      const rows = stats.recommendations.slice(0, HINT_COUNT);
      if (rows.some(row => !legal(p, row.index)) || new Set(rows.map(row => row.index)).size !== rows.length) return false;
      depth = rows[0].depth ?? 0;
      if (!Number.isInteger(depth) || depth < 0 || rows.some(row => (row.depth ?? 0) !== depth) || depth < p.depth) return false;
      points = rows.map(row => row.index);
      if (!p.board.some(Boolean) && points.length === 1 && points[0] === 112) points = [112, 111, 97].filter(index => legal(p, index));
    } else {
      const a = stats?.assessment;
      if (!legal(p, a?.bestIndex) || !Number.isInteger(a.depth) || a.depth < p.depth) return false;
      // Single-PV deepening can update the leading point while keeping the
      // other same-position shortlist choices. No scores are combined/shown.
      depth = a.depth; points = [a.bestIndex, ...p.points.filter(i => i !== a.bestIndex)].slice(0, HINT_COUNT);
    }
    const changed = points.join() !== p.points.join();
    p.points = points; p.depth = depth; return changed;
  }
  get points() { return this.position?.enabled ? this.position.points.map((index, rank) => ({ index, rank: rank + 1, color: this.position.color })) : []; }
}
