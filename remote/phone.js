import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import QRCode from "qrcode";

const run = promisify(execFile);
export function publicAddress(text) {
  return text.match(/https:\/\/[a-z0-9-]+\.run\.pinggy-free\.link\b/)?.[0] ?? null;
}
export function phoneLink(url, token) {
  if (!publicAddress(url) || publicAddress(url) !== url || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw Error("Invalid phone pairing");
  return "https://5849mog.github.io/ai/?computer-launch=20261017#computer=" + encodeURIComponent(JSON.stringify({ url, token }));
}
export function tunnelArguments(data, gatewayPort, region) {
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw Error("Invalid gateway port");
  if (!["ap.free.pinggy.io", "free.pinggy.io"].includes(region)) throw Error("Invalid free relay");
  return ["-F", "none", "-p", "443", "-T", "-i", join(data, "pinggy-ed25519"),
    "-o", "IdentityAgent=none", "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
    "-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no", "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${join(data, "pinggy-known-hosts")}`, "-o", "ServerAliveInterval=20", "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=20", "-R", `0:127.0.0.1:${gatewayPort}`, `qr@${region}`];
}

const html = nonce => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>五目 · 手机连接</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;padding:38px 20px;background:#ede5d7;color:#302a24;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:640px;margin:auto;padding:30px;background:#faf6ed;border:1px solid #d8cbb7;border-radius:20px;box-shadow:0 12px 50px #483e2a12}h1{font-family:serif;font-size:31px;font-weight:500;margin:0}small{color:#756b5b}#status{margin:20px 0 4px;font-size:18px}#qr{display:block;max-width:100%;width:300px;margin:22px auto;border-radius:12px}textarea{width:100%;height:90px;resize:none;border:1px solid #cbbda8;border-radius:9px;padding:10px;background:#fffaf1;color:#514637}button,a.action{font:inherit;border:1px solid #aa9474;border-radius:9px;padding:9px 14px;cursor:pointer;background:#f2e9d9;color:#3a3125;text-decoration:none}button:disabled{opacity:.5;cursor:default}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:15px 0}.note{font-size:14px;color:#756b5b}#feedback{min-height:24px}</style>
<main><small>五目 · 电脑计算</small><h1>用手机，连接这台电脑</h1><p id="status" role="status">正在准备免费连接…</p><div id="remaining" class="note"></div><img id="qr" alt="手机连接二维码" hidden><textarea id="link" readonly aria-label="手机连接链接" placeholder="连接准备好后，这里会出现链接"></textarea><div class="actions"><button id="copy" disabled>复制手机链接</button><a id="open" class="action" hidden target="_blank" rel="noreferrer">打开对弈</a><button id="renew">刷新连接</button><button id="stop">关闭远程连接</button></div><div id="feedback" role="status"></div><p class="note">手机扫描二维码，或在手机上打开复制的链接，再点「连接并使用」。继续使用原云端棋盘，由这台电脑计算。手机无需安装组网软件。</p><p class="note">当前使用免费通道，单次最多 60 分钟，到期会自动重建。地址改变后，需要重新扫码；原棋局会保留。电脑须开机，并保留后台连接服务。</p><p class="note">同一时刻仅一个对弈页面使用电脑引擎。若提示占用，请先关闭电脑或另一台设备上的对弈页面；本连接窗口可以保留。</p></main>
<script nonce="${nonce}">let key=location.hash.slice(1);try{if(key)sessionStorage.setItem('gomoku-phone-control',key);else key=sessionStorage.getItem('gomoku-phone-control')||''}catch{}history.replaceState(null,'',location.pathname);const byId=id=>document.getElementById(id);let busy=false;async function api(method='GET',action='status'){const r=await fetch('/api/'+action,{method,headers:{Authorization:'Bearer '+key},cache:'no-store'});if(!r.ok)throw Error('本机连接窗口已失效，请重新打开桌面快捷方式');return r.json()}async function refresh(){if(busy)return;busy=true;try{const s=await api();byId('status').textContent=s.state==='ready'?'连接已准备好':s.state==='stopped'?'远程连接已关闭':'正在准备免费连接…';byId('remaining').textContent=s.state==='ready'?'本次连接约剩 '+Math.max(0,Math.ceil((s.expiresAt-Date.now())/60000))+' 分钟':s.error||'';byId('link').value=s.link||'';byId('copy').disabled=!s.link;byId('open').hidden=!s.link;if(s.link)byId('open').href=s.link;byId('qr').hidden=!s.qr;if(s.qr)byId('qr').src=s.qr}catch(e){byId('status').textContent=e.message}finally{busy=false}}byId('copy').onclick=async()=>{try{await navigator.clipboard.writeText(byId('link').value)}catch{byId('link').select();document.execCommand('copy')}byId('feedback').textContent='已复制，可发送到自己的手机打开'};for(const [id,action]of [['renew','reconnect'],['stop','stop']])byId(id).onclick=async()=>{await api('POST',action);await refresh()};refresh();setInterval(refresh,2000);</script></html>`;

export async function startPhone({ data = join(process.env.LOCALAPPDATA, "GomokuRemote"), port = 4190,
  gatewayPort = Number(process.env.GOMOKU_REMOTE_GATEWAY_PORT ?? 4189), token, launch = true, spawnImpl = spawn } = {}) {
  await mkdir(data, { recursive: true });
  token ??= (await readFile(join(data, "pairing-key.txt"), "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error("Invalid pairing key");
  const controlKey = randomBytes(24).toString("hex"), nonce = randomBytes(16).toString("hex");
  const sshRoot = join(process.env.SystemRoot ?? "C:/Windows", "System32/OpenSSH"), ssh = join(sshRoot, "ssh.exe");
  let child, restarting, stopped = !launch, generation = 0, attempts = 0;
  let status = { state: "starting", error: "", link: "", qr: "", expiresAt: 0 };
  const stopTunnel = () => { generation++; clearTimeout(restarting); restarting = null; const old = child; child = null; old?.kill(); };
  const startTunnel = async () => {
    stopTunnel(); stopped = false; const current = generation;
    status = { state: "starting", error: "", link: "", qr: "", expiresAt: 0 };
    const key = join(data, "pinggy-ed25519");
    try {
      try { await access(key); } catch { await run(join(sshRoot, "ssh-keygen.exe"), ["-q", "-t", "ed25519", "-N", "", "-C", "gomoku-free-tunnel", "-f", key], { windowsHide: true }); }
      if (current !== generation || stopped) return;
      const processChild = spawnImpl(ssh, tunnelArguments(data, gatewayPort, attempts % 2 ? "free.pinggy.io" : "ap.free.pinggy.io"), { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      child = processChild; let output = "", errorText = "", published = false;
      processChild.stderr.on("data", bytes => { errorText = (errorText + bytes.toString()).slice(-3000); });
      processChild.stdout.on("data", async bytes => {
        output = (output + bytes.toString()).slice(-16000);
        const url = publicAddress(output); if (!url || published || current !== generation) return;
        published = true;
        try {
          const link = phoneLink(url, token), qr = await QRCode.toDataURL(link, { width: 420, margin: 2, errorCorrectionLevel: "M" });
          if (current !== generation || stopped) return;
          status = { state: "ready", error: "", link, qr, url, expiresAt: Date.now() + 59 * 60000 };
          await writeFile(join(data, "phone-pairing.png"), Buffer.from(qr.split(",")[1], "base64"), { mode: 0o600 });
          console.log("手机免费连接已准备好；二维码在本机连接窗口内。");
        } catch { status.error = "二维码准备失败，请刷新连接"; }
      });
      let exitHandled = false;
      const exited = () => {
        if (exitHandled) return; exitHandled = true;
        if (current !== generation || stopped) return;
        attempts++; status = { state: "starting", error: published ? "免费连接已结束，正在更新地址；请稍后扫描新二维码" : "正在重试免费网络节点，请稍候", link: "", qr: "", expiresAt: 0 };
        if (/REMOTE HOST IDENTIFICATION HAS CHANGED/.test(errorText)) { stopped = true; status.state = "stopped"; status.error = "通道主机身份发生变化，已停止连接，请检查后重试"; return; }
        restarting = setTimeout(() => void startTunnel(), Math.min(30000, 3000 * attempts));
      };
      processChild.once("exit", exited); processChild.once("error", exited);
    } catch { status.error = "无法启动免费通道，请确认 Windows OpenSSH 可用"; }
  };
  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Referrer-Policy", "no-referrer"); response.setHeader("X-Content-Type-Options", "nosniff");
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (request.headers.host !== expectedHost || (request.headers.origin && request.headers.origin !== `http://${expectedHost}`)) { response.writeHead(403); response.end(); return; }
    if (request.url === "/" && request.method === "GET") {
      response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html(nonce)); return;
    }
    const credential = request.headers.authorization;
    if (typeof credential !== "string" || !/^Bearer [a-f0-9]{48}$/.test(credential) || !timingSafeEqual(Buffer.from(credential), Buffer.from("Bearer " + controlKey))) { response.writeHead(403); response.end(); return; }
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/status" && request.method === "GET") { response.end(JSON.stringify(status)); return; }
    if (request.url === "/api/stop" && request.method === "POST") { stopped = true; stopTunnel(); status = { state: "stopped", error: "", link: "", qr: "", expiresAt: 0 }; response.end('{"ok":true}'); return; }
    if (request.url === "/api/reconnect" && request.method === "POST") { void startTunnel(); response.end('{"ok":true}'); return; }
    if (request.url === "/api/exit" && request.method === "POST") { response.end('{"ok":true}'); setImmediate(() => void close()); return; }
    response.writeHead(404); response.end();
  });
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", accept); });
  const controlUrl = `http://127.0.0.1:${server.address().port}/#${controlKey}`;
  let closing;
  const close = () => closing ??= (async () => { stopped = true; stopTunnel(); await new Promise(done => server.close(done)); })();
  if (launch) void startTunnel();
  return { controlUrl, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startPhone();
  const data = join(process.env.LOCALAPPDATA, "GomokuRemote");
  await writeFile(join(data, "phone-session.json"), JSON.stringify({ processId: process.pid, script: fileURLToPath(import.meta.url), controlUrl: app.controlUrl }), { mode: 0o600 });
  process.once("SIGINT", () => void app.close()); process.once("SIGTERM", () => void app.close());
}
