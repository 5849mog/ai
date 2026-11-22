import { hasFive, SIZE } from "./game-rules.js";
import { moveVerdict } from "./renju-rules.js";

export function winningPoints(board, color, rule, moves = board.keys()) {
  let stones = 0;
  for (const stone of board) if (stone === color) stones++;
  if (stones < 4) return [];
  const probe = board.slice(), points = [];
  for (const index of moves) {
    if (probe[index] !== 0) continue;
    probe[index] = color;
    const five = hasFive(probe, index % SIZE, Math.floor(index / SIZE), color);
    probe[index] = 0;
    if (five && moveVerdict(board, index, color, rule).winner === color) points.push(index);
  }
  return points;
}

export function tacticalPosition(board, color, rule, allowedMoves) {
  return {
    wins: winningPoints(board, color, rule, allowedMoves),
    threats: winningPoints(board, 3 - color, rule)
  };
}

export function explainMove(board, index, color, rule, tactical) {
  if (board[index] !== 0 || !tactical) return "";
  if (tactical.wins.includes(index)) return "落下即胜";
  const after = board.slice();
  after[index] = color;
  // A new white stone can change the legality of a black reply under Renju.
  const remaining = rule !== "freestyle" && color === 2 ? winningPoints(after, 1, rule)
    : tactical.threats.filter(point => point !== index);
  if (remaining.length) return tactical.threats.length > 1 ? "对手仍有胜点" : "未挡对手胜点";
  if (tactical.threats.length) return "挡下一手即胜点";
  const nextWins = winningPoints(after, color, rule);
  return nextWins.length > 1 ? "形成多个胜点" : nextWins.length === 1 ? "形成下一手胜点" : "";
}

export function forcedReplyEnding(tactical, color, rule) {
  // Without forbidden moves, filling one intersection can remove at most
  // one existing win for the other color. An immediate win takes priority.
  if (rule !== "freestyle" || !tactical || tactical.wins.length || tactical.threats.length < 2) return null;
  return { plies: 2, winner: 3 - color };
}

export function immediateEnding(board, color, rule, allowedMoves) {
  if (board.filter(stone => !stone).length === 1) {
    const index = board.indexOf(0);
    if (!allowedMoves.includes(index) && !(rule !== "freestyle" && color === 1)) return null;
    const { winner } = moveVerdict(board, index, color, rule);
    return { plies: 1, winner };
  }
  return winningPoints(board, color, rule, allowedMoves).length ? { plies: 1, winner: color } : null;
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
  return { text: `${short} · ${result}`, short, state: "estimated", source: immediate ? "board" : "engine" };
}
