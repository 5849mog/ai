import { setupAppUpdates } from "./app-update.js";

try {
  const query = new URLSearchParams(location.search);
  const target = new URL(query.get("from") === "renju" ? "./renju.html" : "./", location.href);
  if (query.get("view") === "simple") target.searchParams.set("view", "simple");
  const update = setupAppUpdates({ returnWhenCurrent: true, reload: () => location.replace(target.href) });
  if (update) void update.check();
} catch {
  document.querySelector("[data-app-version]").textContent = "读取失败，请联网后刷新此页重试。";
}
