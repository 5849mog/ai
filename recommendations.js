import { SIZE, validIndex, hasFive } from "./game-rules.js";

// Only completed MultiPV batches at one depth are comparable. Never combine a
// new first PV with the previous iteration's second PV or use a reply as rank 2.
export class RecommendationCollector {
  constructor() { this.frame = null; this.batch = []; this.completed = []; }

  read(line) {
    const text = line.trim();
    const start = /^INFO PV (\d+)$/.exec(text);
    if (start) { this.frame = { pv: Number(start[1]) }; return; }
    if (!this.frame) return;
    const stat = /^INFO (NUMPV|DEPTH|EVAL) (.+)$/.exec(text);
    if (stat) {
      if (stat[1] === "EVAL") {
        const mate = /^([+-]?)M(\d+)$/.exec(stat[2]);
        this.frame.score = mate ? (mate[1] === "-" ? -1 : 1) * (30000 - Number(mate[2])) : Number(stat[2]);
      } else this.frame[stat[1] === "DEPTH" ? "depth" : "count"] = Number(stat[2]);
      return;
    }
    const bestline = /^INFO BESTLINE (\d+),(\d+)(?:\s|$)/.exec(text);
    if (bestline) {
      const x = Number(bestline[1]), y = Number(bestline[2]);
      this.frame.index = x < SIZE && y < SIZE ? y * SIZE + x : -1;
      return;
    }
    if (text !== "INFO PV DONE") return;
    const frame = this.frame;
    this.frame = null;
    if (frame.pv === 0) this.batch = [];
    if (!Number.isInteger(frame.depth) || !Number.isFinite(frame.score)) return;
    if (frame.pv !== this.batch.length || (this.batch.length && this.batch[0].depth !== frame.depth)) return;
    this.batch.push(frame);
    if (this.batch.length === frame.count) this.completed = this.batch.map(entry => ({ ...entry }));
  }

  finish(board, bestIndex, sideToMove) {
    // Rapfi's direct-win shortcut prints no PV. Enumerate actual winning moves
    // with the shared rules, keeping its chosen winning point first.
    const winning = [];
    const copy = Uint8Array.from(board);
    for (let index = 0; index < copy.length; index += 1) {
      if (copy[index]) continue;
      copy[index] = sideToMove;
      if (hasFive(copy, index % SIZE, Math.floor(index / SIZE), sideToMove)) winning.push(index);
      copy[index] = 0;
    }
    let indices;
    if (winning.length) {
      if (!winning.includes(bestIndex)) throw new Error("引擎返回无效推荐落点");
      indices = [bestIndex, ...winning.filter(index => index !== bestIndex)];
    }
    else if (this.completed.length) indices = [...this.completed].sort((a, b) => b.score - a.score || a.pv - b.pv).map(entry => entry.index);
    else indices = [bestIndex];
    const selected = indices.slice(0, 2);
    if (new Set(selected).size !== selected.length || selected.some(index => !validIndex(index) || board[index])) {
      throw new Error("引擎返回无效推荐落点");
    }
    return selected.map((index, rank) => ({ index, x: index % SIZE, y: Math.floor(index / SIZE), rank: rank + 1 }));
  }
}
