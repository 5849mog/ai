// Direct published WASM checks; no browser or human win-rate claim.
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRenjuNodeEngine } from './renju-node-engine.js';
import { replaySession } from '../opening-session.js';
import { moveVerdict,distinctCandidates } from '../renju-rules.js';
import { thinkAdaptive } from '../adaptive-search.js';
import { adviseAdaptiveOpening } from '../adaptive-opening.js';
import { APP_VERSION } from '../app-release.js';
const output=process.argv[2]??'reports/adaptive-v39.json',digest=b=>createHash('sha256').update(b).digest('hex');
const old=JSON.parse(await readFile(new URL('../reports/formal-modes-v35.json',import.meta.url)));
const report={version:1,appVersion:APP_VERSION,started:new Date().toISOString(),runtime:process.version,budgetMs:6000,
 method:'Shipped single-thread SIMD WASM, verified Renju weights; fixed legal positions, clear hash per case. Adaptive uses one total wall deadline after warmup, a small root probe and a deeper native root attack/defence search; Taraguchi fourth/fifth continuations and keep/swap/ten comparisons share their deadline. Shortcuts use shared exact legality rules. This checks finite mechanisms, legality and timing, not human win-rate or guaranteed superiority over fixed 6-second search.',sources:{},assets:{},cases:[]};
for(const name of ['adaptive-search.js','adaptive-opening.js','opening-advisor.js','renju-rules.js','scripts/renju-node-engine.js','scripts/adaptive-eval.js'])report.sources[name]=digest(await readFile(new URL('../'+name,import.meta.url)));
for(const [name,hash]of Object.entries(old.engineAssets)){report.assets[name]=digest(await readFile(new URL('../'+name,import.meta.url)));assert.equal(report.assets[name],hash);}
const engine=await createRenjuNodeEngine();const warm=replaySession(old.cases[0].record);await engine.search({board:warm.board,sideToMove:warm.color,timeMs:100,allowSetup:true});
const save=async()=>{report.finished=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n');};
async function check(name,session,kind){
 engine.clear();const original=JSON.stringify(session.record()),entry={name,kind,rule:session.rule,record:session.record(),searches:[],result:null};report.cases.push(entry);
 const search=async(o,context)=>{const result=await engine.search(o);assert.match(result.weight,/mix9svqrenju_bs15_(black|white)\.bin\.lz4$/);
  assert.equal(moveVerdict(o.board,result.index,o.sideToMove,session.rule).forbidden,'');entry.searches.push({sideToMove:o.sideToMove,timeMs:o.timeMs,multiPV:o.multiPV??1,root:context?.root??false,boardSha256:digest(o.board),result});return result;};
 const started=performance.now();entry.result=kind==='ordinary'?await thinkAdaptive({board:session.board,sideToMove:session.color,rule:session.rule,allowedMoves:session.allowedMoves({safe:true}),allowSetup:true},search):await adviseAdaptiveOpening(session,search);
 entry.wallMs=Math.round(performance.now()-started);const meta=entry.result.adaptive;
 assert.ok(meta&&meta.budgetMs===6000);assert.ok(entry.wallMs<6500,'WASM scheduling tolerance: '+entry.wallMs);assert.equal(JSON.stringify(session.record()),original);
 if(entry.result.points){assert.ok(entry.result.points.every(i=>session.canPoint(i)));if(session.offerCount){assert.equal(entry.result.points.length,session.offerCount-session.candidates.length);assert.equal(distinctCandidates(session.board,[...session.candidates,...entry.result.points]).length,session.candidates.length+entry.result.points.length);}}
 else if(kind==='ordinary')assert.ok(session.canPoint(entry.result.index));
 if(name.includes('negative-route'))assert.notEqual(entry.result.choice,'ten');
 console.log(name,entry.wallMs,meta.status,meta.searches);await save();
}
for(const name of ['rif-seat0-keep','taraguchi-seat0-normal-mixed']){
 const s=replaySession(old.cases.find(c=>c.name===name).record);engine.clear();const started=performance.now();
 const fixed=await engine.search({board:s.board,sideToMove:s.color,timeMs:6000,allowSetup:true,allowedMoves:s.allowedMoves({safe:true})});
 assert.equal(moveVerdict(s.board,fixed.index,s.color,s.rule).forbidden,'');report.cases.push({name:name+'-fixed6',kind:'fixed',rule:s.rule,record:s.record(),wallMs:Math.round(performance.now()-started),result:fixed});await save();
 await check(name,s,'ordinary');
}
for(const stage of ['swap3','w4','offer','choose']){
 const source=old.cases[0].record,s=replaySession({...source,events:[]});for(const event of source.events){if(s.stage===stage)break;s.apply(event);}
 assert.equal(s.stage,stage);await check('rif-'+stage,s,'opening');
}
for(const stage of ['swap3','w4','b5','swap5']){
 const source=old.cases.find(c=>c.name==='taraguchi-seat0-normal-mixed').record,s=replaySession({...source,events:[]});for(const event of source.events){if(s.stage===stage)break;s.apply(event);}
 assert.equal(s.stage,stage);await check('taraguchi-'+stage,s,'opening');
}
for(const stage of ['route4','offer10','choose']){
 const source=old.cases.find(c=>c.negativeControl).record,s=replaySession({...source,events:[]});for(const event of source.events){if(s.stage===stage)break;s.apply(event);}
 assert.equal(s.stage,stage);await check('negative-'+(stage==='route4'?'route':stage),s,'opening');
}
const b=new Uint8Array(225);for(const index of [0,1,2,3])b[index]=2;b[15]=1;
let calls=0;for(const color of [1,2]){const r=await thinkAdaptive({board:b,sideToMove:color,rule:'renju'},async()=>{calls++;throw new Error('Shortcut should not search');});assert.equal(r.index,4);report.cases.push({name:'zero-'+color,kind:'shortcut',board:Array.from(b),color,result:r});}
assert.equal(calls,0);await save();console.log('Saved',output);
