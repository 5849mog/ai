const at = ([x,y]) => y * 15 + x;
function make(id, black, white, kind, pairs = 3) {
  const board = new Uint8Array(225);
  for (const point of black) board[at(point)] = 1;
  for (const point of white) {
    if (board[at(point)]) throw new Error("Fixture overlap");
    board[at(point)] = 2;
  }
  if (black.length !== white.length + 1) throw new Error("Fixture turn count");
  return { id, board: Array.from(board), sideToMove: 2, kind, pairs };
}
const filler = [[0,0],[2,0],[0,2],[2,2],[14,14]];
const chain = make("vcf-two-attacks", [[3,7], ...filler], [[4,7],[5,7],[6,7],[5,5],[6,6]], "vcf", 2);
function transform(board, rotation, mirror) {
  const result = new Uint8Array(225);
  board.forEach((c, i) => {
    let x = i % 15, y = Math.floor(i / 15);
    if (mirror) x = 14-x;
    for (let n = 0; n < rotation; n++) [x,y] = [14-y,x];
    result[y * 15 + x] = c;
  });
  return Array.from(result);
}
export const TACTICS = [
  ...[false,true].flatMap(mirror => [0,1,2,3].map(rotation => ({
    ...chain, id: `${chain.id}-r${rotation}-${mirror ? "mirror" : "normal"}`,
    board: transform(chain.board, rotation, mirror)
  }))),
  make("open-four-fork", filler.slice(0,4), [[5,7],[6,7],[7,7]], "vcf", 1),
  make("two-closed-fours", [[3,7],[7,3], ...filler], [[4,7],[5,7],[6,7],[7,4],[7,5],[7,6]], "vcf", 1),
  make("defend-before-attack", [[4,2],[5,2],[6,2],[7,2],[0,0]], [[3,2],[5,7],[6,7],[7,7]], "block"),
  make("take-win-before-block", [[2,7],[4,2],[5,2],[6,2],[7,2],[0,0]], [[3,7],[4,7],[5,7],[6,7],[3,2]], "win")
];

// Independent exhaustive VCF oracle: no Rapfi output or legacy search is used.
// It enumerates all empty intersections, direct wins and the unique forced reply.
function wonAt(board, index, color) {
  const x = index % 15, y = Math.floor(index / 15);
  for (const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]) {
    let consecutive = 0;
    for (let n = -4; n <= 4; n++) {
      const nx = x + n*dx, ny = y + n*dy;
      if (nx >= 0 && nx < 15 && ny >= 0 && ny < 15 && board[ny*15+nx] === color) {
        if (++consecutive >= 5) return true;
      } else consecutive = 0;
    }
  }
  return false;
}
export function winningPoints(board, color) {
  const wins = [];
  for (let i = 0; i < 225; i++) {
    if (board[i]) continue;
    board[i] = color;
    if (wonAt(board, i, color)) wins.push(i);
    board[i] = 0;
  }
  return wins;
}
function forcingProof(board, attack, attacker, pairs) {
  board[attack] = attacker;
  let proof = null;
  if (wonAt(board, attack, attacker)) proof = [attack];
  else if (!winningPoints(board, 3-attacker).length) {
    const wins = winningPoints(board, attacker);
    if (wins.length > 1) proof = [attack, ...wins];
    else if (wins.length === 1 && pairs > 1) {
      const defense = wins[0];
      board[defense] = 3-attacker;
      for (let next = 0; next < 225; next++) {
        if (board[next]) continue;
        const continuation = forcingProof(board, next, attacker, pairs-1);
        if (continuation) { proof = [attack, defense, ...continuation]; break; }
      }
      board[defense] = 0;
    }
  }
  board[attack] = 0;
  return proof;
}
export function verifyTactic(fixture) {
  const board = [...fixture.board];
  let expected = [];
  const proofs = {};
  if (fixture.kind === "win") expected = winningPoints(board, fixture.sideToMove);
  else if (fixture.kind === "block") {
    expected = winningPoints(board, 3-fixture.sideToMove);
    if (expected.length !== 1 || winningPoints(board, fixture.sideToMove).length) throw new Error("Not a unique compulsory defense");
  } else {
    for (let attack = 0; attack < 225; attack++) {
      if (board[attack]) continue;
      const proof = forcingProof(board, attack, fixture.sideToMove, fixture.pairs);
      if (proof) { expected.push(attack); proofs[attack] = proof; }
    }
  }
  if (!expected.length || JSON.stringify(board) !== JSON.stringify(fixture.board)) throw new Error(`Invalid tactical proof: ${fixture.id}`);
  return { expected, proofs };
}
