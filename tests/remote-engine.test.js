import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { remoteAddress, RemoteWorker, readRemoteSettings, saveRemoteSettings } from "../remote-engine.js";
import { startRemote } from "../remote/server.js";
import { GomokuEngine } from "../engine.js";

const token = "a".repeat(64), origin = "https://5849mog.github.io";
class Socket extends WebSocket { constructor(url) { super(url, { origin }); } }
const empty = () => new Uint8Array(225);
test("remote addresses require encryption except loopback and do not accept embedded credentials", () => {
  assert.equal(remoteAddress("https://my.example"), "wss://my.example/gomoku");
  assert.equal(remoteAddress("http://127.0.0.1:4188/"), "ws://127.0.0.1:4188/gomoku");
  for (const value of ["http://192.168.0.1", "ws://computer.example", "https://user:key@example.com", "https://x.example/?token=abc", "https://x.example/path", "javascript:alert(1)"]) assert.throws(() => remoteAddress(value));
});
test("settings live in the supplied session store; corrupt/blocked storage leaves the web default intact", () => {
  const map = new Map(), storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
  assert.equal(readRemoteSettings(storage), null); saveRemoteSettings({ url: "https://engine.example", token }, storage);
  assert.deepEqual(readRemoteSettings(storage), { url: "wss://engine.example/gomoku", token });
  assert.throws(() => saveRemoteSettings({ url: "https://engine.example", token: "123" }, storage));
  saveRemoteSettings(null, storage); assert.equal(readRemoteSettings(storage), null);
  assert.equal(readRemoteSettings({ getItem() { throw Error("denied"); } }), null);
});
const tick = () => new Promise(done => setTimeout(done, 25));
test("authenticated worker protocol reuses one native session, reports actual resources and isolates cancelling generations", async () => {
  const runtimes = [];
  const server = await startRemote({ port: 0, token, threads: 1, runtimeFactory: options => {
    const runtime = { ...options, ready: Promise.resolve(), disposed: false,
      command(job) { if (job.type === "search") setTimeout(() => {
        options.emit({ type: "move", requestId: job.requestId, result: { index: job.board.findIndex(value => !value), backend: "remote-native-avx2", threads: 1, memoryMiB: 256 } });
      }, 20); }, dispose() { this.disposed = true; } }; runtimes.push(runtime); return runtime;
  } });
  const settings = { url: `ws://127.0.0.1:${server.port}`, token };
  const engine = new GomokuEngine({ capabilities: { simd: true, multi: false, threads: 1 }, workerFactory: () => new RemoteWorker(settings, { WebSocketImpl: Socket, id: "one-tab" }) });
  try {
    const before = [...empty()], result = await engine.search({ board: empty(), sideToMove: 1, timeMs: 1000, requestId: 1 });
    assert.equal(result.index, 0); assert.equal(engine.variant, "remote-native-avx2");
    await engine.search({ board: empty(), sideToMove: 1, timeMs: 1000, requestId: 2 }); assert.equal(runtimes.length, 1);
    const active = engine.search({ board: empty(), sideToMove: 1, timeMs: 1000, requestId: 3 });
    const cancelled = assert.rejects(active, { name: "AbortError" }); engine.reset(); await cancelled;
    const next = await engine.search({ board: empty(), sideToMove: 1, timeMs: 1000, requestId: 4 });
    assert.equal(next.requestId, 4); assert.equal(runtimes.length, 2); assert.ok(runtimes[0].disposed); assert.deepEqual([...empty()], before);
  } finally { engine.dispose(); await server.close(); }
});
test("bad origins and keys cannot initialize native processes; another tab cannot steal an active engine", async () => {
  let starts = 0, disposed = 0;
  const server = await startRemote({ port: 0, token, threads: 1, runtimeFactory: () => { starts++; return { ready: Promise.resolve(), command() {}, dispose() { disposed++; } }; } });
  const url = `ws://127.0.0.1:${server.port}/gomoku`, sockets = [];
  function connect(key, id, clientOrigin = origin) {
    const socket = new WebSocket(url, { origin: clientOrigin }); sockets.push(socket);
    return { socket, ready: new Promise((accept, reject) => {
      socket.once("error", reject); socket.once("open", () => socket.send(JSON.stringify({ type: "auth", token: key, clientId: id })));
      socket.once("message", data => accept(JSON.parse(data))); socket.once("close", () => reject(Error("closed")));
    }) };
  }
  try {
    await assert.rejects(connect(token, "bad-origin", "https://untrusted.example").ready);
    await assert.rejects(connect("b".repeat(64), "bad-key").ready); assert.equal(starts, 0);
    const first = connect(token, "first"), second = connect(token, "second"); await first.ready; await second.ready;
    const initialized = new Promise(done => first.socket.once("message", data => done(JSON.parse(data)))); first.socket.send(JSON.stringify({ type: "init", rule: "rif" }));
    assert.equal((await initialized).type, "ready");
    const refused = new Promise(done => second.socket.once("message", data => done(JSON.parse(data)))); second.socket.send(JSON.stringify({ type: "init", rule: "freestyle" }));
    assert.match((await refused).message, /另一个页面/); assert.equal(starts, 1);
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/shutdown`, { method: "POST", headers: { "X-Gomoku-Token": token } })).status, 200);
    await server.close(); assert.equal(disposed, 1);
  } finally { for (const socket of sockets) socket.terminate(); await tick(); await server.close(); }
});

test("network-permission health endpoint is origin-scoped, exposes no key, and cannot stop the service", async () => {
  const server = await startRemote({ port: 0, token, threads: 1, runtimeFactory: () => { throw Error("must not start"); } });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    assert.equal((await fetch(base + "/health")).status, 404);
    const good = await fetch(base + "/health", { headers: { Origin: origin } });
    assert.equal(good.headers.get("access-control-allow-origin"), origin); assert.deepEqual(await good.json(), { protocol: 1 });
    const preflight = await fetch(base + "/health", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Private-Network": "true" } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
    assert.equal((await fetch(base + "/shutdown", { method: "POST" })).status, 404);
    assert.equal((await fetch(base + "/shutdown", { method: "POST", headers: { Origin: origin, "X-Gomoku-Token": token } })).status, 404);
  } finally { await server.close(); }
});
