import { hasFive, SIZE } from "./game-rules.js";
import { moveVerdict } from "./renju-rules.js";

export function immediateEnding(board, color, rule, allowedMoves) {
  if (board.filter(stone => !stone).length === 1) {
    const index = board.indexOf(0);
    if (!allowedMoves.includes(index) && !(rule !== "freestyle" && color === 1)) return null;
    const { winner } = moveVerdict(board, index, color, rule);
    return { plies: 1, winner };
  }
  const probe = board.slice();
  for (const index of allowedMoves) {
    probe[index] = color;
    const five = hasFive(probe, index % SIZE, Math.floor(index / SIZE), color);
    probe[index] = 0;
    if (five && moveVerdict(board, index, color, rule).winner === color) return { plies: 1, winner: color };
  }
  return null;
}

export function endgameEstimate({ winner, available, immediate, point, emptyCount }) {
  if (winner) return { text: "已结束", short: "", state: "finished" };
  if (!available) return { text: "开局后推演", short: "", state: "waiting" };
  const estimate = immediate ?? (point?.kind === "engine" && [1, 2].includes(point.forcedColor)
    && Number.isInteger(point.matePlies) && point.matePlies > 0 && point.matePlies <= emptyCount
    ? { plies: point.matePlies, winner: point.forcedColor } : null);
  if (!estimate) return { text: "暂无明确终局", short: "", state: "waiting" };
  const result = ["", "黑胜", "白胜", "和棋"][estimate.winner];
  const short = `${immediate ? "" : "约"}${estimate.plies} 手`;
  return { text: `${short} · ${result}`, short, state: "estimated" };
}
