import { readRemoteSettings, saveRemoteSettings, probeRemote } from "./remote-engine.js?v=46";

async function awaitUpdatedShell(doc) {
  let registration;
  try { registration = await doc.defaultView.navigator.serviceWorker?.getRegistration(); } catch { return; }
  if (!registration) return;
  try { await registration.update(); } catch { return; /* an already cached current page can pair offline */ }
  const worker = registration.installing ?? registration.waiting;
  if (!worker || worker.state === "activated") return;
  await new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); worker.removeEventListener("statechange", changed); error ? reject(error) : resolve(); };
    const changed = () => {
      if (worker.state === "activated") finish();
      else if (worker.state === "redundant") finish(Error("页面更新未完成，请联网重试"));
      else if (worker.state === "installed") worker.postMessage({ type: "activate-update" });
    };
    const timer = setTimeout(() => finish(Error("页面更新尚未完成，请稍后重试连接")), 20000);
    worker.addEventListener("statechange", changed); changed();
  });
}

export function setupRemoteUi({ doc = document, storage = sessionStorage, reload = () => location.reload(), probe = probeRemote } = {}) {
  const entry = doc.querySelector("#openRemoteEngine"); if (!entry) return;
  const dialog = doc.createElement("dialog"); dialog.className = "record-dialog remote-dialog";
  dialog.setAttribute("aria-labelledby", "remoteTitle");
  dialog.innerHTML = `<h2 id="remoteTitle">电脑引擎</h2><p class="remote-description">保留当前网页与棋局，把计算交给你的电脑。电脑须开机并运行计算服务。</p>
    <label class="remote-field">连接地址<input id="remoteUrl" type="url" placeholder="https://你的远程地址" autocomplete="off" spellcheck="false" /></label>
    <label class="remote-field">配对密钥<input id="remoteToken" type="password" autocomplete="off" spellcheck="false" /></label>
    <p class="remote-description">同一台电脑可填本机地址；手机远程使用需组网或穿透的加密地址。密钥保存在标签页会话中，不写入棋谱。每步预算指电脑计算时间，响应还包括网络耗时。</p>
    <p id="remoteMessage" class="remote-message" role="status"></p>
    <div class="dialog-actions"><button type="button" id="remoteCancel">返回</button><button type="button" id="remoteBrowser">网页计算</button><button type="button" id="remoteConnect" class="confirm-import">连接并使用</button></div>`;
  doc.body.append(dialog);
  const url = dialog.querySelector("#remoteUrl"), token = dialog.querySelector("#remoteToken"), message = dialog.querySelector("#remoteMessage");
  const connect = dialog.querySelector("#remoteConnect"); let serial = 0;
  let latestInfo, linkSettings;
  const fragment = doc.defaultView.location.hash;
  if (fragment.startsWith("#computer=")) {
    try { linkSettings = JSON.parse(decodeURIComponent(fragment.slice(10))); } catch { /* invalid link can be filled manually */ }
    const clean = new URL(doc.defaultView.location.href); clean.hash = ""; clean.searchParams.delete("computer-launch");
    doc.defaultView.history.replaceState(null, "", clean.pathname + clean.search);
  }
  const initial = readRemoteSettings(storage);
  entry.textContent = initial ? "电脑引擎 · 已选择" : "电脑引擎";
  function open() {
    const active = readRemoteSettings(storage), settings = linkSettings ?? active;
    url.value = typeof settings?.url === "string" ? settings.url.replace(/^ws/, "http").replace(/\/gomoku$/, "") : ""; token.value = typeof settings?.token === "string" ? settings.token : "";
    message.textContent = active ? `${latestInfo ? latestInfo.threads + " 线程 · " + latestInfo.memoryMiB + " MiB。" : ""}当前使用电脑计算；连接中断时保留棋盘，不会自动切换引擎。` : "当前使用网页计算。连接成功后刷新本页，自动恢复当前棋局。";
    connect.disabled = false; dialog.showModal();
    doc.querySelector("#recordMenu").open = false;
  }
  entry.addEventListener("click", open);
  // Also reachable from simple mode's inline “more” pane.
  doc.addEventListener("click", event => { if (event.target.closest("[data-remote-menu]")) open(); });
  dialog.querySelector("#remoteCancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { serial++; connect.disabled = false; });
  dialog.querySelector("#remoteBrowser").addEventListener("click", () => {
    try { saveRemoteSettings(null, storage); reload(); } catch (error) { message.textContent = error.message; }
  });
  connect.addEventListener("click", async () => {
    const current = ++serial; connect.disabled = true; message.textContent = "正在验证电脑连接…";
    try {
      // Validate before opening a connection, without overwriting the current mode.
      const value = { url: url.value, token: token.value.trim() }, temporary = new Map();
      saveRemoteSettings(value, { setItem: (key, data) => temporary.set(key, data) });
      const info = await probe(value);
      if (current !== serial || !dialog.open) return;
      if (!info.rules?.includes("freestyle") || !info.rules?.includes("rif") || !info.rules?.includes("taraguchi10")) throw Error("电脑服务不支持本页的完整规则，请更新电脑服务");
      message.textContent = "电脑已连通，正在切换计算服务…";
      await awaitUpdatedShell(doc);
      if (current !== serial || !dialog.open) return;
      saveRemoteSettings(value, storage); reload();
    } catch (error) { if (current === serial) { message.textContent = error.message; connect.disabled = false; } }
  });
  doc.defaultView.addEventListener("gomoku-remote-state", ({ detail }) => {
    if (!readRemoteSettings(storage)) return;
    if (detail.threads) latestInfo = detail;
    entry.textContent = detail.state === "error" ? "电脑引擎 · 连接中断" : `电脑引擎 · ${detail.threads} 线程`;
    if (dialog.open) message.textContent = detail.message ?? `${detail.threads} 线程 · ${detail.memoryMiB} MiB · 已连通`;
  });
  if (linkSettings) open();
  return { dialog, open };
}
if (typeof document !== "undefined") {
  try { setupRemoteUi(); } catch { /* blocked session storage leaves browser computation available */ }
}
