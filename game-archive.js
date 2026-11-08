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
export function parseArchiveBackup(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error("备份文件不能超过 2 MiB");
  let data; try { data = JSON.parse(text); } catch { throw new Error("无法读取备份文件"); }
  if (data?.format !== "wumu-archive-backup" || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 50) throw new Error("不是有效的五目对局备份");
  const seen = new Set();
  return data.entries.map(entry => {
    if (!entry || typeof entry.id !== "string" || !entry.id || entry.id.length > 200 || seen.has(entry.id) || !Number.isFinite(entry.updatedAt) || !Number.isFinite(entry.createdAt) || typeof entry.name !== "string" || entry.name.length > 40 || typeof entry.note !== "string" || entry.note.length > 500 || typeof entry.favorite !== "boolean") throw new Error("备份中有无效或重复的对局");
    seen.add(entry.id); const summary = archiveSummary(entry.record);
    if (!summary.meaningful) throw new Error("备份中包含空对局");
    if (entry.meta != null && (typeof entry.meta !== "object" || Array.isArray(entry.meta))) throw new Error("备份中的附加信息无效");
    return { id: entry.id, createdAt: entry.createdAt, updatedAt: entry.updatedAt, favorite: entry.favorite, name: entry.name, note: entry.note, record: summary.record, meta: entry.meta ?? {} };
  });
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
      const entry={id:active,createdAt:existing?.createdAt??stamp,updatedAt:stamp,favorite:existing?.favorite??false,name:existing?.name??"",note:existing?.note??"",record:summary.record,
        meta:{version:meta.version,timeMs:meta.timeMs,mode:meta.mode,openingPlan:meta.openingPlan??null}};
      if(existing) entries.splice(entries.indexOf(existing),1); entries.push(entry); return write(entries);
    },
    favorite(value) {const entries=read(), entry=entries.find(e=>e.id===value); if(!entry)return false;entry.favorite=!entry.favorite;return write(entries);},
    annotate(value, {name, note}) {
      const entries=read(),entry=entries.find(e=>e.id===value);if(!entry)return false;
      entry.name=String(name??"").trim().slice(0,40);entry.note=String(note??"").trim().slice(0,500);return write(entries);
    },
    exportBackup() {
      const entries = read().map(e => ({ id:e.id, createdAt:Number.isFinite(e.createdAt)?e.createdAt:e.updatedAt, updatedAt:e.updatedAt, favorite:Boolean(e.favorite), name:e.name??"", note:e.note??"", record:e.record, meta:e.meta??{} }));
      return JSON.stringify({ format:"wumu-archive-backup", version:1, entries }, null, 2);
    },
    importBackup(text) {
      const incoming = parseArchiveBackup(text), entries = read(), used = new Set(entries.map(e => e.id)); let added = 0, skipped = 0;
      const equivalent = (a,b) => JSON.stringify(a.record) === JSON.stringify(b.record) && (a.name??"") === b.name && (a.note??"") === b.note && Boolean(a.favorite) === b.favorite;
      for (const item of incoming) {
        const same = entries.find(e => e.id === item.id);
        if (same && equivalent(same,item)) { skipped++; continue; }
        if (used.has(item.id)) {
          const base = item.id.slice(0, 180); let n = 1, duplicate = false;
          while (used.has(`${base}-导入${n}`)) { if (equivalent(entries.find(e=>e.id===`${base}-导入${n}`),item)) { duplicate=true; break; } n++; }
          if (duplicate) { skipped++; continue; } item.id = `${base}-导入${n}`;
        }
        used.add(item.id); entries.push(item); added++;
      }
      if (entries.length > limit) throw new Error(`导入后超过 ${limit} 局，请先整理最近对局`);
      if (added && !write(entries)) throw new Error("设备存储不可用，未导入任何对局");
      return { added, skipped };
    },
    remove(value) {
      const entries=read(); if(!entries.some(e=>e.id===value))return false;
      // A failed storage write must not detach the still-current archived game.
      const removed=write(entries.filter(e=>e.id!==value)); if(removed&&value===active)use(); return removed;
    },
    restore(entry) {
      const entries=read();
      // Never overwrite a newer copy or evict another game to undo a deletion.
      if(!entry || typeof entry.id!=="string" || !Number.isFinite(entry.updatedAt) || entries.some(e=>e.id===entry.id) || entries.length>=limit) return false;
      try { if(!archiveSummary(entry.record).meaningful)return false; } catch { return false; }
      entries.push({id:entry.id,createdAt:entry.createdAt,updatedAt:entry.updatedAt,favorite:Boolean(entry.favorite),name:entry.name??"",note:entry.note??"",record:entry.record,meta:entry.meta});
      return write(entries);
    },
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
    const entry=JSON.parse(storage.getItem(TRANSFER_KEY)); if(!entry || format && entry.record?.format!==format)return null;
    archiveSummary(entry.record); storage.removeItem(TRANSFER_KEY); return entry;
  } catch {return null;}
}
export const archiveTitle = entry => `${RULES[entry.rule]} · ${entry.moves} 手 · ${entry.winner===3?"和棋":entry.winner?entry.winner===entry.playerColor?"我方胜":"我方负":"未结束"}`;
