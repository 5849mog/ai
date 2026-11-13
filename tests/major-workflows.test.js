import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord } from '../game-record.js';
import { OpeningSession, replaySession } from '../opening-session.js';
import { reviewFrames } from '../game-review.js';
import { reviewBranch } from '../review-branch.js';
import { createGameArchive, parseArchiveBackup, ARCHIVE_KEY } from '../game-archive.js';
import { createArchiveUi } from '../archive-ui.js';
import { drawBoardImage, boardImageBlob } from '../board-image.js';
function store(limit=50){const map=new Map();let i=0,stamp=1,blocked=false;const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>{if(blocked)throw Error('quota');map.set(k,v)},removeItem:k=>map.delete(k)};return {map,storage,archive:createGameArchive({storage,page:'test',id:()=>`id${++i}`,now:()=>stamp++,limit}),block:()=>{blocked=true;}};}
const won=()=>createRecord([0,15,1,16,2,17,3,18,4],1);
test('branching a legacy review keeps its original and exactly the selected moves',()=>{const record=won(),before=JSON.stringify(record),branch=reviewBranch(record,4);assert.deepEqual(branch.moves,[0,15,1,16]);assert.equal(JSON.stringify(record),before);assert.throws(()=>reviewBranch(record,9),/尚未结束/);});
test('formal review branch preserves swaps, proposal ownership and partial fifth candidates',()=>{
 const s=new OpeningSession({rule:'rif',workflow:'follow',initialBlackSeat:0});for(const index of [112,97,96])s.apply({type:'stone',index});s.apply({type:'decision',choice:'swap'});s.apply({type:'stone',index:128});s.apply({type:'offer',index:s.allowedMoves({safe:true})[0]});
 const partial=s.record(), partialState=replaySession(partial);while(!s.winner){const index=s.allowedMoves({safe:true})[0];assert.ok(Number.isInteger(index));s.apply({type:s.offerCount?'offer':s.stage==='choose'?'select':'stone',index});}
 const record=s.record(), review=reviewFrames(record), restored=replaySession(reviewBranch(record,partial.events.length));assert.equal(review.frames.length,record.events.length+1);assert.equal(restored.blackSeat,partialState.blackSeat);assert.deepEqual(restored.candidates,partialState.candidates);assert.deepEqual(restored.board,partialState.board);assert.deepEqual(restored.actors,partialState.actors);
});
test('backup roundtrip preserves metadata, merges safely, skips repeats and never partially imports',()=>{
 const a=store();a.archive.capture(won(),{timeMs:5000});const id=a.archive.list()[0].id;a.archive.annotate(id,{name:'强敌',note:'检查换色'});a.archive.favorite(id);const text=a.archive.exportBackup();assert.equal(parseArchiveBackup(text).length,1);
 const b=store();assert.deepEqual(b.archive.importBackup(text),{added:1,skipped:0});assert.equal(b.archive.list()[0].note,'检查换色');assert.equal(b.archive.list()[0].favorite,true);assert.deepEqual(b.archive.importBackup(text),{added:0,skipped:1});
 const c=store(1);c.archive.capture(createRecord([112],1));const before=c.map.get(ARCHIVE_KEY);assert.throws(()=>c.archive.importBackup(text),/超过/);assert.equal(c.map.get(ARCHIVE_KEY),before);
 const invalid=JSON.parse(text);invalid.entries.push({...invalid.entries[0],id:'broken',record:{}});assert.throws(()=>b.archive.importBackup(JSON.stringify(invalid)));assert.equal(b.archive.list().length,1);
 const d=store();d.block();assert.throws(()=>d.archive.importBackup(text),/存储/);assert.equal(d.archive.list().length,0);
 const collision=store();collision.archive.capture(createRecord([113],1));assert.deepEqual(collision.archive.importBackup(text),{added:1,skipped:0});assert.deepEqual(collision.archive.importBackup(text),{added:0,skipped:1});assert.equal(collision.archive.list().length,2);
});
test('backup preview is non-mutating until explicitly confirmed',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.com'}),original=globalThis.document;globalThis.document=dom.window.document;
 try {const a=store(),b=store();a.archive.capture(won());const text=a.archive.exportBackup(),root=document.querySelector('#root'),ui=createArchiveUi(root,{archive:b.archive,close(){},resume(){},review(){},exportRecord(){}});ui.open();const input=root.querySelector('[data-backup-file]');await input.onchange({target:{files:[{size:text.length,text:async()=>text}],value:''}});assert.equal(b.archive.list().length,0);assert.match(root.querySelector('[data-backup-preview]').textContent,/1 局/);root.querySelector('[data-backup-confirm]').click();assert.equal(b.archive.list().length,1);ui.dispose();}finally{globalThis.document=original;dom.window.close();}
});
test('PNG renderer draws real stones and labels proposals separately',async()=>{
 const text=[],arcs=[];const gradient={addColorStop(){}};const ctx={createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(...args){arcs.push(args)},fill(){},fillText(...args){text.push(args)}};
 const board=new Uint8Array(225);board[112]=1;board[113]=2;drawBoardImage(ctx,{board,lastMove:113,candidates:[97,98]});assert.deepEqual(text.map(x=>x[0]),['A1','A2']);assert.ok(arcs.length>=14);
 const doc={createElement:()=>({getContext:()=>ctx,toBlob:callback=>callback(new Blob(['png'],{type:'image/png'}))})};assert.equal((await boardImageBlob({board},doc)).type,'image/png');assert.throws(()=>drawBoardImage(ctx,{board:[]}),/棋盘无效/);
});

test('unfinished review reconstruction stays identical to historical review for completed games',async()=>{
 const {reviewFramesIncludingUnfinished}=await import('../partial-review.js');
 const records=[won()];
 for(const rule of ['renju','rif','taraguchi10']){
  const board=new Uint8Array(225);board[112]=1;
  const s=new OpeningSession({rule,workflow:'follow',initialBlackSeat:0,seed:{board,sideToMove:2}});
  while(!s.winner){const index=s.allowedMoves({safe:true})[0];s.apply({type:'stone',index});}
  records.push(s.record());
 }
 for(const record of records)assert.deepEqual(reviewFramesIncludingUnfinished(record),reviewFrames(record));
 const partial=new OpeningSession({rule:'rif',workflow:'follow',initialBlackSeat:0});
 for(const index of [112,97,96])partial.apply({type:'stone',index});partial.apply({type:'decision',choice:'swap'});
 const review=reviewFramesIncludingUnfinished(partial.record());assert.equal(review.frames.length,5);assert.equal(review.frames.at(-1).winner,0);assert.equal(replaySession(reviewBranch(partial.record(),4)).blackSeat,partial.blackSeat);
});
