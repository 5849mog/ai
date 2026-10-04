// A score and WINRATE belong to one completed principal variation. In
// MultiPV mode only PV 0 describes the position's best continuation.
export class AssessmentCollector {
  constructor() { this.frame = null; }
  read(line) {
    const text = line.trim();
    const start = /^INFO PV (\d+)$/.exec(text);
    if (start) { this.frame = { pv: Number(start[1]) }; return null; }
    if (text === "INFO PV DONE") {
      const frame = this.frame; this.frame = null;
      if (!frame || frame.pv !== 0 || !Number.isInteger(frame.depth) || frame.depth < 0 ||
          !Number.isFinite(frame.winRate) || frame.winRate < 0 || frame.winRate > 1 ||
          (!Number.isFinite(frame.evaluation) && !frame.mate) || !Number.isInteger(frame.bestIndex)) return null;
      const { depth, winRate, evaluation = null, mate = null, bestIndex } = frame;
      return { depth, winRate, evaluation, mate, bestIndex };
    }
    if (!this.frame) return null;
    const number = /^INFO (DEPTH|WINRATE|EVAL) (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i.exec(text);
    const mate = /^INFO EVAL ([+-]?M\d+)$/.exec(text);
    const best = /^INFO BESTLINE (\d+),(\d+)(?:\s|$)/.exec(text);
    if (number) {
      this.frame[{ DEPTH: "depth", WINRATE: "winRate", EVAL: "evaluation" }[number[1].toUpperCase()]] = Number(number[2]);
      if (number[1].toUpperCase() === "EVAL") this.frame.mate = null;
    }
    if (mate) { this.frame.mate = mate[1]; this.frame.evaluation = null; }
    if (best && Number(best[1]) < 15 && Number(best[2]) < 15) this.frame.bestIndex = Number(best[2]) * 15 + Number(best[1]);
    return null;
  }
}
