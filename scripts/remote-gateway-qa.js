import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { startRemote } from "../remote/server.js";
import { startGateway } from "../remote/gateway.js";
import { RemoteWorker } from "../remote-engine.js";
import { GomokuEngine } from "../engine.js";

const token = randomBytes(32).toString("hex");
const service = await startRemote({ port: 0, token });
let gateway, engine;
try {
  gateway = await startGateway({ port: 0, upstreamPort: service.port, token });
  class Socket extends WebSocket {
    constructor(url) { super(url, { origin: "https://5849mog.github.io" }); }
  }
  engine = new GomokuEngine({ workerFactory: () => new RemoteWorker({ url: `ws://127.0.0.1:${gateway.port}`, token }, { WebSocketImpl: Socket, id: "native-gateway-qa" }) });
  const board = new Uint8Array(225); board[112] = 1;
  const before = [...board];
  const result = await engine.search({ board, sideToMove: 2, multiPV: 3, timeMs: 1000, requestId: 1 });
  assert.equal(result.backend, "remote-native-avx2"); assert.equal(result.threads, service.threads);
  assert.equal(result.memoryMiB, 256); assert.equal(board[result.index], 0);
  assert.deepEqual([...board], before); assert.equal(result.recommendations.length, 3);
  console.log(JSON.stringify({ path: "loopback restricted gateway to real native engine", internetTested: false,
    threads: result.threads, memoryMiB: result.memoryMiB, budgetMs: 1000, legalMove: result.index, recommendations: result.recommendations.length, passed: true }));
} finally { engine?.dispose(); await gateway?.close(); await service.close(); }
