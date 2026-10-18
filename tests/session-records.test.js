import test from "node:test";
import assert from "node:assert/strict";
import { createRecord, replayRecord, RECORD_KEY } from "../game-record.js";
import { OpeningSession, isAutomaticTurn } from "../opening-session.js";
import { ARCHIVE_KEY } from "../game-archive.js";
import { sessionFromRecord, parseSessionRecord, sessionSgf, loadSessionRecord } from "../session-records.js";
const key = "current", storage = values => { const data = new Map(Object.entries(values)); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; };
for (const playerColor of [1, 2]) for (const moves of [[112], [112, 97], [112, 97, 96]]) test(`old color ${playerColor}, ${moves.length} moves preserves position and pending owner`, () => {
  const record = createRecord(moves, playerColor), old = replayRecord(record), next = sessionFromRecord(record);
  assert.deepEqual(next.board, old.board); assert.deepEqual(next.moves, moves); assert.equal(next.color, old.currentColor);
  assert.equal(next.playerColor, playerColor); assert.equal(next.workflow, "duel");
  assert.equal(isAutomaticTurn(next), old.currentColor !== playerColor);
  assert.deepEqual(Array.from(next.undo().board), Array.from(old.rounds.at(-1)?.board ?? new Uint8Array(225)));
});
test("custom seeds, terminal games and SGF roundtrips survive conversion", () => {
  const board = Array(225).fill(0); board[112] = 1; board[97] = 1;
  const record = createRecord([0, 15], 2, { board, sideToMove: 2 }), s = sessionFromRecord(record);
  const parsed = parseSessionRecord(sessionSgf(s.record()));
  assert.deepEqual(parsed.session.board, s.board); assert.deepEqual(parsed.session.options.seed, s.options.seed); assert.equal(parsed.session.playerColor, 2);
  const terminal = sessionFromRecord(createRecord([0, 15, 1, 16, 2, 17, 3, 18, 4], 1)); assert.equal(terminal.winner, 1);
  assert.equal(terminal.undo().winner, 0);
});
test("formal proposals retain full events, workflow, ownership and candidates", () => {
  const s = new OpeningSession({ rule: "rif", workflow: "follow", initialBlackSeat: 1 });
  for (const i of [112, 97, 96]) s.apply({ type: "stone", index: i });
  s.apply({ type: "decision", choice: "swap" }); s.apply({ type: "stone", index: 0 }); s.apply({ type: "offer", index: 1 });
  const next = parseSessionRecord(JSON.stringify(s.record())).session;
  assert.deepEqual(next.record(), s.record()); assert.deepEqual(next.candidates, [1]); assert.equal(next.playerColor, s.playerColor);
});
test("first migration chooses the latest old page and keeps both recoverable records", () => {
  const old = createRecord([112, 97], 1), formal = new OpeningSession({ rule: "rif", workflow: "follow" }); formal.apply({ type: "stone", index: 112 });
  const saved = { record: formal.record(), perspective: 1 };
  const f = storage({ [RECORD_KEY]: JSON.stringify(old), [key]: JSON.stringify(saved), [ARCHIVE_KEY]: JSON.stringify({entries:[{record:old,updatedAt:20},{record:formal.record(),updatedAt:10}]}) });
  const result = loadSessionRecord(f, key); assert.equal(result.saved.record.rule, "freestyle"); assert.equal(result.backups.length, 2);
  assert.equal(f.getItem(RECORD_KEY), JSON.stringify(old)); assert.equal(f.getItem(key), JSON.stringify(saved));
  saved.unified = true; f.setItem(key, JSON.stringify(saved)); assert.equal(loadSessionRecord(f, key).saved.record.rule, "rif");
});
test("missing archives preserve the complete session, and damaged storage is backed up", () => {
  const old = createRecord([112], 1), complete = new OpeningSession({ rule: "taraguchi10", initialBlackSeat: null }).record();
  const f = storage({[RECORD_KEY]:JSON.stringify(old),[key]:JSON.stringify({record:complete,perspective:2})});
  assert.deepEqual(loadSessionRecord(f,key).saved.record,complete);
  f.setItem(key,"damaged"); const result=loadSessionRecord(f,key);
  assert.equal(result.saved.record.rule,"freestyle"); assert.equal(f.getItem(key+":unreadable-backup"),"damaged"); assert.ok(result.error);
});
test("record parsing rejects invalid input and oversized files without mutating a session", () => {
  assert.throws(()=>parseSessionRecord('{"format":"gomoku-opening"}'));
  assert.throws(()=>parseSessionRecord("字".repeat(400000)),/1 MiB/);
  assert.throws(()=>sessionFromRecord(createRecord([112,112],1)),/重复/);
});
test("legacy assessments migrate only with the exact seed, moves and player color", () => {
  const old=createRecord([112,97],1),analysisKey=RECORD_KEY.replace("gomoku-game:","gomoku-analysis:");
  const analysis={version:1,positionKey:"standard",playerColor:1,moves:old.moves,points:[]};
  const f=storage({[RECORD_KEY]:JSON.stringify(old),[analysisKey]:JSON.stringify(analysis)});
  assert.equal(loadSessionRecord(f,key).saved.analysis.positionKey,"freestyle:opening");
  f.setItem(analysisKey,JSON.stringify({...analysis,positionKey:"a different seed"}));
  assert.equal(loadSessionRecord(f,key).saved.analysis,undefined);
});
