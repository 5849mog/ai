import { timingSafeEqual } from "node:crypto";
import { WebSocket } from "ws";

export const HTTP_HEADERS = "Authorization, X-Gomoku-Client, X-Gomoku-Session, X-Pinggy-No-Screen, Content-Type";

// Authenticated, bounded long polling for free relays that screen browser WS
// upgrades. It forwards the same protocol; it never runs another search engine.
export function createHttpSessions({ token, origin, upstreamPort, otherClients = () => 0 }) {
  const sessions = new Map();
  const destroy = session => {
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    clearTimeout(session.pollTimer); session.waiter?.([]); session.waiter = null;
    session.socket.terminate();
  };
  const sweep = setInterval(() => {
    for (const session of sessions.values()) if (Date.now() - session.touched > 20000) destroy(session);
  }, 5000);
  const flush = session => {
    if (!session.waiter || !session.messages.length) return;
    const done = session.waiter; session.waiter = null;
    clearTimeout(session.pollTimer); done(session.messages.splice(0));
  };
  const push = (session, data) => {
    if (data.type === "stats") {
      const index = session.messages.findIndex(item => item.type === "stats" && item.requestId === data.requestId && item.phase === data.phase);
      if (index >= 0) {
        data = { ...session.messages[index], ...data, stats: { ...session.messages[index].stats, ...data.stats } };
        session.messages.splice(index, 1);
      }
    }
    session.messages.push(data);
    if (session.messages.length > 128 || Buffer.byteLength(JSON.stringify(session.messages)) > 1024 * 1024) { destroy(session); return; }
    flush(session);
  };
  async function handle(request, response) {
    const send = (status, data) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(data === undefined ? undefined : JSON.stringify(data));
    };
    if (request.headers.origin !== origin) { send(403); return; }
    response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", HTTP_HEADERS);
    if (request.method === "OPTIONS") { send(204); return; }
    const credential = request.headers.authorization, client = request.headers["x-gomoku-client"], id = request.headers["x-gomoku-session"];
    if (typeof credential !== "string" || !/^Bearer [a-f0-9]{64}$/.test(credential) ||
      !timingSafeEqual(Buffer.from(credential.slice(7)), Buffer.from(token)) ||
      typeof client !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(client) ||
      typeof id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) { send(401); request.resume(); return; }
    let session = sessions.get(id);
    if (session && session.client !== client) { send(403); return; }
    if (session) session.touched = Date.now();
    try {
      if (request.method === "DELETE") { if (session) destroy(session); send(204); return; }
      if (request.method === "GET") {
        if (!session) { send(410); return; }
        if (session.waiter) { send(409); return; }
        if (session.messages.length) { send(200, session.messages.splice(0)); return; }
        const done = data => send(200, data); session.waiter = done;
        session.pollTimer = setTimeout(() => { if (session.waiter === done) session.waiter = null; done([]); }, 5000);
        response.once("close", () => { if (session.waiter === done) { session.waiter = null; clearTimeout(session.pollTimer); } });
        return;
      }
      if (request.method !== "POST") { send(405); return; }
      let body = "";
      for await (const bytes of request) {
        body += bytes.toString();
        if (Buffer.byteLength(body) > 32768) { send(413); return; }
      }
      let job;
      try { job = JSON.parse(body); } catch { send(400); return; }
      if (!job || typeof job !== "object" || Array.isArray(job)) { send(400); return; }
      if (job.type === "auth") {
        if (session) { send(409); return; }
        if (sessions.size + otherClients() >= 4) { send(429); return; }
        const socket = new WebSocket(`ws://127.0.0.1:${upstreamPort}/gomoku`, { origin, maxPayload: 1024 * 1024, handshakeTimeout: 5000 });
        session = { id, client, socket, messages: [], touched: Date.now(), ended: false };
        sessions.set(id, session);
        socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token, clientId: client })));
        socket.on("message", bytes => {
          try { push(session, JSON.parse(bytes.toString())); } catch { destroy(session); }
        });
        const ended = () => {
          if (!session.ended && sessions.get(id) === session) {
            session.ended = true; push(session, { type: "error", message: "电脑连接已断开，棋盘已保留，请重试" });
          }
        };
        socket.on("error", ended); socket.on("close", ended);
        send(202); return;
      }
      if (!session || session.ended) { send(410); return; }
      if (session.socket.readyState !== WebSocket.OPEN || session.socket.bufferedAmount > 1024 * 1024) { send(409); return; }
      session.socket.send(JSON.stringify(job)); send(202);
    } catch { send(400); }
  }
  return { handle, get size() { return sessions.size; }, close() { clearInterval(sweep); for (const session of sessions.values()) destroy(session); } };
}
