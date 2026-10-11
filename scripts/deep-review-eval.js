// Real shipped WASM, sequential fixed-position searches, no browser.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRenjuNodeEngine } from './renju-node-engine.js';
import { replaySession } from '../opening-session.js';
import { moveVerdict } from '../renju-rules.js';
import { reviewFrames } from '../game-review.js';
import { analyzeOpeningReview } from '../opening-review.js';
import { APP_VERSION } from '../app-release.js';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const output = process.argv[2] ?? 'reports/deep-review-v36.json';
const original = JSON.parse(await readFile(new URL('../reports/formal-modes-v35.json', import.meta.url)));
const report = {version:1,appVersion:APP_VERSION,started:new Date().toISOString(),runtime:process.version,
  method:'Shipped single-thread SIMD WASM and verified Renju NNUE; hash cleared per budget comparison; sequential 1/10/30-second searches on identical legal positions. Review uses real opening prefixes from the v35 flow report, with synthetic legal finishing stones solely to activate terminal-only review. No browser, human win-rate, Elo, exhaustive solver or guaranteed strength improvement.',sources:{},assets:{},budgets:[],reviews:[]};
for(const path of ['game-review.js','opening-review.js','opening-advisor.js','scripts/deep-review-eval.js','scripts/renju-node-engine.js'])report.sources[path]=digest(await readFile(new URL('../'+path,import.meta.url)));
for(const [path,hash] of Object.entries(original.engineAssets)){report.assets[path]=digest(await readFile(new URL('../'+path,import.meta.url)));assert.equal(report.assets[path],hash);}
const engine=await createRenjuNodeEngine();
const warm=replaySession(original.cases[0].record);await engine.search({board:warm.board,sideToMove:warm.color,timeMs:100,allowSetup:true});
const save=async()=>{report.finished=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n');};
for(const name of ['rif-seat0-keep','taraguchi-seat0-normal-mixed']){
  const s=replaySession(original.cases.find(c=>c.name===name).record);assert.equal(s.winner,0);
  const entry={name,rule:s.rule,record:s.record(),boardSha256:digest(s.board),sideToMove:s.color,searches:[]};report.budgets.push(entry);
  for(const timeMs of [1000,10000,30000]){
    engine.clear();const start=performance.now();const result=await engine.search({board:s.board.slice(),sideToMove:s.color,timeMs,allowedMoves:s.allowedMoves({safe:true}),allowSetup:true});
    assert.ok(s.canPoint(result.index));assert.equal(moveVerdict(s.board,result.index,s.color,s.rule).forbidden,'');
    assert.ok(Number.isFinite(result.assessment?.winRate));assert.match(result.weight,/mix9svqrenju_bs15_(black|white)\.bin\.lz4$/);
    entry.searches.push({timeMs,wallMs:Math.round(performance.now()-start),result});console.log(name,timeMs,result.index,result.depth,result.nodes);await save();
  }
}
for(const name of ['rif-seat0-keep','taraguchi-forced-ten-negative-control']){
  const s=replaySession(original.cases.find(c=>c.name===name).record);
  // Never feed fabricated finishing stones into opening-node evaluations.
  while(!s.winner){const index=s.allowedMoves({safe:true})[0];assert.ok(Number.isInteger(index));s.apply({type:'stone',index});}
  const all=reviewFrames(s.record());const stages=name.startsWith('rif')?['swap3','offer2','choose']:['route4','offer10','choose'];
  const review={...all,openings:all.openings.filter(n=>stages.includes(n.stage)||n.kind==='group')};assert.equal(review.openings.length,3);
  const entry={name,rule:s.rule,terminalActivation:'synthetic legal finish',record:s.record(),searches:[],rows:[]};report.reviews.push(entry);engine.clear();
  entry.rows=await analyzeOpeningReview(review,async options=>{
    assert.equal(options.rule,s.rule);const result=await engine.search(options);
    assert.equal(moveVerdict(options.board,result.index,options.sideToMove,s.rule).forbidden,'');
    assert.ok(Number.isFinite(result.assessment?.winRate));entry.searches.push({boardSha256:digest(options.board),sideToMove:options.sideToMove,timeMs:options.timeMs,multiPV:options.multiPV??1,result});return result;
  },{timeMs:1000,onProgress:({rows})=>{entry.rows=rows;console.log('review',name,rows.at(-1).stage,rows.at(-1).loss);}});
  assert.ok(entry.rows.every(row=>Number.isFinite(row.loss)),'All selected formal nodes must receive a complete assessment');
  const choice=entry.rows.find(r=>r.stage==='choose');assert.ok(replaySession(choice.record).candidates.includes(choice.best));
  if(name.includes('negative-control')){const route=entry.rows.find(r=>r.stage==='route4');assert.notEqual(route.choice,'ten');assert.ok(route.loss>.2);}
  await save();
}
console.log('Saved',output);
