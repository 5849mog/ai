import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { findBoardGrid } from "./image-grid.js";
import { recognizeBoard } from "./image-board.js";

function screenshot({ width = 420, height = 860, left = 32, top = 173, step = 24, stones = 28, skin = [225, 195, 142] } = {}) {
  const data = new Uint8ClampedArray(width * height * 4), board = new Uint8Array(225);
  for (let n = 0; n < stones; n++) board[(n * 53 + 101) % 225] = n % 2 + 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb = [244, 242, 236];
    if (y < 58 || y > height - 48) rgb = [58, 64, 59];
    if (y > 70 && y < top - 15 && (y % 27 < 2 || (x % 51 < 26 && y % 27 < 7))) rgb = [146, 143, 134];
    if (x >= left - 14 && x <= left + 14 * step + 14 && y >= top - 14 && y <= top + 14 * step + 14) {
      rgb = skin;
      if (x >= left - step / 2 && x <= left + 14.5 * step && y >= top - step / 2 && y <= top + 14.5 * step) {
        const col = Math.round((x - left) / step), row = Math.round((y - top) / step);
        const dx = x - left - col * step, dy = y - top - row * step;
        if (x >= left && x <= left + 14 * step && y >= top && y <= top + 14 * step && (Math.abs(dx) < .8 || Math.abs(dy) < .8)) rgb = [72, 64, 53];
        const color = board[row * 15 + col];
        if (color && Math.hypot(dx, dy) < step * .39) rgb = color === 1 ? [32, 35, 29] : [247, 247, 242];
      }
    }
    data.set([...rgb, 255], (y * width + x) * 4);
  }
  return { image: { data, width, height }, board, rect: { left, top, right: left + step * 14, bottom: top + step * 14 } };
}
function closeTo(actual, expected, tolerance = 2) {
  assert.ok(actual, "grid was not detected");
  for (const key of ["left", "top", "right", "bottom"]) assert.ok(Math.abs(actual[key] - expected[key]) <= tolerance, `${key}: ${actual[key]} vs ${expected[key]}`);
}
test("locates 15-line grids placed at different heights and offsets in phone and desktop screenshots", () => {
  for (const options of [
    {}, { width: 600, height: 600, left: 115, top: 80, step: 24, stones: 0 },
    { width: 450, height: 850, left: 39, top: 361, step: 25, stones: 70, skin: [193, 201, 179] },
    { width: 720, height: 420, left: 210, top: 32, step: 24, stones: 15 }
  ]) {
    const { image, rect } = screenshot(options); closeTo(findBoardGrid(image), rect);
  }
});
test("a suggested crop can be used to recognize the expected stones", () => {
  const { image, board, rect } = screenshot({ stones: 20 });
  const suggested = findBoardGrid(image); closeTo(suggested, rect);
  assert.deepEqual(recognizeBoard(image, suggested).board, board);
});
test("finds and recognizes the board in a real saved mobile screenshot", () => {
  const image = PNG.sync.read(readFileSync(new URL('./reports/mobile.png', import.meta.url)));
  const suggested = findBoardGrid(image);
  closeTo(suggested, { left: 43, top: 274, right: 346, bottom: 577 });
  const { board } = recognizeBoard(image, suggested);
  assert.deepEqual([...board].flatMap((color, index) => color ? [[index, color]] : []), [[112, 1]]);
});
test("does not invent a crop for blank images, ordinary page decoration, or malformed input", () => {
  const { image } = screenshot({ stones: 0 });
  for (let y = 120; y < 600; y++) for (let x = 10; x < image.width - 10; x++) image.data.set([236, 235, 231, 255], (y * image.width + x) * 4);
  assert.equal(findBoardGrid(image), null);
  assert.equal(findBoardGrid({ width: 400, height: 600, data: [] }), null);
});
