import assert from "node:assert/strict";
import test from "node:test";
import { OpeningSession } from "../opening-session.js";
import { createRecord } from "../game-record.js";
import { migratePublishedStorage, migrateDesktopSession } from "../site-storage.js";

const old = "/ai/", current = "/gomoku-studio/";
const saved = scope => `gomoku-opening:${scope}:v1`;
const archive = scope => `gomoku-archive:${scope}:v1`;
function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function record(...indices) {
  const game = new OpeningSession({ rule: "freestyle", workflow: "local", initialBlackSeat: 0 });
  for (const index of indices) game.apply({ type: "stone", index });
  return game.record();
}
const live = record(112, 113), clean = record(), other = record(97, 113);
const envelope = record => JSON.stringify({ unified: true, perspective: 2, record });
const archiveRecord = (id, record, metadata = {}) => ({ id, createdAt: 1, updatedAt: 2, record, ...metadata });
const archiveEnvelope = (...entries) => JSON.stringify({ version: 1, entries });

test("restores the old active game and its archive without altering the old keys", () => {
  const oldSession = envelope(live);
  const oldGames = archiveEnvelope(archiveRecord("old-id", live, { favorite: true, name: "棋局" }));
  const storage = store({ [saved(old)]: oldSession, [saved(current)]: envelope(clean), [archive(old)]: oldGames,
    [archive(old) + ":active:opening"]: "old-id", [saved(old) + ":variety"]: "opening-history",
    "gomoku-release-notes:/ai/content/feed.json:v1": "saved-notes" });
  assert.equal(migratePublishedStorage(storage, current), null);
  assert.equal(storage.getItem(saved(current)), oldSession);
  assert.equal(storage.getItem(archive(current)), oldGames);
  assert.equal(storage.getItem(archive(current) + ":active:opening"), "old-id");
  assert.equal(storage.getItem(saved(current) + ":variety"), "opening-history");
  assert.equal(storage.getItem("gomoku-release-notes:/gomoku-studio/content/feed.json:v1"), "saved-notes");
  storage.removeItem(archive(current));
  migratePublishedStorage(storage, current);
  assert.equal(storage.getItem(archive(current)), null);
  assert.equal(storage.getItem(archive(old)), oldGames);
});

test("keeps a played new game and preserves both archives when IDs collide", () => {
  const incoming = archiveEnvelope(archiveRecord("same", live, { note: "from old" }));
  const storage = store({ [saved(old)]: envelope(live), [saved(current)]: envelope(other),
    [archive(old)]: incoming, [archive(current)]: archiveEnvelope(archiveRecord("same", other)),
    [archive(current) + ":active:opening"]: "same" });
  migratePublishedStorage(storage, current);
  const entries = JSON.parse(storage.getItem(archive(current))).entries;
  assert.deepEqual(entries.map(e => [e.id, e.record, e.note]), [["same", other, undefined], ["same-old-site-1", live, "from old"]]);
  assert.equal(storage.getItem(saved(current)), envelope(other));
  assert.equal(storage.getItem(archive(current) + ":active:opening"), "same");
  assert.equal(storage.getItem(archive(old)), incoming);
});

test("prioritizes new archives at capacity and leaves an intact legacy copy for backup", () => {
  const incoming = archiveEnvelope(archiveRecord("old-id", live));
  const existing = archiveEnvelope(...Array.from({ length: 50 }, (_, index) => archiveRecord(String(index), other)));
  const storage = store({ [saved(current)]: envelope(other), [archive(old)]: incoming, [archive(current)]: existing });
  assert.equal(migratePublishedStorage(storage, current), "archive-full");
  assert.equal(storage.getItem(archive(current)), existing);
  assert.equal(storage.getItem(archive(old)), incoming);
});

test("older freestyle saves can replace an empty shell created at the new site", () => {
  const legacy = JSON.stringify(createRecord([112, 113], 1));
  const storage = store({ [saved(current)]: envelope(clean), "gomoku-game:/ai/:v1": legacy });
  migratePublishedStorage(storage, current);
  assert.equal(storage.getItem(saved(current)), null);
  assert.equal(storage.getItem("gomoku-game:/gomoku-studio/:v1"), legacy);
});

test("desktop pairing only follows the same tab and disconnect stays disconnected", () => {
  const key = "gomoku-remote:/ai/:v1", newKey = "gomoku-remote:/gomoku-studio/:v1";
  const storage = store({ [key]: "pairing", [key + ":client"]: "session-id" });
  migrateDesktopSession(storage, "/plain/");
  assert.equal(storage.getItem(newKey), null);
  migrateDesktopSession(storage, current);
  assert.equal(storage.getItem(newKey), "pairing");
  assert.equal(storage.getItem(newKey + ":client"), "session-id");
  storage.removeItem(newKey);
  migrateDesktopSession(storage, current);
  assert.equal(storage.getItem(newKey), null);
});
