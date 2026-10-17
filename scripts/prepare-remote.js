import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export async function prepareRemote(source, output = fileURLToPath(new URL("../remote/engine/", import.meta.url))) {
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  const native = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  const renjuBase = fileURLToPath(new URL("../engine/renju-250615/", import.meta.url));
  const renju = JSON.parse(await readFile(join(renjuBase, "manifest.json"), "utf8"));
  const published = JSON.parse(await readFile(new URL("../engine/rapfi-250615/manifest.json", import.meta.url), "utf8"));
  if (native.sourceCommit !== published.sourceCommit || native.networksCommit !== published.networksCommit || native.platform !== "windows-x64") throw Error("原生引擎源码、权重或平台与网页发布版不对应");
  const files = {};
  async function save(name, bytes) {
    const path = join(output, name); await mkdir(resolve(path, ".."), { recursive: true }); await writeFile(path, bytes);
    files[name] = { bytes: bytes.length, sha256: sha(bytes) };
  }
  async function verified(name) {
    const bytes = await readFile(join(source, name)), expected = native.files[name];
    if (!expected || expected.bytes !== bytes.length || expected.sha256 !== sha(bytes)) throw Error(`原生文件校验失败：${name}`); return bytes;
  }
  await save("rapfi.exe", await verified("rapfi.exe"));
  for (const name of ["model210901.bin", "mix9svqfreestyle_bsmix.bin.lz4"]) await save(`freestyle/${name}`, await verified(name));
  await save("renju/model210901.bin", await verified("model210901.bin"));
  // Native startup initially constructs the default freestyle evaluator before
  // INFO rule 4; the browser bundle also retains this weight in its filesystem.
  await save("renju/mix9svqfreestyle_bsmix.bin.lz4", await verified("mix9svqfreestyle_bsmix.bin.lz4"));
  await save("freestyle/config.toml", await readFile(new URL("../engine/rapfi-250615/config.toml", import.meta.url)));
  await save("renju/config.toml", await readFile(join(renjuBase, "config.toml")));
  for (const model of renju.models) {
    if (!/^[a-z0-9_.-]+$/i.test(model.name)) throw Error("模型名称无效");
    const parts = [];
    for (const name of model.parts) {
      if (!/^[a-z0-9_.-]+$/i.test(name)) throw Error("模型分片名称无效");
      const bytes = await readFile(join(renjuBase, name)), expected = renju.files[name];
      if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256) throw Error(`模型分片校验失败：${name}`); parts.push(bytes);
    }
    const bytes = Buffer.concat(parts); if (bytes.length !== model.bytes || sha(bytes) !== model.sha256) throw Error("连珠模型拼合校验失败");
    await save(`renju/${model.name}`, bytes);
  }
  for (const name of ["COPYING-Rapfi.txt", "LICENSE-Networks.txt", "NOTICE-Dependencies.txt"]) await save(name, await verified(name));
  await writeFile(join(output, "manifest.json"), JSON.stringify({ sourceCommit: native.sourceCommit, networksCommit: native.networksCommit, native, files }, null, 2) + "\n");
  return { output, files: Object.keys(files).length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--from"), source = process.argv[index + 1];
  if (index < 0 || !source) throw Error("用法：node scripts/prepare-remote.js --from 原生引擎目录");
  console.log(await prepareRemote(resolve(source)));
}
