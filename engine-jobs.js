import { RecommendationCollector } from "./recommendations.js";
import { AssessmentCollector } from "./engine-assessment.js";

// Cooperative background analysis for both single-thread and pthread WASM.
// A normal, time-limited search warms Rapfi's transposition table, then yields
// so that the worker can process a real move, cancellation or a settings change.
export class EngineJobs {
  constructor({ send, emit, searchCommands, onPonderSlice = () => {}, now = () => performance.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = id => clearTimeout(id),
    sliceMs = 250, pauseMs = 100 }) {
    Object.assign(this, { send, emit, searchCommands, onPonderSlice, now, setTimer, clearTimer, sliceMs, pauseMs });
    this.active = null;
    this.background = null;
    this.queuedSearch = null;
    this.nextTimer = null;
  }

  search(job) {
    this.searchCommands(job.board, job.sideToMove, job.timeMs, job.multiPV, job.allowSetup, job);
    if (this.queuedSearch || this.active?.phase === "search") throw new Error("已有搜索正在进行");
    this.background = null;
    this.cancelNext();
    this.queuedSearch = job;
    this.interruptBackground();
    this.scheduleNext();
  }

  ponder(job) {
    this.searchCommands(job.board, job.sideToMove, this.sliceMs, 1, job.allowSetup);
    if (this.queuedSearch || this.active?.phase === "search") throw new Error("不能在落子搜索时启动后台思考");
    this.background = job;
    this.cancelNext();
    this.interruptBackground();
    this.scheduleNext();
  }

  stopPonder() {
    this.background = null;
    if (!this.queuedSearch) this.cancelNext();
    this.interruptBackground();
  }

  interruptBackground() {
    if (this.active?.phase === "ponder" && !this.active.stopRequested) {
      this.active.stopRequested = true;
      this.send("STOP");
    }
  }

  cancelNext() {
    if (this.nextTimer !== null) this.clearTimer(this.nextTimer);
    this.nextTimer = null;
  }

  scheduleNext() {
    if (this.active || this.nextTimer !== null || (!this.queuedSearch && !this.background)) return;
    this.nextTimer = this.setTimer(() => {
      this.nextTimer = null;
      if (this.active) return;
      const job = this.queuedSearch ?? this.background;
      if (!job) return;
      const phase = this.queuedSearch ? "search" : "ponder";
      this.queuedSearch = null;
      this.active = { ...job, phase, started: this.now(), stats: {}, assessment: new AssessmentCollector(),
        recommendations: phase === "search" && job.multiPV > 1 ? new RecommendationCollector(job.multiPV, job.rule) : null };
      const timeMs = phase === "ponder" ? this.sliceMs : job.timeMs;
      if (this.restricted) this.send("YXBLOCKRESET");
      this.restricted = Boolean(job.allowedMoves);
      // Native automatic pondering must remain disabled: single-thread builds
      // run it synchronously and cannot receive STOP while it is running.
      for (const command of this.searchCommands(job.board, job.sideToMove, timeMs, phase === "search" ? job.multiPV : 1, job.allowSetup, job)) this.send(command);
    }, this.queuedSearch ? 0 : this.pauseMs);
  }

  output(parsed, line) {
    const job = this.active;
    if (!job) return;
    if (line && job.recommendations) job.recommendations.read(line);
    const current = job.phase === "search" || this.background?.requestId === job.requestId;
    const assessment = line ? job.assessment.read(line) : null;
    if (assessment && job.board[assessment.bestIndex] === 0) {
      job.stats.assessment = assessment;
      if (current) this.emit({ type: "stats", phase: job.phase, requestId: job.requestId,
        sideToMove: job.sideToMove, stats: { assessment } });
    }
    if (parsed.type === "stats") {
      job.stats = { ...job.stats, ...parsed.stats };
      if (current) this.emit({ type: "stats", phase: job.phase, requestId: job.requestId,
        sideToMove: job.sideToMove, stats: parsed.stats });
    } else if (parsed.type === "move") {
      if (job.board[parsed.index] !== 0) throw new Error("引擎返回了无效落点");
      this.active = null;
      const result = { ...job.stats, index: parsed.index, x: parsed.x, y: parsed.y,
        elapsed: Math.round(this.now() - job.started),
        ...(job.recommendations ? { recommendations: job.recommendations.finish(job.board, parsed.index, job.sideToMove) } : {}) };
      if (job.phase === "ponder") this.onPonderSlice({ requestId: job.requestId, ...result });
      if (job.phase === "search") this.emit({ type: "move", requestId: job.requestId, result });
      // Pondering results are hypothetical player moves. They never become
      // application moves; resynchronize the full board before every slice.
      else if (current) this.emit({ type: "stats", phase: "ponder", requestId: job.requestId, sliceComplete: true,
        sideToMove: job.sideToMove, stats: { ...job.stats, elapsed: result.elapsed } });
      // Yield after stdout before starting the next search, allowing Rapfi's
      // move callback to finish updating its protocol and board state.
      this.scheduleNext();
    }
  }
}
