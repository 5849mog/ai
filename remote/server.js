import http from "node:http";
import https from "node:https";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { availableParallelism, totalmem } from "node:os";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { NativeRuntime, RULES } from "./native-runtime.js";
const nativeFactory = options => new NativeRuntime(options);

export async function verifyRuntime(directory) {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (manifest.sourceCommit !== "1be1551ced57e38d53ed58f6d74bf6f8b4bdc230" || manifest.networksCommit !== "918b757a129258e9e765f77fe17d507c2bb1a60b") throw Error("电脑引擎版本与网页不对应");
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(name) || name.split("/").some(part => part.startsWith("."))) throw Error("引擎文件路径无效");
    const bytes = await readFile(join(directory, name));
    if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) throw Error(`电脑引擎文件校验失败：${name}`);
  }
}

export async function startRemote({ port = 4188, token = randomBytes(32).toString("hex"),
  origins = ["https://5849mog.github.io"], directory = fileURLToPath(new URL("./engine/", import.meta.url)),
  threads = Math.max(1, availableParallelism() - 1), memoryMiB = 256, tls, runtimeFactory = nativeFactory } = {}) {
  const maxThreads = Math.max(1, availableParallelism() - 1), maxMemory = Math.min(4096, Math.floor(totalmem() / 2 ** 21));
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error("配对密钥必须为 32 字节随机值");
  if (!Number.isInteger(threads) || threads < 1 || threads > maxThreads) throw Error(`线程数须为 1…${maxThreads}，为系统保留一个逻辑核心`);
  if (!Number.isInteger(memoryMiB) || memoryMiB < 32 || memoryMiB > maxMemory) throw Error(`搜索内存须为 32…${maxMemory} MiB`);
  if (!origins.length || origins.some(origin => new URL(origin).origin !== origin)) throw Error("网页来源配置无效");
  if (runtimeFactory === nativeFactory) await verifyRuntime(directory);
  let closeService;
  const respond = (request, response) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.url === "/health" && origins.includes(request.headers.origin) && ["GET", "OPTIONS"].includes(request.method)) {
      response.setHeader("Access-Control-Allow-Origin", request.headers.origin); response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS"); response.setHeader("Access-Control-Allow-Private-Network", "true");
      response.setHeader("Content-Type", "application/json"); response.writeHead(request.method === "OPTIONS" ? 204 : 200);
      response.end(request.method === "OPTIONS" ? undefined : JSON.stringify({ protocol: 1 })); return;
    }
    const key = request.headers["x-gomoku-token"];
    if (request.url === "/shutdown" && request.method === "POST" && !request.headers.origin && typeof key === "string" && /^[a-f0-9]{64}$/.test(key) && timingSafeEqual(Buffer.from(key), Buffer.from(token))) {
      response.writeHead(200); response.end("stopping"); setImmediate(() => void closeService()); return;
    }
    response.writeHead(404); response.end();
  };
  const server = tls ? https.createServer(tls, respond) : http.createServer(respond);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024, perMessageDeflate: false });
  let owner = null;
  server.on("upgrade", (request, socket, head) => {
    if (!origins.includes(request.headers.origin) || request.url !== "/gomoku" || wss.clients.size >= 16) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    wss.handleUpgrade(request, socket, head, connection => wss.emit("connection", connection));
  });
  wss.on("connection", socket => {
    let authenticated = false, clientId, runtime, pendingStats = null, statsTimer, alive = true;
    const send = data => {
      if (socket.readyState !== 1) return;
      if (socket.bufferedAmount > 1024 * 1024) { socket.terminate(); return; }
      socket.send(JSON.stringify(data));
    };
    const flush = () => { clearTimeout(statsTimer); statsTimer = null; if (pendingStats) { send(pendingStats); pendingStats = null; } };
    const emit = message => {
      if (message.type === "stats") {
        if (pendingStats && (pendingStats.requestId !== message.requestId || pendingStats.phase !== message.phase)) flush();
        pendingStats = { ...message, stats: { ...pendingStats?.stats, ...message.stats } };
        if (message.sliceComplete) flush(); else if (!statsTimer) statsTimer = setTimeout(flush, 75);
      } else { flush(); send(message); }
    };
    const release = () => { clearTimeout(statsTimer); pendingStats = null; runtime?.dispose(); runtime = null; if (owner?.socket === socket) owner = null; };
    const authTimer = setTimeout(() => socket.close(1008, "authentication required"), 5000);
    const heartbeat = setInterval(() => { if (!alive) { socket.terminate(); return; } alive = false; socket.ping(); }, 10000);
    socket.on("pong", () => { alive = true; });
    // Keep each connection's commands ordered even while native initialization awaits OK.
    let commands = Promise.resolve(), queued = 0;
    socket.on("message", bytes => {
      if (++queued > 32) { socket.close(1008, "too many requests"); return; }
      commands = commands.then(async () => {
        const data = JSON.parse(bytes.toString());
        if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("请求格式无效");
        if (!authenticated) {
          if (data.type !== "auth" || typeof data.token !== "string" || !/^[a-f0-9]{64}$/.test(data.token)
            || !timingSafeEqual(Buffer.from(data.token), Buffer.from(token)) || !/^[a-zA-Z0-9-]{1,64}$/.test(data.clientId ?? "")) { socket.close(1008, "authentication failed"); return; }
          authenticated = true; clientId = data.clientId; clearTimeout(authTimer);
          send({ type: "welcome", protocol: 1, backend: "remote-native-avx2", threads, memoryMiB, maxThreads, rules: [...RULES] }); return;
        }
        if (socket.readyState !== 1) return;
        if (data.type === "init") {
          if (!RULES.has(data.rule) || runtime) throw Error("引擎初始化请求无效");
          if (owner && owner.socket !== socket) {
            if (owner.clientId !== clientId) throw Error("电脑引擎正由另一个页面使用，请先断开原页面");
            const previous = owner; previous.release(); previous.socket.close(1000, "replaced by same page");
          }
          owner = { socket, clientId, release };
          runtime = runtimeFactory({ directory, rule: data.rule, threads, memoryMiB, emit, reportSlices: data.reportSlices === true });
          await runtime.ready;
          send({ type: "ready", backend: "remote-native-avx2", threads, memoryMiB }); return;
        }
        if (!runtime) throw Error("电脑引擎尚未准备好");
        runtime.command(data);
      }).catch(error => { if (authenticated) send({ type: "error", message: error.message }); else socket.close(1008, "invalid authentication"); })
        .finally(() => { queued--; });
    });
    socket.on("error", () => {});
    socket.on("close", () => { clearTimeout(authTimer); clearInterval(heartbeat); release(); });
  });
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", accept); });
  let closing;
  closeService = () => closing ??= (async () => { for (const client of wss.clients) client.terminate(); await new Promise(done => wss.close(done)); await new Promise(done => server.close(done)); })();
  return { port: server.address().port, threads, memoryMiB, token, get active() { return Boolean(owner); }, close: closeService };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = join(process.env.LOCALAPPDATA ?? process.cwd(), "GomokuRemote"); await mkdir(data, { recursive: true });
  const keyFile = join(data, "pairing-key.txt"); let token;
  try { token = (await readFile(keyFile, "utf8")).trim(); } catch { token = randomBytes(32).toString("hex"); await writeFile(keyFile, token + "\n", { mode: 0o600 }); }
  const app = await startRemote({ token, port: Number(process.env.GOMOKU_REMOTE_PORT ?? 4188),
    threads: process.env.GOMOKU_REMOTE_THREADS ? Number(process.env.GOMOKU_REMOTE_THREADS) : undefined,
    memoryMiB: Number(process.env.GOMOKU_REMOTE_MEMORY_MIB ?? 256),
    origins: process.env.GOMOKU_REMOTE_ORIGINS?.split(",").map(value => value.trim()),
    tls: process.env.GOMOKU_REMOTE_TLS_CERT && process.env.GOMOKU_REMOTE_TLS_KEY
      ? { cert: await readFile(process.env.GOMOKU_REMOTE_TLS_CERT), key: await readFile(process.env.GOMOKU_REMOTE_TLS_KEY) } : undefined });
  console.log(`五目电脑计算服务：127.0.0.1:${app.port} · ${app.threads} 线程 · ${app.memoryMiB} MiB`);
  console.log(`配对密钥文件：${keyFile}`);
  console.log("将现有 HTTPS/WSS 穿透服务转发到此端口；网页菜单 → 电脑引擎，填写地址与密钥。");
  const close = () => void app.close(); process.once("SIGINT", close); process.once("SIGTERM", close);
}
