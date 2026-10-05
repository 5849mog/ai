const N = 15, DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const at = (x, y) => x >= 0 && x < N && y >= 0 && y < N ? y * N + x : -1;
function line(index, dx, dy) {
  const x = index % N, y = Math.floor(index / N);
  return Array.from({ length: 29 }, (_, i) => at(x + (i - 14) * dx, y + (i - 14) * dy)).filter(i => i >= 0);
}
function run(board, index, dx, dy) {
  const row = line(index, dx, dy), p = row.indexOf(index), color = board[index];
  let a = p, b = p;
  while (a > 0 && board[row[a - 1]] === color) a--;
  while (b + 1 < row.length && board[row[b + 1]] === color) b++;
  return b - a + 1;
}
export function hasExactFive(board, index) { return Boolean(board[index]) && DIRECTIONS.some(([dx, dy]) => run(board, index, dx, dy) === 5); }
export function renjuOutcome(board, index) {
  if (board[index] === 1 && hasExactFive(board, index)) return 1;
  if (board[index] === 2 && DIRECTIONS.some(([dx, dy]) => run(board, index, dx, dy) >= 5)) return 2;
  return board.every(Boolean) ? 3 : 0;
}
// A four is counted by its stones, not by winning ends. A real three needs
// a legal extension to a straight four; recursively reject false threes.
export function blackForbidden(board, index) {
  if (!Number.isInteger(index) || index < 0 || index >= 225 || board[index]) throw new Error("禁手落点必须为空");
  const copy = Uint8Array.from(board), memo = new Map(); copy[index] = 1;
  function placed(point) {
    if (hasExactFive(copy, point)) return "";
    if (DIRECTIONS.some(([dx, dy]) => run(copy, point, dx, dy) >= 6)) return "长连";
    if (copy.filter(value => value === 1).length < 5) return "";
    const key = `${point}:${copy.join("")}`;
    if (memo.has(key)) return memo.get(key);
    const rows = DIRECTIONS.map(([dx, dy]) => line(point, dx, dy)), fours = new Set();
    for (let d = 0; d < rows.length; d++) {
      const row = rows[d], [dx, dy] = DIRECTIONS[d];
      for (let start = 0; start + 5 <= row.length; start++) {
        const window = row.slice(start, start + 5);
        if (!window.includes(point) || window.some(i => copy[i] === 2)) continue;
        const stones = window.filter(i => copy[i] === 1), holes = window.filter(i => !copy[i]);
        if (stones.length !== 4 || holes.length !== 1) continue;
        copy[holes[0]] = 1;
        if (run(copy, holes[0], dx, dy) === 5) fours.add(stones.join(","));
        copy[holes[0]] = 0;
      }
    }
    if (fours.size >= 2) { memo.set(key, "四四"); return "四四"; }
    let threes = 0;
    for (let d = 0; d < rows.length; d++) {
      const row = rows[d], [dx, dy] = DIRECTIONS[d]; let real = false;
      for (let start = 1; start + 4 < row.length && !real; start++) {
        const window = row.slice(start, start + 4);
        if (!window.includes(point) || copy[row[start - 1]] || copy[row[start + 4]] || window.some(i => copy[i] === 2)) continue;
        const holes = window.filter(i => !copy[i]); if (holes.length !== 1) continue;
        const extension = holes[0]; copy[extension] = 1;
        const ends = [row[start - 1], row[start + 4]];
        const open = ends.every(end => { copy[end] = 1; const win = run(copy, end, dx, dy) === 5; copy[end] = 0; return win; });
        real = open && !hasExactFive(copy, extension) && !placed(extension); copy[extension] = 0;
      }
      if (real && ++threes >= 2) { memo.set(key, "三三"); return "三三"; }
    }
    memo.set(key, ""); return "";
  }
  return placed(index);
}
export function moveVerdict(board, index, color, rule = "freestyle") {
  if (![1, 2].includes(color)) throw new Error("棋色无效");
  if (!Number.isInteger(index) || index < 0 || index >= 225 || board[index]) throw new Error("落点无效或已有棋子");
  const forbidden = rule !== "freestyle" && color === 1 ? blackForbidden(board, index) : "";
  const copy = Uint8Array.from(board); copy[index] = color;
  const winner = forbidden ? 2 : rule === "freestyle"
    ? DIRECTIONS.some(([dx, dy]) => run(copy, index, dx, dy) >= 5) ? color : copy.every(Boolean) ? 3 : 0 : renjuOutcome(copy, index);
  return { winner, forbidden };
}
export function validateSeed(board) {
  if (!board || board.length !== 225 || Array.from(board).some(c => ![0, 1, 2].includes(c))) throw new Error("棋盘必须包含 225 个有效交点");
  if (board.every(Boolean)) throw new Error("棋盘已满");
  for (let index = 0; index < 225; index++) if (board[index] && DIRECTIONS.some(([dx, dy]) => run(board, index, dx, dy) >= 5)) throw new Error("起始局面已有五连或长连");
}
export function transform(index, symmetry) {
  let x = index % N - 7, y = Math.floor(index / N) - 7;
  if (symmetry >= 4) x = -x;
  for (let i = 0; i < symmetry % 4; i++) [x, y] = [-y, x];
  return (y + 7) * N + x + 7;
}
export function positionSymmetries(board) { return Array.from({ length: 8 }, (_, i) => i).filter(s => board.every((color, index) => color === board[transform(index, s)])); }
export function candidateKey(index, symmetries) { return Math.min(...symmetries.map(s => transform(index, s))); }
export function distinctCandidates(board, indices) {
  const symmetries = positionSymmetries(board), keys = new Set();
  return indices.filter(index => { const key = candidateKey(index, symmetries); if (keys.has(key)) return false; keys.add(key); return true; });
}
export function inCentral(index, width) { const radius = (width - 1) / 2; return Math.abs(index % 15 - 7) <= radius && Math.abs(Math.floor(index / 15) - 7) <= radius; }
