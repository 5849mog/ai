import { OpeningSession, replaySession, RULES } from "./opening-session.js";
import { createRecord, replayRecord, parseRecord, exportSgf, MAX_RECORD_BYTES, RECORD_KEY } from "./game-record.js";
import { ARCHIVE_KEY } from "./game-archive.js";

// Both public entry pages use one session model. Old freestyle records retain
// their seed, exact move order, player color and automatic opponent turns.
export function sessionFromRecord(record) {
  if (record?.format === "gomoku-opening") return replaySession(record);
  const game = replayRecord(record), clean = game.record;
  const session = new OpeningSession({ rule: "freestyle", workflow: "duel", initialBlackSeat: clean.playerColor === 1 ? 0 : 1, seed: clean.setup });
  for (const index of clean.moves) session.apply({ type: "stone", index }, { automatic: session.actor === 1 });
  return session;
}
export function parseSessionRecord(text, defaultColor = 1) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_RECORD_BYTES) throw Error("棋谱文件过大，最多支持 1 MiB");
  const clean = text.replace(/^\uFEFF/, "").trim();
  let data;
  if (!clean.startsWith("(")) { try { data = JSON.parse(clean); } catch { throw Error("无法读取棋谱，请选择五目 JSON 或 SGF 文件"); } }
  if (data?.format === "gomoku-opening") return { session: replaySession(data), notices: [], type: "五目" };
  const parsed = parseRecord(clean, defaultColor);
  return { ...parsed, legacy: parsed.record, session: sessionFromRecord(parsed.record) };
}
export function sessionSgf(record) {
  const s = sessionFromRecord(record);
  if (s.rule === "freestyle") return exportSgf(createRecord(s.moves, s.playerColor || 1, s.options.seed));
  const coord = i => String.fromCharCode(97 + i % 15, 97 + Math.floor(i / 15));
  const seed = s.options.seed;
  const setup = seed ? [1, 2].map(color => {
    const points = seed.board.flatMap((c, i) => c === color ? [coord(i)] : []);
    return points.length ? `${color === 1 ? "AB" : "AW"}[${points.join("][")}]` : "";
  }).join("") + `PL[${seed.sideToMove === 1 ? "B" : "W"}]` : "";
  return `(;GM[4]FF[4]CA[UTF-8]SZ[15]RU[${RULES[s.rule]}]C[完整开局操作请使用五目 JSON。]${setup}${s.moves.map((i, n) => `;${s.colors[n] === 1 ? "B" : "W"}[${coord(i)}]`).join("")})\n`;
}
export function loadSessionRecord(storage, key) {
  let saved, legacy, error, raw;
  try { const raw = storage.getItem(RECORD_KEY); if (raw) legacy = replayRecord(JSON.parse(raw)).record; } catch { error = "旧无禁手记录暂时无法读取，原始记录仍保留。"; }
  try { raw = storage.getItem(key); if (raw) { saved = JSON.parse(raw); saved.record = replaySession(saved.record).record(); } }
  catch { saved = null; try { if (raw) storage.setItem(key + ":unreadable-backup", raw); } catch { /* original data remains if storage is blocked */ } error = "上次棋局暂时无法读取，可从最近对局恢复。"; }
  if (saved?.unified) return { saved, backups: [], error: undefined };
  const backups = [legacy, saved?.record].filter(Boolean);
  let useLegacy = !saved && legacy;
  // Once unified, both URLs resume the same selected game. During the first
  // migration, prefer the most recently archived matching old-page game.
  if (saved && !saved.unified && legacy) {
    try {
      const entries = JSON.parse(storage.getItem(ARCHIVE_KEY))?.entries ?? [];
      const stamp = record => Math.max(0, ...entries.filter(e => JSON.stringify(e.record) === JSON.stringify(record) && Number.isFinite(e.updatedAt)).map(e => e.updatedAt));
      useLegacy = stamp(legacy) > stamp(saved.record);
    } catch { /* without timestamps the existing complete session takes priority */ }
  }
  if (useLegacy) {
    const session = sessionFromRecord(legacy);
    saved = { record: session.record(), perspective: legacy.playerColor };
    try {
      const analysis = JSON.parse(storage.getItem(RECORD_KEY.replace("gomoku-game:", "gomoku-analysis:")));
      const oldPositionKey = legacy.setup ? `${legacy.setup.sideToMove}:${legacy.setup.board.join("")}` : "standard";
      if (analysis?.positionKey === oldPositionKey && analysis.playerColor === legacy.playerColor && JSON.stringify(analysis.moves) === JSON.stringify(legacy.moves)) {
        saved.analysis = { ...analysis, positionKey: `freestyle:${session.options.seed ? session.options.seed.board.join("") + session.options.seed.sideToMove : "opening"}` };
      }
    } catch { /* derived assessments are optional */ }
  }
  return { saved, backups, error, sourceRecord: useLegacy ? legacy : null };
}
