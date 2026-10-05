import { SIZE, CELL_COUNT, BLACK, WHITE, validIndex, outcome, snapshot, validatePosition } from "./game-rules.js";

export const MAX_RECORD_BYTES = 1024 * 1024;
export const RECORD_KEY = `gomoku-game:${new URL("./", import.meta.url).pathname}:v1`;

export function createRecord(moves, playerColor, setup = null) {
  return { format: "gomoku-studio", version: setup ? 2 : 1, size: SIZE, rule: "freestyle", playerColor,
    ...(setup ? { setup: { board: Array.from(setup.board), sideToMove: setup.sideToMove } } : {}), moves: Array.from(moves) };
}

// A validated optional seed plus ordered continuation reconstructs durable
// state and snapshots before human moves. No declared winner is trusted.
export function replayRecord(record) {
  if (!record || record.format !== "gomoku-studio" || ![1, 2].includes(record.version) || record.size !== SIZE || record.rule !== "freestyle") {
    throw new Error("不支持的五目棋谱格式或规则");
  }
  if (![BLACK, WHITE].includes(record.playerColor) || !Array.isArray(record.moves) || record.moves.length > CELL_COUNT) {
    throw new Error("棋谱执色或手数无效");
  }
  const board = new Uint8Array(CELL_COUNT), rounds = [];
  let setup = null;
  if (record.version === 2) {
    if (!record.setup || !Array.isArray(record.setup.board)) throw new Error("自定义棋谱缺少起始局面");
    validatePosition(record.setup.board, record.setup.sideToMove, { allowSetup: true });
    setup = { board: [...record.setup.board], sideToMove: record.setup.sideToMove };
    board.set(setup.board);
    if (board.filter(Boolean).length + record.moves.length > CELL_COUNT) throw new Error("续下手数超出棋盘容量");
  }
  const firstColor = setup?.sideToMove ?? BLACK;
  let lastMove = -1, winner = 0;
  for (let ply = 0; ply < record.moves.length; ply++) {
    const index = record.moves[ply], color = ply % 2 ? 3 - firstColor : firstColor;
    if (winner) throw new Error(`第 ${ply + 1} 手无效：棋局已经结束`);
    if (!validIndex(index) || board[index]) throw new Error(`第 ${ply + 1} 手落点无效或重复`);
    if (color === record.playerColor) rounds.push({ ...snapshot(board, lastMove), moveCount: ply });
    board[index] = color; lastMove = index; winner = outcome(board, index);
  }
  return { record: createRecord(record.moves, record.playerColor, setup), board, rounds, lastMove, winner,
    currentColor: record.moves.length % 2 ? 3 - firstColor : firstColor };
}

export function serializeRecord(record) {
  return JSON.stringify(replayRecord(record).record, null, 2) + "\n";
}

export function exportSgf(record, date = new Date()) {
  const { record: clean, winner } = replayRecord(record);
  const result = winner ? `RE[${winner === 3 ? "0" : winner === BLACK ? "B+" : "W+"}]` : "";
  const coord = index => String.fromCharCode(97 + index % SIZE, 97 + Math.floor(index / SIZE));
  const initial = clean.setup ? [BLACK, WHITE].map(color => {
    const stones = clean.setup.board.flatMap((value, index) => value === color ? [`[${coord(index)}]`] : []);
    return stones.length ? `${color === BLACK ? "AB" : "AW"}${stones.join("")}` : "";
  }).join("") + `PL[${clean.setup.sideToMove === BLACK ? "B" : "W"}]` : "";
  const firstColor = clean.setup?.sideToMove ?? BLACK;
  return `(;FF[4]GM[4]CA[UTF-8]SZ[15]RU[Freestyle]AP[GomokuStudio:2.0]DT[${date.toISOString().slice(0, 10)}]XPC[${clean.playerColor === BLACK ? "B" : "W"}]${result}`
    + initial + clean.moves.map((index, ply) => `;${(ply % 2 ? 3 - firstColor : firstColor) === BLACK ? "B" : "W"}[${coord(index)}]`).join("") + ")\n";
}

// Bounded SGF FF4 scanner: brackets, escapes and variation structure must be
// parsed, not extracted with a move regex (comments may contain fake moves).
function parseSgfTree(text) {
  let cursor = 0, nodes = 0;
  const space = () => { while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++; };
  const expect = character => { space(); if (text[cursor++] !== character) throw new Error("SGF 结构不完整"); };
  function value() {
    expect("["); let result = "";
    while (cursor < text.length) {
      const character = text[cursor++];
      if (character === "]") return result;
      if (character === "\\") {
        if (cursor >= text.length) break;
        const escaped = text[cursor++];
        if (escaped === "\r" || escaped === "\n") {
          if ((escaped === "\r" && text[cursor] === "\n") || (escaped === "\n" && text[cursor] === "\r")) cursor++;
        } else result += escaped;
      } else result += character;
    }
    throw new Error("SGF 属性缺少结束括号");
  }
  function tree(depth) {
    if (depth > 256) throw new Error("SGF 分支层数过多");
    expect("("); const sequence = [], children = [];
    space();
    while (text[cursor] === ";") {
      cursor++; if (++nodes > 10000) throw new Error("SGF 节点过多");
      const properties = new Map(); space();
      while (/[A-Z]/.test(text[cursor] ?? "")) {
        let key = "";
        while (/[A-Z]/.test(text[cursor] ?? "")) key += text[cursor++];
        if (properties.has(key)) throw new Error(`SGF 属性 ${key} 重复`);
        const values = []; space();
        while (text[cursor] === "[") { values.push(value()); space(); }
        if (!values.length) throw new Error(`SGF 属性 ${key} 缺少值`);
        properties.set(key, values); space();
      }
      sequence.push(properties); space();
    }
    if (!sequence.length) throw new Error("SGF 分支没有节点");
    while (text[cursor] === "(") { children.push(tree(depth + 1)); space(); }
    expect(")"); space(); return { sequence, children };
  }
  const root = tree(0); space();
  if (cursor !== text.length) throw new Error(text[cursor] === "(" ? "一次只能导入一局 SGF 棋谱" : "SGF 尾部包含无效内容");
  return root;
}

