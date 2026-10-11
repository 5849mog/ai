import { replayRecord } from "./game-record.js";
import { replaySession, RULES } from "./opening-session.js";
const scope = new URL("./", import.meta.url).pathname;
export const ARCHIVE_KEY = `gomoku-archive:${scope}:v1`;
const TRANSFER_KEY = ARCHIVE_KEY + ":transfer";
export function archiveSummary(record) {
  const opening = record?.format === "gomoku-opening";
  const game = opening ? replaySession(record) : replayRecord(record);
  return { record: opening ? game.record() : game.record, rule: opening ? game.rule : "freestyle",
    winner: game.winner, playerColor: opening ? game.playerColor : game.record.playerColor,
    moves: opening ? game.moves.length : game.record.moves.length,
    meaningful: opening ? game.moves.length > 0 || Boolean(game.options.seed) : game.record.moves.length > 0 || Boolean(game.record.setup) };
}
export function createGameArchive({ storage, page, now = Date.now, id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, limit = 50 } = {}) {
  const activeKey = ARCHIVE_KEY + ":active:" + page;
  let active = null, failed = false, cachedRaw, cachedEntries = [];
  const read = () => {
    try {
      const raw=storage.getItem(ARCHIVE_KEY);
      // Replaying 50 full Renju records on every autosave would block mobile UI.
      // Still read storage each time so changes from another tab are observed.
      if(raw===cachedRaw)return cachedEntries.map(e=>({...e}));
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !Array.isArray(data.entries)) return [];
      const entries=data.entries.slice(0,200).filter(e => {
        try { return typeof e.id === "string" && Number.isFinite(e.updatedAt) && archiveSummary(e.record).meaningful; } catch { return false; }
      });
      cachedRaw=raw;cachedEntries=entries;return entries.map(e=>({...e}));
    } catch { return []; }
  };
  const ordered = entries => entries.sort((a,b) => b.updatedAt-a.updatedAt);
  function write(entries) {
    ordered(entries);
    // Keep at most 50 games; favorites are evicted last. Failed writes never
    // delete the previously durable archive or prevent live play.
    while(entries.length>limit) {
      const index=entries.findLastIndex(e=>!e.favorite && e.id!==active);
      entries.splice(index>=0?index:entries.length-1,1);
    }
    try { const raw=JSON.stringify({version:1,entries});storage.setItem(ARCHIVE_KEY,raw);cachedRaw=raw;cachedEntries=entries;failed=false; return true; }
    catch { failed=true; return false; }
  }
  function use(value=null) { active=value??id(); try {storage.setItem(activeKey,active);} catch {failed=true;} return active; }
  return {
    list: () => ordered(read()).map(e=>({...e,...archiveSummary(e.record)})),
    resume(record) {
      try {active=storage.getItem(activeKey);} catch {active=null;}
      const existing=read().find(e=>e.id===active);
      if(!existing || JSON.stringify(existing.record)!==JSON.stringify(archiveSummary(record).record)) use();
    },
    begin: () => use(), use,
    capture(record, meta={}) {
      const summary=archiveSummary(record); if(!summary.meaningful) {const entries=read();return entries.some(e=>e.id===active)?write(entries.filter(e=>e.id!==active)):true;}
      if(!active) use(); const entries=read(), existing=entries.find(e=>e.id===active), stamp=now();
      const entry={id:active,createdAt:existing?.createdAt??stamp,updatedAt:stamp,favorite:existing?.favorite??false,record:summary.record,
        meta:{version:meta.version,timeMs:meta.timeMs,openingPlan:meta.openingPlan??null}};
      if(existing) entries.splice(entries.indexOf(existing),1); entries.push(entry); return write(entries);
    },
    favorite(value) {const entries=read(), entry=entries.find(e=>e.id===value); if(!entry)return false;entry.favorite=!entry.favorite;return write(entries);},
    remove(value) {const entries=read();if(value===active)use();return write(entries.filter(e=>e.id!==value));},
    get failed() {return failed;}
  };
}
export function queueArchiveRestore(storage, entry) {
  const summary=archiveSummary(entry.record);
  storage.setItem(TRANSFER_KEY,JSON.stringify({id:entry.id,record:summary.record,meta:entry.meta}));
  return new URL((summary.record.format==="gomoku-opening"?"renju.html":"index.html")+"?view=simple",import.meta.url).href;
}
export function takeArchiveRestore(storage, format) {
  try {
    const entry=JSON.parse(storage.getItem(TRANSFER_KEY)); if(!entry || entry.record?.format!==format)return null;
    archiveSummary(entry.record); storage.removeItem(TRANSFER_KEY); return entry;
  } catch {return null;}
}
export const archiveTitle = entry => `${RULES[entry.rule]} · ${entry.moves} 手 · ${entry.winner===3?"和棋":entry.winner?entry.winner===entry.playerColor?"我方胜":"我方负":"未结束"}`;
