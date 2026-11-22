import { archiveSummary } from "./game-archive.js";

const OLD = "/ai/";
const CURRENT = "/gomoku-studio/";
const opening = scope => `gomoku-opening:${scope}:v1`;
const archive = scope => `gomoku-archive:${scope}:v1`;
const version = scope => `gomoku-migrated:${scope}:from-ai:v1`;

function parsed(storage, key) {
  try { return JSON.parse(storage.getItem(key)); } catch { return null; }
}

function copyMissing(storage, from, to) {
  const value = storage.getItem(from);
  if (value !== null && storage.getItem(to) === null) storage.setItem(to, value);
}

function savedGame(storage, key) {
  const result = parsed(storage, key);
  try {
    const summary = archiveSummary(result?.record);
    return { record: summary.record, played: summary.meaningful || summary.record.events?.length > 0 };
  } catch { return null; }
}

function archiveEntries(storage, key) {
  const data = parsed(storage, key);
  if (data?.version !== 1 || !Array.isArray(data.entries)) return [];
  return data.entries.slice(0, 50).filter(item => {
    try { return typeof item.id === "string" && Number.isFinite(item.updatedAt) && archiveSummary(item.record).meaningful; }
    catch { return false; }
  });
}

function mergeArchives(storage, scope, keepCurrent) {
  const oldKey = archive(OLD), newKey = archive(scope);
  const incoming = archiveEntries(storage, oldKey);
  if (!incoming.length) return false;
  const entries = archiveEntries(storage, newKey);
  const ids = new Map(entries.map(item => [item.id, item]));
  const remapped = new Map();
  const sameRecord = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const openingActive = storage.getItem(oldKey + ":active:opening");
  const candidates = incoming.sort((a, b) => Number(b.id === openingActive && !keepCurrent) - Number(a.id === openingActive && !keepCurrent)
    || Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || b.updatedAt - a.updatedAt);
  let excess = false;
  for (const item of candidates) {
    let { id } = item;
    const base = id.slice(0, 170);
    let suffix = 1;
    while (ids.has(id) && !sameRecord(ids.get(id).record, item.record)) id = `${base}-old-site-${suffix++}`;
    if (!ids.has(id)) {
      if (entries.length >= 50) { excess = true; continue; }
      const entry = { ...item, id };
      entries.push(entry);
      ids.set(id, entry);
    }
    remapped.set(item.id, id);
  }
  storage.setItem(newKey, JSON.stringify({ version: 1, entries }));
  for (const page of ["opening", "freestyle"]) {
    const field = ":active:" + page;
    const previous = remapped.get(storage.getItem(oldKey + field));
    if (previous && (!keepCurrent || storage.getItem(newKey + field) === null)) storage.setItem(newKey + field, previous);
  }
  const transfer = parsed(storage, oldKey + ":transfer");
  if (transfer && storage.getItem(newKey + ":transfer") === null && !keepCurrent) {
    storage.setItem(newKey + ":transfer", JSON.stringify({ ...transfer, id: remapped.get(transfer.id) }));
  }
  return excess;
}

export function migratePublishedStorage(storage, scope = new URL("./", import.meta.url).pathname) {
  if (scope !== CURRENT) return null;
  const marker = version(scope);
  const completed = storage.getItem(marker);
  if (completed) return null;

  const oldOpening = opening(OLD), newOpening = opening(scope);
  const oldGame = savedGame(storage, oldOpening), currentGame = savedGame(storage, newOpening);
  const legacy = parsed(storage, `gomoku-game:${OLD}:v1`);
  let legacyPlayed = false;
  try { legacyPlayed = archiveSummary(legacy).meaningful; } catch { /* Invalid records stay at the old address. */ }
  const useOld = !currentGame?.played && Boolean(oldGame?.played || legacyPlayed || oldGame && !currentGame);
  const excess = mergeArchives(storage, scope, !useOld && Boolean(currentGame?.played));
  for (const kind of ["game", "analysis", "release-notes"]) {
    const tail = kind === "release-notes" ? "content/feed.json" : "";
    copyMissing(storage, `gomoku-${kind}:${OLD}${tail}:v1`, `gomoku-${kind}:${scope}${tail}:v1`);
  }
  for (const suffix of [":variety", ":unreadable-backup"]) copyMissing(storage, oldOpening + suffix, newOpening + suffix);
  if (useOld) {
    if (oldGame?.played || oldGame && !legacyPlayed) storage.setItem(newOpening, storage.getItem(oldOpening));
    else storage.removeItem(newOpening); // Allow the existing freestyle importer to restore the old game.
  }
  storage.setItem(marker, "complete");
  return excess ? "archive-full" : null;
}

export function migrateDesktopSession(storage, scope = new URL("./", import.meta.url).pathname) {
  if (scope !== CURRENT || storage.getItem(version(scope))) return;
  for (const suffix of ["", ":client"]) copyMissing(storage, `gomoku-remote:${OLD}:v1${suffix}`, `gomoku-remote:${scope}:v1${suffix}`);
  storage.setItem(version(scope), "complete");
}
