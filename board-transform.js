import { BLACK, SIZE, CELL_COUNT, WHITE } from "./game-rules.js";

export const BOARD_TRANSFORMS = [
  ["rotateLeft", "左转 90°"],
  ["rotateRight", "右转 90°"],
  ["mirror", "左右镜像"],
  ["flip", "上下镜像"],
  ["swap", "黑白互换"]
];

export function transformedIndex(index, action) {
  const x = index % SIZE, y = Math.floor(index / SIZE), edge = SIZE - 1;
  if (action === "rotateLeft") return (edge - x) * SIZE + y;
  if (action === "rotateRight") return x * SIZE + edge - y;
  if (action === "mirror") return y * SIZE + edge - x;
  if (action === "flip") return (edge - y) * SIZE + x;
  return index;
}

export function transformBoard(board, action) {
  const next = new Uint8Array(CELL_COUNT);
  for (let index = 0; index < CELL_COUNT; index++) {
    const color = board[index];
    next[transformedIndex(index, action)] = action === "swap" && color ? BLACK + WHITE - color : color;
  }
  return next;
}

export function boardTransformMarkup() {
  return BOARD_TRANSFORMS.map(([action, label]) => `<option value="${action}">${label}</option>`).join("");
}
