import { build } from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep bundles next to the source: URL resolution and storage scope stay stable.
const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const entries = [
  { input: "opening-app.js", output: "opening-app.protected.js", format: "esm", antiDebug: true },
  { input: "remote-engine-ui.js", output: "remote-engine-ui.protected.js", format: "esm" },
  { input: "wordmark.js", output: "wordmark.protected.js", format: "esm" },
  { input: "report.js", output: "report.protected.js", format: "esm" },
  { input: "app-update.js", output: "app-update.protected.js", format: "esm" },
  { input: "about.js", output: "about.protected.js", format: "iife" },
  { input: "engine.worker.js", output: "engine.worker.protected.js", format: "iife" }
];
const protectedWorker = {
  name: "protected-engine-worker",
  setup(api) {
    api.onLoad({ filter: /(?:^|[/\\])engine\.js$/ }, async ({ path: filename }) => {
      const source = await readFile(filename, "utf8");
      const original = "./engine.worker.js?v=42";
      if (source.split(original).length !== 2) throw new Error("Engine worker URL changed; update the protected build.");
      return { contents: source.replace(original, "./engine.worker.protected.js?v=42"),
        loader: "js", resolveDir: path.dirname(filename) };
    });
  }
};
let stale = false;
for (const [index, entry] of entries.entries()) {
  const result = await build({
    absWorkingDir: root, entryPoints: [entry.input], bundle: true, write: false,
    format: entry.format, platform: "browser", target: ["es2020"], charset: "utf8",
    minify: true, sourcemap: false, legalComments: "none",
    plugins: [protectedWorker], logLevel: "silent"
  });
  const output = JavaScriptObfuscator.obfuscate(result.outputFiles[0].text, {
    compact: true, controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.15,
    debugProtection: Boolean(entry.antiDebug),
    debugProtectionInterval: entry.antiDebug ? 3000 : 0,
    identifierNamesGenerator: "hexadecimal", numbersToExpressions: true,
    renameGlobals: false, selfDefending: true, seed: 20261128 + index,
    sourceMap: false, splitStrings: true, splitStringsChunkLength: 10,
    stringArray: true, stringArrayEncoding: ["base64", "rc4"],
    stringArrayThreshold: 0.8, target: "browser"
  }).getObfuscatedCode() + "\n";
  const destination = path.join(root, entry.output);
  if (check) {
    const existing = await readFile(destination, "utf8").catch(() => "");
    if (existing !== output) { console.error("Out of date: " + entry.output); stale = true; }
  } else {
    await writeFile(destination, output);
    console.log(entry.output + ": " + (Buffer.byteLength(output) / 1024).toFixed(0) + " KiB");
  }
}
if (stale) {
  console.error("Run npm run build:protected and commit the generated files.");
  process.exitCode = 1;
} else if (check) console.log("Protected browser bundles are up to date.");
