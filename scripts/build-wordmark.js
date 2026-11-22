import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sealWordmark, WORDMARK_URL } from "../wordmark.js";

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
await writeFile(WORDMARK_URL, await sealWordmark(vector));
