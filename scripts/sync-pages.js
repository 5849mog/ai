import { readFile, writeFile } from "node:fs/promises";

const home = await readFile(new URL("../index.html", import.meta.url), "utf8");
const legacyPath = new URL("../renju.html", import.meta.url);
const homeBody = '<body class="opening-page" data-default-rule="freestyle" data-default-workflow="duel">';
if (!home.includes(homeBody)) {
  throw new Error("首页默认开局设置已改变，请核对两个入口的默认规则和对局方式。");
}

// The old address uses the Renju defaults in opening-app.js.
const legacy = home.replace(homeBody, '<body class="opening-page">').replace(
  /^<!doctype html>\n/i,
  "$&<!-- 由 index.html 生成。修改首页后运行 npm run sync:pages。 -->\n"
);

if (process.argv.includes("--check")) {
  if (await readFile(legacyPath, "utf8") !== legacy) {
    throw new Error("renju.html 与首页不同步。请运行 npm run sync:pages。");
  }
} else {
  await writeFile(legacyPath, legacy);
}
