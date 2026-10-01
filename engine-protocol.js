import { SIZE, BLACK, WHITE, validatePosition, validIndex } from "./game-rules.js";

// BOARD's 1/2 mean own/opponent, not black/white. Always start with black
// and alternate to preserve the NNUE evaluator's actual color perspective.
export function boardCommand(board, sideToMove) {
  validatePosition(board, sideToMove);
  const stones = { [BLACK]: [], [WHITE]: [] };
  board.forEach((color, index) => { if (color) stones[color].push(index); });
  if (!stones[BLACK].length) return "BEGIN";
  const lines = ["BOARD"];
  for (let turn = 0; turn < stones[BLACK].length; turn += 1) {
    for (const color of [BLACK, WHITE]) {
      const index = stones[color][turn];
      if (index === undefined) continue;
      lines.push(`${index % SIZE},${Math.floor(index / SIZE)},${color === sideToMove ? 1 : 2}`);
    }
  }
  lines.push("DONE");
  return lines.join("\n");
}

export function searchCommands(board, sideToMove, timeMs) {
  if (!Number.isInteger(timeMs) || timeMs < 1 || timeMs > 30_000) throw new Error("思考时间无效");
  return ["INFO timeout_match 0", `INFO timeout_turn ${timeMs}`, "INFO time_left 2147483647",
    boardCommand(board, sideToMove)];
}

export function parseOutput(line) {
  const text = line.trim();
  if (text.startsWith("ERROR")) return { type: "error", message: text.slice(5).trim() };
  if (text === "OK") return { type: "ok" };
  const move = /^(\d+),(\d+)$/.exec(text);
  if (move) {
    const x = Number(move[1]);
    const y = Number(move[2]);
    const index = y * SIZE + x;
    if (x >= SIZE || y >= SIZE || !validIndex(index)) return { type: "error", message: "引擎返回了越界落点" };
    return { type: "move", index, x, y };
  }
  const stat = /^INFO (DEPTH|SELDEPTH|TOTALNODES|TOTALTIME|SPEED|EVAL) (-?\d+(?:\.\d+)?)$/.exec(text);
  if (stat) {
    const names = { DEPTH: "depth", SELDEPTH: "selectiveDepth", TOTALNODES: "nodes", TOTALTIME: "elapsed", SPEED: "nps", EVAL: "evaluation" };
    return { type: "stats", stats: { [names[stat[1]]]: Number(stat[2]) } };
  }
  return { type: "message", message: text };
}
