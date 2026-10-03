import { SIZE, CELL_COUNT, BLACK, WHITE, validIndex, outcome, snapshot } from "./game-rules.js";

export const MAX_RECORD_BYTES = 1024 * 1024;
export const RECORD_KEY = `gomoku-game:${new URL("./", import.meta.url).pathname}:v1`;

export function createRecord(moves, playerColor) {
  return { format: "gomoku-studio", version: 1, size: SIZE, rule: "freestyle", playerColor, moves: Array.from(moves) };
}

// Replaying one ordered history reconstructs every durable state, including
// snapshots before human moves. No serialized board or winner is trusted.
export function replayRecord(record) {
  if (!record || record.format !== "gomoku-studio" || record.version !== 1 || record.size !== SIZE || record.rule !== "freestyle") {
    throw new Error("不支持的五目棋谱格式或规则");
  }
  if (![BLACK, WHITE].includes(record.playerColor) || !Array.isArray(record.moves) || record.moves.length > CELL_COUNT) {
    throw new Error("棋谱执色或手数无效");
  }
  const board = new Uint8Array(CELL_COUNT), rounds = [];
  let lastMove = -1, winner = 0;
  for (let ply = 0; ply < record.moves.length; ply++) {
    const index = record.moves[ply], color = ply % 2 + 1;
    if (winner) throw new Error(`第 ${ply + 1} 手无效：棋局已经结束`);
    if (!validIndex(index) || board[index]) throw new Error(`第 ${ply + 1} 手落点无效或重复`);
    if (color === record.playerColor) rounds.push({ ...snapshot(board, lastMove), moveCount: ply });
    board[index] = color; lastMove = index; winner = outcome(board, index);
  }
  return { record: createRecord(record.moves, record.playerColor), board, rounds, lastMove, winner,
    currentColor: record.moves.length % 2 + 1 };
}

export function serializeRecord(record) {
  return JSON.stringify(replayRecord(record).record, null, 2) + "\n";
}

export function exportSgf(record, date = new Date()) {
  const { record: clean, winner } = replayRecord(record);
  const result = winner ? `RE[${winner === 3 ? "0" : winner === BLACK ? "B+" : "W+"}]` : "";
  const coord = index => String.fromCharCode(97 + index % SIZE, 97 + Math.floor(index / SIZE));
  return `(;FF[4]GM[4]CA[UTF-8]SZ[15]RU[Freestyle]AP[GomokuStudio:2.0]DT[${date.toISOString().slice(0, 10)}]XPC[${clean.playerColor === BLACK ? "B" : "W"}]${result}`
    + clean.moves.map((index, ply) => `;${ply % 2 ? "W" : "B"}[${coord(index)}]`).join("") + ")\n";
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
  const moves = [], notices = [];
  let branch = tree, variations = false;
  while (branch) {
    for (const properties of branch.sequence) {
      if (["AB", "AW", "AE", "PL", "HA"].some(key => properties.has(key))) throw new Error("暂不支持摆局或修改行棋方，请导入从第一手开始的完整棋谱");
      const black = one(properties, "B"), white = one(properties, "W");
      if (black !== undefined && white !== undefined) throw new Error("同一 SGF 节点不能同时落黑白棋子");
      const move = black ?? white;
      if (move === undefined) continue;
      if ((black !== undefined ? BLACK : WHITE) !== moves.length % 2 + 1) throw new Error(`第 ${moves.length + 1} 手黑白顺序错误`);
      if (!/^[a-o]{2}$/.test(move)) throw new Error("SGF 落点越界或包含不支持的停着");
      moves.push((move.charCodeAt(1) - 97) * SIZE + move.charCodeAt(0) - 97);
    }
    variations ||= branch.children.length > 1;
    branch = branch.children[0];
  }
  if (variations) notices.push("此棋谱包含分支，将导入主线。");
  if (one(root, "RE")) notices.push("原棋谱结果仅作信息；继续对局的胜负按棋盘判断。");
  const record = createRecord(moves, playerColor);
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
