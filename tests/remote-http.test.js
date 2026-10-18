import test from "node:test";
import assert from "node:assert/strict";
import { startRemote } from "../remote/server.js";
import { startGateway } from "../remote/gateway.js";
import { HttpRemoteWorker, usesHttpRelay } from "../remote-engine.js";
import { GomokuEngine } from "../engine.js";

const token = "e".repeat(64), origin = "https://5849mog.github.io";
test("HTTP relay keeps engine validation, reuse and cancellation and never puts a key in the URL", async () => {
  const runtimes = [], calls = [];
  const native = await startRemote({ port: 0, token, threads: 1, runtimeFactory: options => {
    const runtime = { ready: Promise.resolve(), disposed: false, command(job) {
      if (job.type === "search") setTimeout(() => options.emit({ type: "move", requestId: job.requestId,
        result: { index: job.board.findIndex(value => !value), backend: "remote-native-avx2", threads: 1, memoryMiB: 256 } }), 20);
    }, dispose() { this.disposed = true; } }; runtimes.push(runtime); return runtime;
  } });
  const gateway = await startGateway({ port: 0, upstreamPort: native.port, token });
  const fetchImpl = function (url, options) {
    assert.equal(this, undefined, "browser fetch must not be invoked with a Worker receiver");
    calls.push({ url, headers: options.headers });
    return fetch(`http://127.0.0.1:${gateway.port}/gomoku`, { ...options, headers: { ...options.headers, Origin: origin } });
  };
  const engine = new GomokuEngine({ workerFactory: () => new HttpRemoteWorker({ url: "https://test.run.pinggy-free.link", token }, { fetchImpl, id: "same-tab" }) });
  try {
    const board = new Uint8Array(225), before = [...board];
    assert.equal((await engine.search({ board, sideToMove: 1, timeMs: 1000, requestId: 1 })).index, 0);
    await engine.search({ board, sideToMove: 1, timeMs: 1000, requestId: 2 }); assert.equal(runtimes.length, 1);
    const pending = engine.search({ board, sideToMove: 1, timeMs: 1000, requestId: 3 });
    const rejected = assert.rejects(pending, { name: "AbortError" }); engine.reset(); await rejected;
    assert.equal((await engine.search({ board, sideToMove: 1, timeMs: 1000, requestId: 4 })).requestId, 4);
    assert.equal(runtimes.length, 2); assert.ok(runtimes[0].disposed); assert.deepEqual([...board], before);
    assert.ok(calls.every(call => !call.url.includes(token) && call.headers.Authorization === `Bearer ${token}` && call.headers["X-Pinggy-No-Screen"] === "1"));
    assert.ok(usesHttpRelay({ url: "https://abc.free.pinggy.net" })); assert.equal(usesHttpRelay({ url: "https://somewhere.example" }), false);
  } finally { engine.dispose(); await new Promise(done => setTimeout(done, 50)); await gateway.close(); await native.close(); }
});

test("HTTP relay requires origin and key, bounds sessions, and does not expose administration", async () => {
  let starts = 0;
  const native = await startRemote({ port: 0, token, threads: 1, runtimeFactory: () => { starts++; throw Error("unexpected runtime"); } });
  const gateway = await startGateway({ port: 0, upstreamPort: native.port, token });
  const base = `http://127.0.0.1:${gateway.port}`, headers = { Origin: origin, Authorization: `Bearer ${token}`, "X-Gomoku-Client": "client", "X-Gomoku-Session": "session" };
  const auth = { method: "POST", headers, body: '{"type":"auth"}' };
  try {
    assert.equal((await fetch(base + "/gomoku", { ...auth, headers: { ...headers, Origin: "https://bad.example" } })).status, 403);
    assert.equal((await fetch(base + "/gomoku", { ...auth, headers: { ...headers, Authorization: "Bearer bad" } })).status, 401);
    const preflight = await fetch(base + "/gomoku", { method: "OPTIONS", headers: { Origin: origin } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Max-Age"), "600");
    assert.equal((await fetch(base + "/gomoku", auth)).status, 202);
    assert.equal((await fetch(base + "/gomoku", { headers: { ...headers, "X-Gomoku-Client": "different" } })).status, 403);
    assert.equal((await fetch(base + "/gomoku", { ...auth, body: JSON.stringify({ x: "a".repeat(40000) }) })).status, 413);
    for (let i = 1; i < 4; i++) assert.equal((await fetch(base + "/gomoku", { ...auth, headers: { ...headers, "X-Gomoku-Session": `session${i}` } })).status, 202);
    assert.equal((await fetch(base + "/gomoku", { ...auth, headers: { ...headers, "X-Gomoku-Session": "over-limit" } })).status, 429);
    assert.equal((await fetch(base + "/shutdown", { ...auth, headers: { ...headers, "X-Gomoku-Token": token } })).status, 404);
    assert.equal((await fetch(base + "/gomoku", { method: "DELETE", headers })).status, 204);
    assert.equal((await fetch(base + "/gomoku", { headers })).status, 410); assert.equal(starts, 0);
  } finally { await gateway.close(); await native.close(); }
});

test("remote search allows a slow stop-ponder round trip without increasing the native budget", async () => {
  let searchBudget;
  const native = await startRemote({ port: 0, token, threads: 1, runtimeFactory: options => ({
    ready: Promise.resolve(), dispose() {}, command(job) {
      if (job.type === "search") {
        searchBudget = job.timeMs;
        options.emit({ type: "move", requestId: job.requestId, result: { index: 0 } });
      }
    }
  }) });
  const gateway = await startGateway({ port: 0, upstreamPort: native.port, token });
  const fetchImpl = async function (url, options) {
    if (options.body && JSON.parse(options.body).type === "stop-ponder") await new Promise(done => setTimeout(done, 4300));
    return fetch(`http://127.0.0.1:${gateway.port}/gomoku`, { ...options, headers: { ...options.headers, Origin: origin } });
  };
  const engine = new GomokuEngine({ workerFactory: () => new HttpRemoteWorker({ url: "https://test.run.pinggy-free.link", token }, { fetchImpl, id: "slow-tab" }) });
  try {
    const board = new Uint8Array(225);
    await engine.ponder({ board, sideToMove: 1, requestId: 1 });
    const result = await engine.search({ board, sideToMove: 1, timeMs: 1000, requestId: 2 });
    assert.equal(result.index, 0); assert.equal(searchBudget, 1000);
    assert.equal(engine.ready, true);
  } finally { engine.dispose(); await new Promise(done => setTimeout(done, 50)); await gateway.close(); await native.close(); }
});
