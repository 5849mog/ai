import { build } from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { protectionSeed } from "./protection-seed.js";

// Keep bundles next to the source: URL resolution and storage scope stay stable.
const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const entries = [
  { input: "opening-app.js", output: "opening-app.protected.js", format: "esm", antiDebug: true },
  { input: "remote-engine-ui.js", output: "remote-engine-ui.protected.js", format: "esm" },
  { input: "wordmark.js", output: "wordmark.protected.js", format: "esm" },
  { input: "report.js", output: "report.protected.js", format: "esm" },
  { input: "app-update.js", output: "app-update.protected.js", format: "esm" },
  { input: "update-page.js", output: "update-page.protected.js", format: "esm" },
  { input: "about.js", output: "about.protected.js", format: "iife" },
  { input: "engine.worker.js", output: "engine.worker.protected.js", format: "iife", antiDebug: true }
];
const protectedWorker = {
  name: "protected-engine-worker",
  setup(api) {
    api.onLoad({ filter: /(?:^|[/\\])engine\.js$/ }, async ({ path: filename }) => {
      const source = await readFile(filename, "utf8");
      const original = "./engine.worker.js?v=42";
      if (source.split(original).length !== 2) throw new Error("Engine worker URL changed; update the protected build.");
      return { contents: source.replace(original, "./engine.worker.protected.js?v=45"),
        loader: "js", resolveDir: path.dirname(filename) };
    });
  }
};
let stale = false;
const protectedOutputs = new Map();
for (const entry of entries) {
  const result = await build({
    absWorkingDir: root, entryPoints: [entry.input], bundle: true, write: false,
    format: entry.format, platform: "browser", target: ["es2020"], charset: "utf8",
    minify: true, sourcemap: false, legalComments: "none",
    plugins: [protectedWorker], logLevel: "silent"
  });
  const bundled = result.outputFiles[0].text;
  // A second independent string table makes a one-pass decoder incomplete.
  // The inner pass deliberately avoids self-defence so the outer pass can
  // transform it; all material remains recoverable on a controlled client.
  const intermediate = entry.antiDebug ? JavaScriptObfuscator.obfuscate(bundled, {
    compact: true, stringArray: true, stringArrayEncoding: ["base64"], stringArrayThreshold: 1,
    controlFlowFlattening: false, selfDefending: false, debugProtection: false,
    renameGlobals: false, seed: protectionSeed("inner:" + entry.output, bundled), target: "browser"
  }).getObfuscatedCode() : bundled;
  const output = JavaScriptObfuscator.obfuscate(intermediate, {
    compact: true, controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.15,
    debugProtection: Boolean(entry.antiDebug),
    debugProtectionInterval: entry.antiDebug ? 3000 : 0,
    identifierNamesGenerator: "hexadecimal", numbersToExpressions: true,
    renameGlobals: false, selfDefending: true,
    seed: protectionSeed((entry.antiDebug ? "outer:" : "") + entry.output, intermediate),
    sourceMap: false, splitStrings: true, splitStringsChunkLength: 10,
    stringArray: true, stringArrayEncoding: ["base64", "rc4"],
    ...(entry.antiDebug ? {
      deadCodeInjection: true, deadCodeInjectionThreshold: 0.03,
      stringArrayCallsTransform: true, stringArrayCallsTransformThreshold: 0.15,
      stringArrayWrappersCount: 2, stringArrayWrappersChainedCalls: true,
      stringArrayWrappersParametersMaxCount: 4, stringArrayWrappersType: "function"
    } : {}),
    stringArrayThreshold: 0.8, target: "browser"
  }).getObfuscatedCode() + "\n";
  protectedOutputs.set(entry.output, output);
  const destination = path.join(root, entry.output);
  if (check) {
    const existing = await readFile(destination, "utf8").catch(() => "");
    if (existing !== output) { console.error("Out of date: " + entry.output); stale = true; }
  } else {
    await writeFile(destination, output);
    console.log(entry.output + ": " + (Buffer.byteLength(output) / 1024).toFixed(0) + " KiB");
  }
}

