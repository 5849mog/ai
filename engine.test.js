import test from "node:test";
import assert from "node:assert/strict";
import { GomokuEngine, detectCapabilities, selectVariant } from "./engine.js";

class FakeWorker {
  sent = [];
  postMessage(message) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  send(data) { this.onmessage({ data }); }
}
function setup() {
  const workers = [];
  const events = [];
  const stats = [];
  const engine = new GomokuEngine({ onState: e => events.push(e), onStats: e => stats.push(e), capabilities: { simd: true, multi: false, threads: 1 },
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  return { engine, workers, events, stats };
}
const position = () => { const board = new Uint8Array(225); board[112] = 1; return board; };

test("background stats are streamed, late results ignored, and foreground search reuses the worker", async () => {
  const { engine, workers, events, stats } = setup();
  const board = new Uint8Array(225);
  const background = engine.ponder({ board, sideToMove: 1, requestId: 1 });
  workers[0].send({ type: "ready" }); await background;
  assert.equal(events.at(-1).pondering, true);
  workers[0].send({ type: "stats", phase: "ponder", requestId: 1, stats: { depth: 10 } });
  assert.equal(stats.at(-1).phase, "ponder");
  board[112] = 1;
  const search = engine.search({ board, sideToMove: 2, timeMs: 1000, requestId: 2 });
  await Promise.resolve();
  assert.ok(workers[0].sent.some(message => message.type === "stop-ponder"));
  workers[0].send({ type: "stats", phase: "ponder", requestId: 1, stats: { depth: 50 } });
  workers[0].send({ type: "move", requestId: 1, result: { index: 112 } });
  assert.equal(stats.at(-1).stats.depth, 10);
  assert.equal(engine.pending.requestId, 2);
  workers[0].send({ type: "move", requestId: 2, result: { index: 113 } });
  assert.equal((await search).index, 113);
  assert.equal(workers.length, 1);
  engine.dispose();
});

test("reset cancels waiting background initialization and a fresh black opening is accepted", async () => {
  const { engine, workers, stats } = setup();
  const background = engine.ponder({ board: new Uint8Array(225), sideToMove: 1, requestId: 1 });
  const cancelled = assert.rejects(background, { name: "AbortError" });
  engine.reset(); await cancelled;
  const opening = engine.search({ board: new Uint8Array(225), sideToMove: 1, requestId: 2 });
  workers[1].send({ type: "ready" }); await Promise.resolve();
  workers[0].send({ type: "stats", phase: "ponder", requestId: 1, stats: { depth: 99 } });
  assert.equal(stats.length, 0);
  workers[1].send({ type: "move", requestId: 2, result: { index: 112 } });
  assert.equal((await opening).index, 112);
  engine.dispose();
});

test("capability selection does not require shared memory on ordinary hosting", () => {
  assert.equal(selectVariant({ simd: true, multi: false }), "rapfi-single-simd128");
  assert.equal(selectVariant({ simd: false, multi: true }), "rapfi-multi");
  const cap = detectCapabilities({ WebAssembly, navigator: { hardwareConcurrency: 16 }, crossOriginIsolated: true, SharedArrayBuffer });
  assert.equal(cap.threads, 4);
  const tiny = detectCapabilities({ WebAssembly, navigator: { hardwareConcurrency: 1 }, crossOriginIsolated: true, SharedArrayBuffer });
  assert.equal(tiny.threads, 1);
  assert.equal(detectCapabilities({ WebAssembly, crossOriginIsolated: false }).multi, false);
});

test("search preserves input, collects stats and reuses the worker", async () => {
  const { engine, workers, stats } = setup();
  const board = position();
  const original = board.slice();
  const first = engine.search({ board, sideToMove: 2, timeMs: 5000, requestId: 1 });
  workers[0].send({ type: "ready" });
  await Promise.resolve();
  workers[0].send({ type: "stats", requestId: 1, stats: { nodes: 321, depth: 5 } });
  assert.equal(stats[0].phase, "search");
  assert.equal(stats[0].stats.depth, 5);
  assert.equal(stats[0].sideToMove, 2);
  workers[0].send({ type: "move", requestId: 1, result: { index: 113, elapsed: 40 } });
  assert.equal((await first).nodes, 321);
  assert.deepEqual(board, original);
  const second = engine.search({ board, sideToMove: 2, requestId: 2 });
  await Promise.resolve();
  workers[0].send({ type: "move", requestId: 2, result: { index: 97 } });
  await second;
  assert.equal(workers.length, 1);
  engine.dispose();
});

test("cancellation rejects the pending search and old responses cannot resolve a new one", async () => {
  const { engine, workers } = setup();
  const first = engine.search({ board: position(), sideToMove: 2, requestId: 1 });
  workers[0].send({ type: "ready" });
  await Promise.resolve();
  const rejected = assert.rejects(first, { name: "AbortError" });
  engine.cancel();
  await rejected;
  const second = engine.search({ board: position(), sideToMove: 2, requestId: 2 });
  workers[1].send({ type: "ready" });
  await Promise.resolve();
  workers[0].send({ type: "move", requestId: 1, result: { index: 113 } });
  workers[1].send({ type: "move", requestId: 1, result: { index: 114 } });
  workers[1].send({ type: "error", requestId: 1, message: "stale failure" });
  assert.equal(engine.pending.requestId, 2);
  workers[1].send({ type: "move", requestId: 2, result: { index: 97 } });
  assert.equal((await second).index, 97);
  assert.ok(workers[0].terminated);
  engine.dispose();
});

test("occupied, out-of-range and malformed engine moves fail without a fallback", async () => {
  for (const index of [112, -1, 225, NaN]) {
    const { engine, workers, events } = setup();
    const search = engine.search({ board: position(), sideToMove: 2, requestId: 1 });
    workers[0].send({ type: "ready" });
    await Promise.resolve();
    workers[0].send({ type: "move", requestId: 1, result: { index } });
    await assert.rejects(search, /无效/);
    assert.equal(events.at(-1).state, "error");
    assert.equal(workers.length, 1);
  }
});

test("a synchronous initialization failure can be retried", async () => {
  let attempts = 0;
  const worker = new FakeWorker();
  const engine = new GomokuEngine({ workerFactory: () => { if (++attempts === 1) throw new Error("offline"); return worker; } });
  await assert.rejects(engine.init(), /offline/);
  const retry = engine.init();
  worker.send({ type: "ready" });
  await retry;
  assert.equal(attempts, 2);
  engine.dispose();
});

test("recommendations are read-only, reuse the worker and reject malformed alternative sets", async () => {
  const { engine, workers } = setup();
  const board = position(), original = board.slice();
  const first = engine.search({ board, sideToMove: 2, timeMs: 2000, requestId: 1, multiPV: 2 });
  workers[0].send({ type: "ready" }); await Promise.resolve();
  assert.equal(workers[0].sent.at(-1).multiPV, 2);
  workers[0].send({ type: "move", requestId: 1, result: { index: 113, recommendations: [{ index: 113 }, { index: 127 }] } });
  assert.equal((await first).recommendations.length, 2);
  assert.deepEqual(board, original);
  const second = engine.search({ board, sideToMove: 2, timeMs: 1000, requestId: 2 });
  await Promise.resolve();
  assert.equal(workers[0].sent.at(-1).multiPV, 1);
  workers[0].send({ type: "move", requestId: 2, result: { index: 97 } }); await second;
  assert.equal(workers.length, 1); engine.dispose();
  for (const recommendations of [undefined, [], [{ index: 112 }], [{ index: 225 }], [{ index: 113 }, { index: 113 }]]) {
    const { engine, workers } = setup();
    const job = engine.search({ board, sideToMove: 2, timeMs: 2000, requestId: 1, multiPV: 2 });
    workers[0].send({ type: "ready" }); await Promise.resolve();
    workers[0].send({ type: "move", requestId: 1, result: { index: 113, recommendations } });
    await assert.rejects(job, /无效推荐/); engine.dispose();
  }
});
