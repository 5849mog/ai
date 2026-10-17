const KEY = `gomoku-remote:${new URL("./", import.meta.url).pathname}:v1`;
const CLIENT_KEY = KEY + ":client";
const changed = detail => { if (typeof window !== "undefined") window.dispatchEvent(new window.CustomEvent("gomoku-remote-state", { detail })); };

export function remoteAddress(value) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || !["", "/", "/gomoku"].includes(url.pathname)) throw Error("请填写计算服务的根地址，不要附带路径或参数");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!["https:", "wss:"].includes(url.protocol) && !(loopback && ["http:", "ws:"].includes(url.protocol))) throw Error("远程连接需要 HTTPS / WSS 加密地址");
  url.protocol = ["http:", "ws:"].includes(url.protocol) ? "ws:" : "wss:"; url.pathname = "/gomoku";
  return url.href;
}
export function readRemoteSettings(storage) {
  try {
    storage ??= globalThis.sessionStorage;
    const value = JSON.parse(storage.getItem(KEY));
    if (!value || !/^[a-f0-9]{64}$/.test(value.token)) return null;
    return { url: remoteAddress(value.url), token: value.token };
  } catch { return null; }
}
export function saveRemoteSettings(value, storage = globalThis.sessionStorage) {
  if (!value) { storage.removeItem(KEY); return; }
  if (!/^[a-f0-9]{64}$/.test(value.token?.trim() ?? "")) throw Error("请填写电脑服务生成的完整配对密钥");
  storage.setItem(KEY, JSON.stringify({ url: remoteAddress(value.url), token: value.token.trim() }));
}
function clientId() {
  try {
    const previous = sessionStorage.getItem(CLIENT_KEY); if (previous) return previous;
    const value = crypto.randomUUID(); sessionStorage.setItem(CLIENT_KEY, value); return value;
  } catch { return crypto.randomUUID(); }
}

// Worker-shaped transport: retain all existing GomokuEngine validation,
// request generations, state callbacks and cancellation for both web pages.
export class RemoteWorker {
  constructor(settings, { WebSocketImpl = globalThis.WebSocket, id = clientId(), onWelcome = () => {} } = {}) {
    this.settings = settings; this.queue = []; this.closed = false; this.welcomed = false;
    this.socket = new WebSocketImpl(remoteAddress(settings.url));
    this.timer = setTimeout(() => this.fail("无法连接电脑，请确认电脑服务与远程通道正在运行"), 10000);
    this.socket.addEventListener("open", () => {
      if (!this.closed) this.socket.send(JSON.stringify({ type: "auth", token: settings.token, clientId: id }));
    });
    this.socket.addEventListener("message", event => {
      if (this.closed) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "welcome") {
          if (data.protocol !== 1 || !Number.isInteger(data.threads) || data.threads < 1 || !Number.isInteger(data.memoryMiB)) throw Error("电脑服务版本不兼容");
          clearTimeout(this.timer); this.welcomed = true; this.metadata = data;
          changed({ state: "connected", ...data }); onWelcome(data);
          for (const job of this.queue.splice(0)) this.postMessage(job);
        } else {
          if (!this.welcomed) throw Error("电脑服务尚未认证");
          if (data.type === "ready") changed({ state: "ready", ...data });
          this.onmessage?.({ data });
        }
      } catch (error) { this.fail(error.message); }
    });
    this.socket.addEventListener("close", event => {
      if (!this.closed) this.fail(event.code === 1008 ? "电脑配对失败，请检查密钥和网页来源设置" : "电脑连接已断开，棋盘已保留；可重试或切回网页计算");
    });
    this.socket.addEventListener("error", () => { if (!this.closed) this.fail("无法连接电脑：请确认服务与加密通道已开启，并在网站权限中允许‘本地网络访问’后重试"); });
  }
  postMessage(data) {
    if (this.closed) throw Error("电脑连接已关闭");
    if (!this.welcomed) { if (this.queue.length >= 8) throw Error("连接尚未准备好"); this.queue.push(data); return; }
    this.socket.send(JSON.stringify(data));
  }
  fail(message) {
    if (this.closed) return; changed({ state: "error", message });
    this.onmessage?.({ data: { type: "error", message } }); this.terminate();
  }
  terminate() { if (this.closed) return; this.closed = true; clearTimeout(this.timer); this.queue.length = 0; this.socket.close(); }
}

export function createEngineWorker(url) {
  const settings = readRemoteSettings();
  return settings ? new RemoteWorker(settings) : new Worker(url);
}
export async function probeRemote(settings) {
  const health = new URL(remoteAddress(settings.url)); health.protocol = health.protocol === "wss:" ? "https:" : "http:"; health.pathname = "/health";
  // fetch can prompt for local/loopback network permission on modern Chrome;
  // a WebSocket alone may simply be blocked without presenting that prompt.
  let response;
  try {
    response = await fetch(health, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(10000),
      ...(["localhost", "127.0.0.1", "[::1]"].includes(health.hostname) ? { targetAddressSpace: "loopback" } : {}) });
  } catch { /* Older browsers may reject HTTP fetch yet allow trusted loopback WebSockets. */ }
  if (response?.ok && (await response.json()).protocol !== 1) throw Error("电脑服务地址或版本不正确");
  return new Promise((accept, reject) => {
    const worker = new RemoteWorker(settings, { onWelcome: info => { worker.terminate(); accept(info); } });
    worker.onmessage = ({ data }) => { if (data.type === "error") { worker.terminate(); reject(Error(data.message)); } };
  });
}