// Verify cached entry scripts and the engine worker before a new shell activates.
const cachedScripts = [
  ["about.protected.js?v=4", "about.protected.js"],
  ["report.protected.js?v=2", "report.protected.js"],
  ["wordmark.protected.js", "wordmark.protected.js"],
  ["app-update.protected.js?v=38", "app-update.protected.js"],
  ["update-page.protected.js", "update-page.protected.js"],
  ["remote-engine-ui.protected.js?v=46", "remote-engine-ui.protected.js"],
  ["opening-app.protected.js", "opening-app.protected.js"],
  ["engine.worker.protected.js?v=45", "engine.worker.protected.js"]
];
const integrity = Object.fromEntries(cachedScripts.map(([url, name]) => {
  const output = protectedOutputs.get(name);
  if (output === undefined) throw new Error("No protected output for " + name);
  return [url, "sha384-" + createHash("sha384").update(output).digest("base64")];
}));
const integrityStart = "// BEGIN GENERATED ASSET INTEGRITY";
const integrityEnd = "// END GENERATED ASSET INTEGRITY";
const serviceWorkerPath = path.join(root, "sw.js");
const serviceWorker = await readFile(serviceWorkerPath, "utf8");
const start = serviceWorker.indexOf(integrityStart), end = serviceWorker.indexOf(integrityEnd);
if (start < 0 || end < start || serviceWorker.lastIndexOf(integrityStart) !== start
    || serviceWorker.lastIndexOf(integrityEnd) !== end) throw new Error("Service worker integrity markers are missing or duplicated.");
const updatedWorker = serviceWorker.slice(0, start) + integrityStart + "\nconst ASSET_INTEGRITY = "
  + JSON.stringify(integrity, null, 2) + ";\n" + integrityEnd + serviceWorker.slice(end + integrityEnd.length);
if (check) {
  if (serviceWorker !== updatedWorker) { console.error("Out-of-date service worker integrity"); stale = true; }
} else if (serviceWorker !== updatedWorker) await writeFile(serviceWorkerPath, updatedWorker);

// SRI verifies entry resources when the HTML itself is trusted. It cannot stop
// someone who controls their browser from changing the page or bypassing it.
const pages = new Map([["index.html", 3], ["renju.html", 3], ["about.html", 2],
  ["about.zh-CN.html", 2], ["report.html", 2], ["update.html", 1]]);
for (const [name, expected] of pages) {
  const destination = path.join(root, name);
  const html = await readFile(destination, "utf8");
  let count = 0;
  const updated = html.replace(/<script\b[^>]*\bsrc="\.\/([^"?]+\.protected\.js)(?:\?[^\"]*)?"[^>]*>/g,
    (tag, filename) => {
      const output = protectedOutputs.get(filename);
      if (output === undefined) throw new Error("No protected output for " + filename);
      count++;
      const digest = createHash("sha384").update(output).digest("base64");
      const plain = tag.replace(/\s+integrity="[^"]*"/g, "").replace(/\s+crossorigin="[^"]*"/g, "");
      return plain.slice(0, -1) + ' integrity="sha384-' + digest + '" crossorigin="anonymous">';
    });
  if (count !== expected) throw new Error("Unexpected protected script count in " + name + ": " + count);
  if (check) {
    if (updated !== html) { console.error("Out-of-date integrity in " + name); stale = true; }
  } else if (updated !== html) await writeFile(destination, updated);
}

// GitHub Pages uses Jekyll 3. List source files explicitly so the built site
// exposes only protected bundles while the public Git repository stays intact.
const publicScripts = new Set(["sw.js", "app-release.js"]);
const sourceScripts = (await readdir(root, { withFileTypes: true }))
  .filter(item => item.isFile() && item.name.endsWith(".js")
    && !item.name.endsWith(".protected.js") && !publicScripts.has(item.name))
  .map(item => item.name).sort();
const excluded = [".sass-cache", ".jekyll-cache", "Gemfile", "Gemfile.lock",
  "node_modules", "vendor", "scripts", "tests", "package.json", "package-lock.json", ...sourceScripts];
const pagesConfig = "# Generated by npm run build:protected. GitHub source remains public.\nexclude:\n"
  + excluded.map(name => "  - " + JSON.stringify(name)).join("\n") + "\n";
const pagesConfigPath = path.join(root, "_config.yml");
if (check) {
  if (await readFile(pagesConfigPath, "utf8").catch(() => "") !== pagesConfig) {
    console.error("Out of date: _config.yml"); stale = true;
  }
} else {
  await writeFile(pagesConfigPath, pagesConfig);
  console.log("_config.yml: " + sourceScripts.length + " source scripts excluded from Pages");
}
if (stale) {
  console.error("Run npm run build:protected and commit the generated files.");
  process.exitCode = 1;
} else if (check) console.log("Protected browser bundles are up to date.");
