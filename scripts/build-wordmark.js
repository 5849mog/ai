import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openWordmark, sealWordmark, WORDMARK_URL } from "../wordmark.js";
import { WORDMARK_TRUST } from "../wordmark-trust.js";

const args = process.argv.slice(2);
const rotate = args[0] === "--rotate";
const [keyPath, revisionText] = rotate ? args.slice(1) : args;
const revision = Number(revisionText);
if (!keyPath || !/^[1-9][0-9]{0,8}$/.test(revisionText ?? "")) {
  throw new Error("Usage: node scripts/build-wordmark.js [--rotate] <private-key.pem> <revision>");
}
const privateKey = createPrivateKey(await readFile(keyPath));
const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
if (!rotate && publicKey !== WORDMARK_TRUST.publicKey) throw new Error("Signing key does not match the pinned wordmark key");

const current = await readFile(WORDMARK_URL, "utf8").then(text => openWordmark(text)).catch(() => null);
if (revision <= Math.max(WORDMARK_TRUST.minimumRevision, current?.revision ?? 0)) {
  throw new Error("Wordmark revision must be greater than the current revision");
}
const trust = rotate ? { publicKey, minimumRevision: revision } : WORDMARK_TRUST;
const signingKey = await crypto.subtle.importKey("pkcs8", privateKey.export({ format: "der", type: "pkcs8" }),
  { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

// FontTools extracts only the visible outlines of the two source glyphs.
const extractContours = `
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

with TTFont(sys.argv[1]) as font:
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    pen = SVGPathPen(glyphs, ntos=lambda value: format(value, ".10g"))
    for codepoint, offset in [(0x4E94, 0), (0x76EE, 1080)]:
        glyphs[cmap[codepoint]].draw(TransformPen(pen, (1, 0, 0, -1, offset, 866)))
    print(json.dumps({"width": 2200, "height": 1000, "path": pen.getCommands()}))
`;
const font = fileURLToPath(new URL("../assets/brand-serif.ttf", import.meta.url));
const vector = JSON.parse(execFileSync(process.env.PYTHON || "python", ["-c", extractContours, font], { encoding: "utf8" }));
const envelope = await sealWordmark(vector, revision, signingKey);
await openWordmark(envelope, trust);
if (rotate) {
  await writeFile(new URL("../wordmark-trust.js", import.meta.url),
    "// Trust anchor shipped with the page shell. Only the public key is published.\n" +
    "export const WORDMARK_TRUST = " + JSON.stringify(trust, null, 2) + ";\n");
}
await writeFile(WORDMARK_URL, envelope);
