import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".wasm": "application/wasm", ".data": "application/octet-stream", ".ttf": "font/ttf", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

export function createDevServer({ port = 4187, isolated = true } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const raw = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      // These aliases also exercise GitHub Pages and header-free hosting in QA.
      const plain = raw.startsWith("/plain/");
      const relative = raw.replace(/^\/(?:ai|plain)\//, "/").replace(/^\//, "");
      if (relative.split(/[\\/]/).some(part => part.startsWith(".")) || !["GET", "HEAD"].includes(req.method)) {
        res.writeHead(403); res.end(); return;
      }
      const file = path.resolve(ROOT, relative || "index.html", raw.endsWith("/") && relative ? "index.html" : "");
      if (!file.startsWith(path.resolve(ROOT) + path.sep)) { res.writeHead(403); res.end(); return; }
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404); res.end(); return; }
      if (isolated && !plain) {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      }
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("Content-Length", info.size);
      res.setHeader("Cache-Control", relative.startsWith("engine/") ? "public, max-age=31536000, immutable" : "no-cache");
      res.writeHead(200);
      if (req.method === "HEAD") res.end();
      else createReadStream(file).on("error", () => res.destroy()).pipe(res);
    } catch { res.writeHead(404); res.end("Not found"); }
  });
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => resolve(server)); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createDevServer({ port: Number(process.env.PORT || 4187), isolated: !process.argv.includes("--plain") });
  console.log(`五目: http://127.0.0.1:${server.address().port}/`);
}
