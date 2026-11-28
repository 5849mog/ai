import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const siteRoot = path.resolve(process.argv[2] || "_site");
const publicScripts = new Set(["sw.js", "app-release.js"]);
const sourceScripts = (await readdir(sourceRoot, { withFileTypes: true }))
  .filter(item => item.isFile() && item.name.endsWith(".js")
    && !item.name.endsWith(".protected.js") && !publicScripts.has(item.name))
  .map(item => item.name);
const fileAt = relative => path.join(siteRoot, relative);
async function exists(relative) {
  try { await stat(fileAt(relative)); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
for (const relative of [...sourceScripts, "scripts", "tests", "package.json", "package-lock.json"]) {
  assert.equal(await exists(relative), false, "Unprotected source published: " + relative);
}

const worker = await readFile(fileAt("sw.js"), "utf8");
const sandbox = { URL, self: { location: { href: "https://example.com/gomoku-studio/sw.js" }, addEventListener() {} } };
vm.runInNewContext(worker + "\nglobalThis.__core = CORE;", sandbox);
for (const entry of sandbox.__core) {
  const address = new URL(entry, "https://example.com/gomoku-studio/");
  const relative = address.pathname.slice("/gomoku-studio/".length) || "index.html";
  assert.ok(await exists(relative), "Missing offline resource: " + entry);
}
for (const relative of ["content/feed.json", "content/wordmark.wm", "reports/real-games-latest.json"]) {
  assert.ok(await exists(relative), "Missing live content: " + relative);
}
for (const dir of ["engine/rapfi-250615", "engine/renju-250615"]) {
  const manifest = JSON.parse(await readFile(fileAt(dir + "/manifest.json"), "utf8"));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const data = await readFile(fileAt(dir + "/" + name));
    assert.equal(data.length, expected.bytes, "Incorrect published size: " + dir + "/" + name);
    assert.equal(createHash("sha256").update(data).digest("hex"), expected.sha256,
      "Incorrect published checksum: " + dir + "/" + name);
  }
}
console.log("Published site excludes source scripts and contains the complete verified shell and engines.");
