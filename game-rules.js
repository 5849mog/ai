export const SIZE = 15;
export const CELL_COUNT = SIZE * SIZE;
export const BLACK = 1;
export const WHITE = 2;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function validIndex(index) {
  return Number.isInteger(index) && index >= 0 && index < CELL_COUNT;
}

export function hasFive(board, x, y, color) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !validIndex(y * SIZE + x) || x < 0 || x >= SIZE || ![BLACK, WHITE].includes(color) || board[y * SIZE + x] !== color) return false;
  for (const [dx, dy] of DIRECTIONS) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let nx = x + dx * sign;
      let ny = y + dy * sign;
      while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny * SIZE + nx] === color) {
        count += 1;
        nx += dx * sign;
        ny += dy * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

export function outcome(board, lastMove) {
  if (validIndex(lastMove) && hasFive(board, lastMove % SIZE, Math.floor(lastMove / SIZE), board[lastMove])) {
    return board[lastMove];
  }
  return board.every(value => value !== 0) ? 3 : 0;
}

export function validatePosition(board, sideToMove) {
  if (!board || board.length !== CELL_COUNT || Array.from(board).some(c => ![0, BLACK, WHITE].includes(c))) {
    throw new Error("棋盘必须包含 225 个有效交点");
  }
  if (![BLACK, WHITE].includes(sideToMove)) throw new Error("行棋方无效");
  const black = Array.from(board).filter(c => c === BLACK).length;
  const white = Array.from(board).filter(c => c === WHITE).length;
  if (!(sideToMove === BLACK ? black === white : black === white + 1)) {
    throw new Error("棋子数量与行棋方不一致");
  }
  if (black + white === CELL_COUNT) throw new Error("棋盘已满");
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (board[i] && hasFive(board, i % SIZE, Math.floor(i / SIZE), board[i])) throw new Error("棋局已经结束");
  }
}

export function snapshot(board, lastMove) {
  return { board: Array.from(board), lastMove };
}

export function restore(board, saved) {
  board.set(saved.board);
  return saved.lastMove;
}
