import { APP_VERSION } from "./app-release.js";

function newerVersion(candidate, current) {
  const valid = version => /^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(version);
  if (!valid(candidate) || !valid(current)) return false;
  const a = candidate.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function updateControlMarkup() {
  return `<div class="app-update-control"><span data-app-version role="status">版本 ${APP_VERSION}</span><button type="button" data-app-update>检查更新</button></div>`;
}

// Updating never reloads a live game or an unconfirmed screenshot automatically.
export function setupAppUpdates({ container = document, serviceWorker = navigator.serviceWorker,
  reload = () => location.reload(), returnWhenCurrent = false } = {}) {
  const labels = [...container.querySelectorAll("[data-app-version]")], buttons = [...container.querySelectorAll("[data-app-update]")];
  let registration, busy = false, ready = false, current = "", checked = false;
  function render(text) {
    for (const label of labels) label.textContent = text ?? `页面 ${APP_VERSION}${current ? ` · 缓存 ${current}` : ""}`;
    for (const button of buttons) {
      button.disabled = busy || !serviceWorker;
      button.textContent = busy ? "检查中…" : ready ? "刷新使用新版" : checked ? returnWhenCurrent ? "返回棋局" : "重新加载本页" : "检查更新";
    }
  }
  function askStatus() { serviceWorker.controller?.postMessage({ type: "offline-status" }); }
  if (!serviceWorker) { render(`版本 ${APP_VERSION} · 此浏览器不支持离线更新`); return; }
  serviceWorker.addEventListener("message", ({ data }) => {
    if (data?.type !== "app-status" || typeof data.version !== "string") return;
    current = data.version; ready = newerVersion(current, APP_VERSION);
    render();
    const offline = container.querySelector("#offlineState");
    if (offline) offline.textContent = data.offline ? "已缓存 · 可离线使用" : "页面已缓存 · 引擎离线缓存未完成";
  });
  serviceWorker.addEventListener("controllerchange", askStatus);
  function watch(worker) {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && registration?.waiting) registration.waiting.postMessage({ type: "activate-update" });
      if (worker.state === "activated") askStatus();
      if (worker.state === "redundant") render(`版本 ${APP_VERSION} · 更新未完成，可重试`);
    });
  }
  const initialized = serviceWorker.register(new URL("./sw.js", import.meta.url), { scope: "./", updateViaCache: "none" })
    .then(value => {
      registration = value; watch(value.installing);
      value.addEventListener("updatefound", () => watch(value.installing));
      value.waiting?.postMessage({ type: "activate-update" }); askStatus(); return value;
    }).catch(() => { render(`版本 ${APP_VERSION} · 离线更新暂不可用，联网后重试`); return null; });
  async function check() {
    if (busy) return;
    if (ready || checked) { reload(); return; }
    busy = true; render();
    try {
      registration ??= await initialized;
      // A failed first registration can recover without clearing saves or caches.
      registration ??= await serviceWorker.register(new URL("./sw.js", import.meta.url), { scope: "./", updateViaCache: "none" });
      await registration.update();
      const worker = registration.installing ?? registration.waiting ?? (registration.active?.state === "activating" ? registration.active : null);
      if (worker) {
        registration.waiting?.postMessage({ type: "activate-update" });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => finish(new Error("更新仍在下载，请稍后重试")), 20000);
          const changed = () => {
            if (worker.state === "activated") finish();
            else if (worker.state === "redundant") finish(new Error("更新下载失败，请联网后重试"));
          };
          function finish(error) { clearTimeout(timer); worker.removeEventListener("statechange", changed); error ? reject(error) : resolve(); }
          worker.addEventListener("statechange", changed); changed();
        });
      }
      checked = true; askStatus(); busy = false; render();
    } catch (error) { busy = false; render(`版本 ${APP_VERSION} · ${error.message || "检查失败，请联网重试"}`); }
  }
  for (const button of buttons) button.onclick = () => { void check(); };
  render(); return { check, initialized };
}
