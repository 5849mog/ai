// Real completed games only. Each opening is played twice with colors swapped.
// Games within a process run serially; parallel batches must use distinct CPU cores.
import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { createHash } from 'node:crypto';
import { createFreestyleNodeEngine } from './freestyle-node-engine.js';
import { OPENINGS } from '../tests/fixtures/openings.js';
import { outcome } from '../game-rules.js';
import { APP_VERSION } from '../app-release.js';

const args = Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>{const [k,...v]=x.slice(2).split('=');return [k,v.join('=')||true];}));
const output=String(args.output||'reports/real-games-2026-11.json');
const count=Number(args.openings||2);assert.ok(Number.isInteger(count)&&count>=1&&count<=OPENINGS.length);
const allMatchups=[[1000,5000],[1000,10000],[5000,10000]];
const matchups=args.pair?allMatchups.filter(pair=>pair.join('-')===args.pair):allMatchups;
assert.ok(matchups.length, 'Unknown matchup');
const openings=OPENINGS.slice(0,count).map(o=>({id:o.id,moves:o.moves.map(([x,y])=>y*15+x)}));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources={};
for(const path of ['scripts/real-game-benchmark.js','scripts/freestyle-node-engine.js','tests/fixtures/openings.js','game-rules.js','engine-protocol.js','engine-assessment.js','engine/rapfi-250615/manifest.json','engine/rapfi-250615/rapfi-single-simd128.js','engine/rapfi-250615/rapfi-single-simd128.wasm','engine/rapfi-250615/rapfi.data'])sources[path]=sha(await readFile(path));
const identity={appVersion:APP_VERSION,sourceCommit:process.env.GIT_COMMIT||'unrecorded',rule:'freestyle-15',engine:'Rapfi single-thread SIMD WASM · mix9svq',threads:1,memoryMiB:256,matchups,openings,sources};
let report;if(args.resume){report=JSON.parse(await readFile(output,'utf8'));assert.deepEqual(report.identity,identity,'Cannot resume changed benchmark');}else report={schema:2,identity,device:{cpu:cpus()[0]?.model||'unknown',os:`${process.platform} ${release()}`,arch:process.arch,node:process.version},startedAt:new Date().toISOString(),complete:false,games:[]};
const save=async()=>{await writeFile(output+'.tmp',JSON.stringify(report,null,2)+'\n');await rename(output+'.tmp',output);};
const engine=await createFreestyleNodeEngine();await engine.search({board:new Uint8Array(225),sideToMove:1,timeMs:100,allowSetup:true});
try{
 for(const [shortMs,longMs] of matchups)for(const opening of openings)for(const longColor of [1,2]){
  const id=`${shortMs}-${longMs}-${opening.id}-${longColor}`;let game=report.games.find(g=>g.id===id);
  if(game?.winner)continue;
  if(!game){game={id,openingId:opening.id,shortMs,longMs,longColor,moves:[],winner:0};report.games.push(game);await save();}
  const board=new Uint8Array(225);for(const [i,index] of opening.moves.entries())board[index]=i%2+1;
  let side=opening.moves.length%2+1,winner=0;
  for(const move of game.moves){assert.equal(move.color,side);assert.equal(board[move.index],0);board[move.index]=side;winner=outcome(board,move.index);assert.equal(winner,0);side=3-side;}
  while(!winner){
   const budgetMs=side===longColor?longMs:shortMs;engine.clear();const start=performance.now();
   const result=await engine.search({board,sideToMove:side,timeMs:budgetMs,allowSetup:true});const wallMs=Math.round(performance.now()-start);
   assert.ok(Number.isInteger(result.index)&&result.index>=0&&result.index<225&&!board[result.index]);
   board[result.index]=side;winner=outcome(board,result.index);
   game.moves.push({index:result.index,color:side,budgetMs,wallMs,depth:result.depth??null,nodes:result.nodes??null});side=3-side;game.winner=winner;await save();
   console.log(`${id} ply=${opening.moves.length+game.moves.length} elapsed=${wallMs}ms winner=${winner}`);
  }
  console.log(`FINISHED ${id} winner=${winner} games=${report.games.filter(g=>g.winner).length}/${matchups.length*count*2}`);
 }
 report.complete=true;report.finishedAt=new Date().toISOString();await save();
}catch(e){report.failure=String(e.stack||e);await save();throw e;}
