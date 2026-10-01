import { validatePosition, validIndex } from "./game-rules.js";

export const ENGINE_BASE = new URL("./engine/rapfi-250615/", import.meta.url);
export const MEMORY_BYTES = 256 * 1024 * 1024;
const SIMD_PROBE = new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,9,1,7,0,65,0,253,15,26,11]);

export function detectCapabilities(scope = globalThis) {
  const simd = scope.WebAssembly?.validate(SIMD_PROBE) ?? false;
  let multi = false;
  if (scope.crossOriginIsolated && typeof scope.SharedArrayBuffer === "function") {
    try { multi = new scope.WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof scope.SharedArrayBuffer; } catch { /* single-thread build remains available */ }
  }
  const cores = scope.navigator?.hardwareConcurrency ?? 2;
  return { simd, multi, threads: multi ? Math.max(1, Math.min(4, cores - 1)) : 1 };
}

export function selectVariant({ simd, multi }) {
  return `rapfi-${multi ? "multi" : "single"}${simd ? "-simd128" : ""}`;
}

function aborted() { return new DOMException("搜索已取消", "AbortError"); }

export class GomokuEngine {
  constructor({ onState = () => {}, workerFactory, capabilities, variant, threads } = {}) {
    this.onState = onState;
    this.workerFactory = workerFactory ?? (() => new Worker(new URL("./engine.worker.js", import.meta.url)));
    this.capabilities = capabilities ?? detectCapabilities();
    this.variant = variant ?? selectVariant(this.capabilities);
    this.threads = this.variant.includes("multi") ? Math.max(1, Math.min(4, threads ?? this.capabilities.threads)) : 1;
    this.worker = null;
    this.generation = 0;
    this.pending = null;
    this.ready = false;
    this.initPromise = null;
  }

  init() {
    if (this.initPromise) return this.initPromise;
    this.onState({ state: "loading" });
    const generation = ++this.generation;
    let resolve;
    this.initPromise = new Promise((resolveInit, rejectInit) => {
      resolve = resolveInit;
      this.initReject = rejectInit;
    });
    const initialization = this.initPromise;
    this.initTimer = setTimeout(() => this.fail(new Error("引擎加载超时，请重试")), 60_000);
    try {
      const worker = this.workerFactory();
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (generation !== this.generation || worker !== this.worker) return;
        if (data.type === "ready") {
          clearTimeout(this.initTimer);
          this.ready = true;
          this.initReject = null;
          this.onState({ state: "ready", variant: this.variant, threads: this.threads });
          resolve({ variant: this.variant, threads: this.threads });
        } else if (data.type === "loading") {
          this.onState({ state: "loading", progress: data.progress });
        } else if (data.type === "error") {
          if (data.requestId != null && data.requestId !== this.pending?.requestId) return;
          this.fail(new Error(data.message || "引擎暂不可用"));
        } else if (this.pending && data.requestId === this.pending.requestId) {
          if (data.type === "stats") this.pending.stats = { ...this.pending.stats, ...data.stats };
          if (data.type === "move") {
            const pending = this.pending;
            const result = data.result;
            if (!result || !validIndex(result.index) || pending.board[result.index] !== 0) {
              this.fail(new Error("引擎返回了无效落点"));
              return;
            }
            clearTimeout(pending.timer);
            this.pending = null;
            this.onState({ state: "ready", variant: this.variant, threads: this.threads });
            pending.resolve({ ...pending.stats, ...result, requestId: data.requestId });
          }
        }
      };
      worker.onerror = () => { if (generation === this.generation) this.fail(new Error("引擎运行失败，请重试")); };
      worker.postMessage({ type: "init", baseURL: ENGINE_BASE.href, variant: this.variant,
        threads: this.threads, memoryBytes: MEMORY_BYTES });
    } catch (error) { this.fail(error); }
    return initialization;
  }

  async search({ board, sideToMove, timeMs = 10_000, requestId }) {
    validatePosition(board, sideToMove);
    if (!Number.isInteger(timeMs) || timeMs < 1 || timeMs > 30_000) throw new Error("思考时间无效");
    if (!Number.isSafeInteger(requestId) || requestId < 0) throw new Error("请求编号无效");
    const copy = Array.from(board);
    const ready = this.init();
    const generation = this.generation;
    await ready;
    if (generation !== this.generation) throw aborted();
    if (this.pending) throw new Error("已有搜索正在进行");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("引擎未能按时返回，请重试")), timeMs + 3000);
      this.pending = { requestId, board: copy, resolve, reject, timer, stats: {} };
      this.onState({ state: "thinking" });
      try { this.worker.postMessage({ type: "search", board: copy, sideToMove, timeMs, requestId }); }
      catch (error) { this.fail(error); }
    });
  }

  reset(error = aborted()) {
    this.generation += 1;
    clearTimeout(this.initTimer);
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.initReject?.(error);
    this.initReject = null;
    this.initPromise = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
  }

  cancel() {
    if (this.pending || (this.worker && !this.ready)) {
      this.reset();
      this.onState({ state: "idle" });
    }
  }

  fail(error) {
    this.reset(error);
    this.onState({ state: "error", message: error.message });
  }

  dispose() { this.reset(); }
}
