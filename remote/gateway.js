import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { createHttpSessions, HTTP_HEADERS } from "./http-sessions.js";

// The tunnel never targets the native service itself: no files or administration
// endpoints pass this boundary, and a key is required before contacting upstream.
export async function startGateway({ port = 4189, upstreamPort = 4188, token,
  origin = "https://5849mog.github.io" } = {}) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw Error("Invalid gateway key");
  let httpSessions;
  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.url === "/gomoku") { void httpSessions.handle(request, response); return; }
    if (request.url !== "/health" || request.headers.origin !== origin || !["GET", "OPTIONS"].includes(request.method)) {
      response.writeHead(404); response.end(); return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", HTTP_HEADERS);
    response.setHeader("Content-Type", "application/json");
    response.writeHead(request.method === "OPTIONS" ? 204 : 200);
    response.end(request.method === "OPTIONS" ? undefined : '{"protocol":1}');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  httpSessions = createHttpSessions({ token, origin, upstreamPort, otherClients: () => wss.clients.size });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/gomoku" || request.headers.origin !== origin || wss.clients.size + httpSessions.size >= 4) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws));
  });
  wss.on("connection", client => {
    let upstream, authenticated = false, upstreamReady = false, alive = true;
    const timer = setTimeout(() => client.close(1008, "authentication required"), 5000);
    const heartbeat = setInterval(() => {
      if (!alive) { client.terminate(); return; }
      alive = false; client.ping();
    }, 10000);
    client.on("pong", () => { alive = true; });
    const forward = (socket, bytes) => {
      if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1024 * 1024) { client.terminate(); return; }
      socket.send(bytes, { binary: false });
    };
    client.on("message", bytes => {
      if (authenticated) {
        if (!upstreamReady) { client.close(1008, "wait for welcome"); return; }
        forward(upstream, bytes); return;
      }
      let data;
      try { data = JSON.parse(bytes.toString()); } catch { client.close(1008, "invalid authentication"); return; }
      if (data?.type !== "auth" || typeof data.token !== "string" || !/^[a-f0-9]{64}$/.test(data.token) ||
        !timingSafeEqual(Buffer.from(data.token), Buffer.from(token)) || typeof data.clientId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(data.clientId)) {
        client.close(1008, "authentication failed"); return;
      }
      authenticated = true;
      upstream = new WebSocket(`ws://127.0.0.1:${upstreamPort}/gomoku`, { origin, maxPayload: 1024 * 1024, handshakeTimeout: 5000 });
      upstream.on("open", () => {
        if (client.readyState !== WebSocket.OPEN) { upstream.terminate(); return; }
        upstream.send(JSON.stringify(data));
      });
      upstream.on("message", message => { clearTimeout(timer); upstreamReady = true; forward(client, message); });
      upstream.on("ping", () => { if (client.readyState === WebSocket.OPEN) client.ping(); });
      upstream.on("close", () => client.close(1011, "engine disconnected"));
      upstream.on("error", () => client.close(1011, "engine unavailable"));
    });
    client.on("error", () => {});
    client.on("close", () => { clearTimeout(timer); clearInterval(heartbeat); upstream?.terminate(); });
  });
  try { await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", accept); }); }
  catch (error) { httpSessions.close(); wss.close(); throw error; }
  let closing;
  return { port: server.address().port, close: () => closing ??= (async () => {
    httpSessions.close();
    for (const client of wss.clients) client.terminate();
    await new Promise(done => wss.close(done));
    await new Promise(done => server.close(done));
  })() };
}
