import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../game-record.js';
import { OpeningSession, replaySession } from '../opening-session.js';
import { createGameArchive, ARCHIVE_KEY, queueArchiveRestore, takeArchiveRestore } from '../game-archive.js';

function fixture(limit=50) {
  const map=new Map();let serial=0,stamp=0,fail=false;
  const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>{if(fail)throw Error('quota');map.set(key,value);},removeItem:key=>map.delete(key)};
  const options={storage,page:'freestyle',id:()=>`game-${++serial}`,now:()=>++stamp,limit};
  return {map,storage,archive:createGameArchive(options),options,fail:()=>{fail=true;}};
}
test('live updates, undo and terminal result replace one stable game; New retains previous games',()=>{
  const f=fixture(),a=f.archive;a.resume(createRecord([],1));
  for(const moves of [[0],[0,15],[0,15,1],[0,15]])a.capture(createRecord(moves,1),{version:'v36',timeMs:30000});
  assert.equal(a.list().length,1);assert.deepEqual(a.list()[0].record.moves,[0,15]);
  const id=a.list()[0].id;a.capture(createRecord([0,15,1,16,2,17,3,18,4],1));assert.equal(a.list()[0].winner,1);
  a.begin();a.capture(createRecord([112],2));assert.equal(a.list().length,2);assert.equal(a.list()[1].id,id);
});
test('reload deduplicates current record, preserves old entries when restoring a different game and resumes archive id',()=>{
  const f=fixture(),record=createRecord([112,97],1);f.archive.resume(record);f.archive.capture(record);const id=f.archive.list()[0].id;
  const reloaded=createGameArchive(f.options);reloaded.resume(record);reloaded.capture(record);assert.equal(reloaded.list().length,1);
  reloaded.begin();reloaded.capture(createRecord([112,96],1));reloaded.use(id);reloaded.capture(createRecord([112,97,98],1));
  assert.equal(reloaded.list().length,2);assert.deepEqual(reloaded.list().find(e=>e.id===id).record.moves,[112,97,98]);
});
test('RIF and ten-rule archives retain swaps, partial proposals, actor ownership and actual colors',()=>{
  for(const rule of ['rif','taraguchi10']) {
    const f=fixture(),s=new OpeningSession({rule,initialBlackSeat:1});
    for(const index of [112,97,96,128]) {s.apply({type:'stone',index});if(s.decision&&s.stage!=='route4')s.apply({type:'decision',choice:'swap'});}
    if(s.decision)s.apply({type:'decision',choice:'ten'});
    s.apply({type:'offer',index:s.allowedMoves({safe:true})[0]});f.archive.resume(s.record());f.archive.capture(s.record());
    const restored=replaySession(f.archive.list()[0].record);assert.deepEqual(restored.board,s.board);assert.deepEqual(restored.candidates,s.candidates);assert.deepEqual(restored.actors,s.actors);
    assert.equal(restored.playerColor,s.playerColor);assert.equal(restored.moves.length,4);
  }
});
test('archive cap prefers favorites, malformed entries are isolated and failed writes preserve durable history',()=>{
  const f=fixture(3),a=f.archive;
  a.capture(createRecord([0],1));const id=a.list()[0].id;a.favorite(id);
  for(const index of [1,2,3,4]) {a.begin();a.capture(createRecord([index],1));}
  assert.equal(a.list().length,3);assert.equal(a.list().find(e=>e.id===id).favorite,true);
  const saved=f.map.get(ARCHIVE_KEY);f.fail();assert.equal(a.capture(createRecord([5],1)),false);assert.equal(f.map.get(ARCHIVE_KEY),saved);
  assert.equal(a.failed,true);
  const parsed=JSON.parse(saved);parsed.entries.push({id:'broken',updatedAt:9,record:{}});f.map.set(ARCHIVE_KEY,JSON.stringify(parsed));assert.equal(a.list().length,3);
});
test('empty games are omitted and undoing every stone removes the empty active entry',()=>{
  const f=fixture(),a=f.archive;a.capture(createRecord([],1));assert.equal(a.list().length,0);a.capture(createRecord([112],1));a.capture(createRecord([],1));assert.equal(a.list().length,0);
});
test('cross-page restore is validated, consumed once by matching page and retains full opening record',()=>{
  const f=fixture(),s=new OpeningSession({rule:'rif',initialBlackSeat:1});s.apply({type:'stone',index:112});
  const entry={id:'opening',record:s.record()};assert.match(queueArchiveRestore(f.storage,entry),/renju.html\?view=simple$/);
  assert.equal(takeArchiveRestore(f.storage,'gomoku-studio'),null);assert.deepEqual(takeArchiveRestore(f.storage,'gomoku-opening'),entry);assert.equal(takeArchiveRestore(f.storage,'gomoku-opening'),null);
  assert.throws(()=>queueArchiveRestore(f.storage,{record:{}}));
});
test('archive and cross-page transfer preserve a pending three-stone plan for validated book restoration',()=>{
  const f=fixture(),s=new OpeningSession({rule:'rif',workflow:'copilot',initialBlackSeat:0});s.apply({type:'stone',index:112});
  const openingPlan={key:'fixture',points:[112,97,80],remembered:false};f.archive.capture(s.record(),{openingPlan});
  const entry=f.archive.list()[0];assert.deepEqual(entry.meta.openingPlan,openingPlan);queueArchiveRestore(f.storage,entry);
  assert.deepEqual(takeArchiveRestore(f.storage,'gomoku-opening').meta.openingPlan,openingPlan);
});
