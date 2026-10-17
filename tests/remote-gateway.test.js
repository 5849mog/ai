import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { startRemote } from "../remote/server.js";
import { startGateway } from "../remote/gateway.js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

test("Internet gateway blocks admin/files and unauthorized clients while forwarding authenticated engine traffic", async () => {
  const token = "c".repeat(64), origin = "https://5849mog.github.io";
  let starts = 0;
  const engine = await startRemote({ port: 0, token, threads: 1, runtimeFactory: () => {
    starts++; return { ready: Promise.resolve(), command() {}, dispose() {} };
  } });
  const gateway = await startGateway({ port: 0, upstreamPort: engine.port, token });
  const base = `http://127.0.0.1:${gateway.port}`, sockets = [];
  const connect = (key, clientOrigin = origin) => {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/gomoku", { origin: clientOrigin }); sockets.push(ws);
    return { ws, welcome: new Promise((accept, reject) => {
      ws.on("error", reject); ws.once("close", () => reject(Error("closed")));
      ws.once("open", () => ws.send(JSON.stringify({ type: "auth", token: key, clientId: "gateway-test" })));
      ws.once("message", bytes => accept(JSON.parse(bytes)));
    }) };
  };
  try {
    for (const path of ["/", "/pairing-key.txt", "/shutdown", "/health?extra=1"]) {
      assert.equal((await fetch(base + path, { method: "POST", headers: { "X-Gomoku-Token": token } })).status, 404);
    }
    assert.equal((await fetch(base + "/health")).status, 404);
    assert.deepEqual(await (await fetch(base + "/health", { headers: { Origin: origin } })).json(), { protocol: 1 });
    await assert.rejects(connect(token, "https://wrong.example").welcome);
    await assert.rejects(connect("d".repeat(64)).welcome);
    await assert.rejects(connect([token]).welcome); assert.equal(starts, 0);
    const good = connect(token); assert.equal((await good.welcome).type, "welcome");
    const ready = new Promise(done => good.ws.once("message", bytes => done(JSON.parse(bytes))));
    good.ws.send(JSON.stringify({ type: "init", rule: "freestyle" })); assert.equal((await ready).type, "ready");
    assert.equal(starts, 1);
    assert.equal((await fetch(`http://127.0.0.1:${engine.port}/health`, { headers: { Origin: origin } })).status, 200);
  } finally { for (const socket of sockets) socket.terminate(); await gateway.close(); await engine.close(); }
});

test("launcher shutdown closes both native and restricted gateway listeners", { timeout: 20000 }, async () => {
  const data = await mkdtemp(join(tmpdir(), "gomoku-gateway-test-"));
  const child = spawn(process.execPath, ["remote/server.js"], {
    env: { ...process.env, LOCALAPPDATA: data, GOMOKU_REMOTE_PORT: "0", GOMOKU_REMOTE_GATEWAY_PORT: "0" },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  const exited = once(child, "exit");
  let stdout = "", stderr = "";
  child.stderr.on("data", bytes => { stderr += bytes; });
  try {
    const ports = await new Promise((accept, reject) => {
      const timer = setTimeout(() => reject(Error("CLI not ready: " + stderr)), 10000);
      child.once("exit", () => { clearTimeout(timer); reject(Error("CLI exited: " + stderr)); });
      child.stdout.on("data", bytes => {
        stdout += bytes;
        const native = /计算服务：127\.0\.0\.1:(\d+)/.exec(stdout), gateway = /对弈入口：127\.0\.0\.1:(\d+)/.exec(stdout);
        if (native && gateway) { clearTimeout(timer); accept({ native: +native[1], gateway: +gateway[1] }); }
      });
    });
    const key = (await readFile(join(data, "GomokuRemote", "pairing-key.txt"), "utf8")).trim();
    const response = await fetch(`http://127.0.0.1:${ports.native}/shutdown`, { method: "POST", headers: { "X-Gomoku-Token": key } });
    assert.equal(response.status, 200); assert.equal((await exited)[0], 0);
    await assert.rejects(fetch(`http://127.0.0.1:${ports.native}/health`));
    await assert.rejects(fetch(`http://127.0.0.1:${ports.gateway}/health`));
  } finally {
    if (child.exitCode === null) { child.kill(); await exited; }
    await rm(join(data, "GomokuRemote", "pairing-key.txt"), { force: true });
    await rmdir(join(data, "GomokuRemote")).catch(() => {}); await rmdir(data);
  }
});
