// Run the published single-thread WASM directly in Node; no browser is involved.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInThisContext } from "node:vm";
import { createHash } from "node:crypto";
import { searchCommands, parseOutput } from "../engine-protocol.js";
import { AssessmentCollector } from "../engine-assessment.js";
import { RecommendationCollector } from "../recommendations.js";

export async function createRenjuNodeEngine() {
  const base = fileURLToPath(new URL("../engine/rapfi-250615/", import.meta.url));
  const modelBase = fileURLToPath(new URL("../engine/renju-250615/", import.meta.url));
  const filename = join(base, "rapfi-single-simd128.js");
  const source = await readFile(filename, "utf8");
  const wrapper = runInThisContext(`(function(require,module,exports,__dirname,__filename){${source}\nreturn module.exports;})`, { filename });
  const module = { exports: {} };
  const factory = wrapper(createRequire(import.meta.url), module, module.exports, dirname(filename), filename);
  const data = await readFile(join(base, "rapfi.data"));
  let active = null, weight = null;
  const engine = await factory({
    wasmBinary: await readFile(join(base, "rapfi-single-simd128.wasm")),
    wasmMemory: new WebAssembly.Memory({ initial: 1024, maximum: 16384 }),
    getPreloadedPackage: () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    locateFile: file => join(base, file.endsWith(".data") ? "rapfi.data" : file),
    onReceiveStdout: line => {
      const loaded = /mix9svq nnue: load weight from (.+)/.exec(line);
      if (loaded) weight = loaded[1].trim();
      if (!active) return;
      active.recommendations?.read(line);
      const assessment = active.assessment.read(line);
      if (assessment) active.stats.assessment = assessment;
      const parsed = parseOutput(line);
      if (parsed.type === "stats") Object.assign(active.stats, parsed.stats);
      if (parsed.type === "error") { const job = active; active = null; job.reject(new Error(parsed.message)); }
      if (parsed.type === "move") {
        const job = active; active = null;
        if (!/mix9svqrenju_bs15_(black|white)\.bin\.lz4$/.test(weight ?? "")) { job.reject(new Error("Renju evaluator not loaded")); return; }
        job.resolve({ ...job.stats, index: parsed.index, weight,
          recommendations: job.recommendations?.finish(job.board, parsed.index, job.sideToMove) });
      }
    },
    onReceiveStderr: line => { if (/error|failed|abort/i.test(line)) throw new Error(line); },
    onAbort: error => { throw new Error(String(error)); },
    onExit: code => { if (code) throw new Error(`Rapfi exited: ${code}`); }
  });
  const manifest = JSON.parse(await readFile(join(modelBase, "manifest.json"), "utf8"));
  for (const model of manifest.models) {
    const bytes = Buffer.concat(await Promise.all(model.parts.map(name => readFile(join(modelBase, name)))));
    if (bytes.length !== model.bytes || createHash("sha256").update(bytes).digest("hex") !== model.sha256) throw new Error("Renju model checksum mismatch");
    engine.FS_createDataFile("/", model.name, bytes, true, false, true);
  }
  const config = await readFile(join(modelBase, "config.toml"));
  engine.FS_unlink("/config.toml");
  engine.FS_createDataFile("/", "config.toml", config, true, false, true);
  for (const command of ["RELOADCONFIG /config.toml", "INFO rule 4", "INFO max_memory 268435456", "INFO thread_num 1", "INFO pondering 0", "INFO usedatabase 0", "INFO show_detail 2", "START 15"]) engine.sendCommand(command);
  return {
    clear() { if (active) throw new Error("Search is running"); engine.sendCommand("YXHASHCLEAR"); },
    search(options) {
      if (active) throw new Error("Search is running");
      return new Promise((resolve, reject) => {
        active = { ...options, resolve, reject, stats: {}, assessment: new AssessmentCollector(),
          recommendations: options.multiPV > 1 ? new RecommendationCollector(options.multiPV, "rif") : null };
        try {
          engine.sendCommand("YXBLOCKRESET");
          for (const command of searchCommands(options.board, options.sideToMove, options.timeMs, options.multiPV ?? 1, true, options)) engine.sendCommand(command);
        }
        catch (error) { active = null; reject(error); }
      });
    }
  };
}
