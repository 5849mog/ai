import test from "node:test";
import assert from "node:assert/strict";
import { boardRectangle, recognizeBoard } from "./image-board.js";

function screenshot({ width = 650, height = 660, step = 40, left = 40, top = 40, skin = [218, 183, 128], overlay = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4), board = new Uint8Array(225);
  for (const [i, c] of [[0, 1], [14, 2], [112, 1], [113, 2], [210, 2], [224, 1], [97, 2]]) board[i] = c;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb = skin; const col = Math.round((x - left) / step), row = Math.round((y - top) / step);
    if (col >= 0 && col < 15 && row >= 0 && row < 15) {
      const dx = x - left - col * step, dy = y - top - row * step, radius = Math.hypot(dx, dy), color = board[row * 15 + col];
      if (Math.abs(dx) < .9 || Math.abs(dy) < .9) rgb = [70, 62, 50];
      if (col === 7 && row === 7 && radius < 3.5) rgb = [70, 62, 50];
      if (color && radius < step * .42) rgb = radius > step * .37 ? [100, 95, 80] : color === 1 ? [35, 38, 31] : [245, 245, 239];
      if (overlay && row === 7 && col === 7 && Math.abs(dx) < 3 && Math.abs(dy) < 8) rgb = [245, 245, 239];
    }
    const i = (y * width + x) * 4; data.set([...rgb, 255], i);
  }
  return { image: { data, width, height }, board, rect: { left, top, right: left + 14 * step, bottom: top + 14 * step } };
}
test("local recognition separates grid/stars from black and white stones, including all corners", () => {
  for (const options of [{}, { skin: [244, 242, 235] }, { skin: [184, 196, 169], overlay: true }, { width: 800, height: 720, left: 120, top: 70 }]) {
    const { image, board, rect } = screenshot(options), original = image.data.slice();
    const result = recognizeBoard(image, rect); assert.deepEqual(result.board, board); assert.deepEqual(image.data, original);
    assert.equal(result.confidence.length, 225);
  }
});
test("manual calibration rejects low resolution, outside corners, skewed crop and malformed pixels", () => {
  assert.throws(() => boardRectangle({ x: 0, y: 0 }, { x: 40, y: 40 }, 100, 100), /分辨率/);
  assert.throws(() => boardRectangle({ x: -1, y: 0 }, { x: 400, y: 400 }, 500, 500));
  assert.throws(() => boardRectangle({ x: 0, y: 0 }, { x: 400, y: 100 }, 500, 500), /正视/);
  const { image, rect } = screenshot(); assert.throws(() => recognizeBoard({ ...image, data: [] }, rect), /像素/);
  assert.deepEqual(boardRectangle({ x: 450, y: 460 }, { x: 20, y: 30 }, 500, 500), { left: 20, top: 30, right: 450, bottom: 460 });
});
test("unsupported dark skins and transparent pixels are flagged for manual correction", () => {
  const { image, rect } = screenshot({ skin: [50, 45, 40] });
  assert.equal(recognizeBoard(image, rect).uncertain.length, 225);
  image.data.fill(0); const result = recognizeBoard(image, rect); assert.equal(result.uncertain.length, 225); assert.equal(result.board.filter(Boolean).length, 0);
});
