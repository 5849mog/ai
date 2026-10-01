import { readdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

for (const dir of [".", "scripts", "tests"]) {
  for (const name of await readdir(dir)) {
    if (name.endsWith(".js")) execFileSync(process.execPath, ["--check", `${dir}/${name}`], { stdio: "inherit" });
  }
}
const base = "engine/rapfi-250615/";
const manifest = JSON.parse(await readFile(base + "manifest.json", "utf8"));
for (const [name, expected] of Object.entries(manifest.files)) {
  const data = await readFile(base + name);
  if (data.length !== expected.bytes || createHash("sha256").update(data).digest("hex") !== expected.sha256) throw new Error(`Engine checksum mismatch: ${name}`);
}
for (const [name, expected] of Object.entries(manifest.patches)) {
  const data = await readFile("scripts/patches/" + name);
  if (createHash("sha256").update(data).digest("hex") !== expected) throw new Error(`Source patch checksum mismatch: ${name}`);
}
console.log("JavaScript syntax, engine and source patch SHA-256 checks passed.");