export function importSgf(text, defaultPlayerColor = BLACK) {
  const tree = parseSgfTree(text.replace(/^\uFEFF/, "").trim());
  const root = tree.sequence[0];
  const one = (properties, key) => {
    const values = properties.get(key);
    if (values && values.length !== 1) throw new Error(`SGF 属性 ${key} 的值无效`);
    return values?.[0];
  };
  if (one(root, "FF") !== "4" || one(root, "GM") !== "4" || one(root, "SZ") !== "15") {
    throw new Error("仅支持 FF[4]、GM[4]、15×15 的五子棋 SGF");
  }
  const rule = one(root, "RU");
  if (rule && rule.trim().toLowerCase() !== "freestyle") throw new Error("仅支持无禁手 Freestyle 棋谱，暂不支持此规则");
  const role = one(root, "XPC");
  const playerColor = role === "B" ? BLACK : role === "W" ? WHITE : defaultPlayerColor;
  let setup = null;
  if (["AB", "AW", "PL"].some(key => root.has(key))) {
    const side = one(root, "PL");
    if (!["B", "W"].includes(side)) throw new Error("摆局 SGF 需在起始节点以 PL[B] 或 PL[W] 指定下一手");
    setup = { board: Array(CELL_COUNT).fill(0), sideToMove: side === "B" ? BLACK : WHITE };
    for (const [key, color] of [["AB", BLACK], ["AW", WHITE]]) for (const coordinate of root.get(key) ?? []) {
      if (!/^[a-o]{2}$/.test(coordinate)) throw new Error("摆局落点无效，仅支持单个棋盘交点");
      const index = (coordinate.charCodeAt(1) - 97) * SIZE + coordinate.charCodeAt(0) - 97;
      if (setup.board[index]) throw new Error("摆局包含重复或重叠棋子");
      setup.board[index] = color;
    }
  }
  const firstColor = setup?.sideToMove ?? BLACK;
  const moves = [], notices = [];
  let branch = tree, variations = false;
  while (branch) {
    for (const properties of branch.sequence) {
      if (["AE", "HA"].some(key => properties.has(key)) || properties !== root && ["AB", "AW", "PL"].some(key => properties.has(key))) {
        throw new Error("仅支持起始节点摆局，不支持中途改子、修改行棋方或让子规则");
      }
      const black = one(properties, "B"), white = one(properties, "W");
      if (black !== undefined && white !== undefined) throw new Error("同一 SGF 节点不能同时落黑白棋子");
      const move = black ?? white;
      if (move === undefined) continue;
      if ((black !== undefined ? BLACK : WHITE) !== (moves.length % 2 ? 3 - firstColor : firstColor)) throw new Error(`第 ${moves.length + 1} 手黑白顺序错误`);
      if (!/^[a-o]{2}$/.test(move)) throw new Error("SGF 落点越界或包含不支持的停着");
      moves.push((move.charCodeAt(1) - 97) * SIZE + move.charCodeAt(0) - 97);
    }
    variations ||= branch.children.length > 1;
    branch = branch.children[0];
  }
  if (variations) notices.push("此棋谱包含分支，将导入主线。");
  if (one(root, "RE")) notices.push("原棋谱结果仅作信息；继续对局的胜负按棋盘判断。");
  const record = createRecord(moves, playerColor, setup);
  replayRecord(record); return { record, notices, type: "SGF" };
}

export function parseRecord(text, defaultPlayerColor = BLACK) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_RECORD_BYTES) throw new Error("棋谱文件过大，最多支持 1 MiB");
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (clean.startsWith("(")) return importSgf(clean, defaultPlayerColor);
  let data;
  try { data = JSON.parse(clean); } catch { throw new Error("无法读取棋谱，请选择五目 JSON 或 SGF 文件"); }
  return { record: replayRecord(data).record, notices: [], type: "五目" };
}

export function loadGame(storage) {
  try {
    const saved = storage.getItem(RECORD_KEY);
    if (!saved) return { game: null };
    return { game: replayRecord(JSON.parse(saved)) };
  } catch { return { game: null, error: "上次对局未能读取，已为你准备新局" }; }
}

export function saveGame(storage, record) {
  try { storage.setItem(RECORD_KEY, serializeRecord(record)); return true; } catch { return false; }
}
