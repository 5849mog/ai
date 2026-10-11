import test from 'node:test';
import assert from 'node:assert/strict';
import { thinkAdaptive, createThinkingBudget, BudgetExhausted, thinkingSettings } from '../adaptive-search.js';
import { adviseAdaptiveOpening } from '../adaptive-opening.js';
import { OpeningSession } from '../opening-session.js';
import { distinctCandidates, moveVerdict } from '../renju-rules.js';
function fixture(handler=()=>({}),limit=6000) {
  let clock=0;const calls=[];
  const search=async (o,c)=>{const points=o.allowedMoves??Array.from(o.board,(v,i)=>v?-1:i).filter(i=>i>=0),index=points[0];clock+=o.timeMs;calls.push({options:o,context:c});
    const extra=handler(o,c,calls.length,index),chosen=extra.index??index;
    return {index:chosen,assessment:{bestIndex:chosen,depth:12,winRate:.55,mate:null},recommendations:points.slice(0,o.multiPV??1).map((index,n)=>({index,depth:12,winRate:n?.54:.55,score:20-n})),...extra};};
  return {search,calls,settings:{now:()=>clock,budgetMs:limit},time:()=>clock};
}
function board(stones) {const b=new Uint8Array(225);for(const [index,color]of stones)b[index]=color;return b;}
function formal(rule='rif') {const s=new OpeningSession({rule,workflow:'follow',initialBlackSeat:0});
 for(const index of [112,97,96,128]){s.apply({type:'stone',index});if(s.decision&&s.stage!=='route4')s.apply({type:'decision',choice:'keep'});}return s;}
for(const rule of ['freestyle','renju','rif','taraguchi10'])test(`${rule}: direct win and unique immediate defence use zero engine calls and preserve board`,async()=>{
  const f=fixture(),b=board([[0,2],[1,2],[2,2],[3,2],[15,1]]),before=b.slice();
  const result=await thinkAdaptive({board:b,sideToMove:2,rule},f.search,f.settings);assert.equal(result.index,4);assert.equal(f.calls.length,0);assert.deepEqual(b,before);
  const block=await thinkAdaptive({board:b,sideToMove:1,rule},f.search,f.settings);assert.equal(block.index,4);assert.equal(f.calls.length,0);assert.equal(block.assessment,undefined);
});
test('Renju forbidden long line is never used as an immediate winning move',async()=>{
 const b=board([[0,1],[1,1],[2,1],[4,1],[5,1]]),f=fixture();const r=await thinkAdaptive({board:b,sideToMove:1,rule:'renju'},f.search,f.settings);
 assert.notEqual(r.index,3);assert.equal(moveVerdict(b,r.index,1,'renju').forbidden,'');assert.ok(f.calls.length>0);
});
test('single legal point is immediate; old 30-second preference migrates to adaptive',async()=>{
 const f=fixture(),r=await thinkAdaptive({board:new Uint8Array(225),sideToMove:1,allowedMoves:[112]},f.search,f.settings);assert.equal(r.index,112);assert.equal(f.calls.length,0);
 assert.deepEqual(thinkingSettings('30000'),{mode:'adaptive',timeMs:6000});
});
test('clear stable candidates stop early after discovery and single-line confirmation',async()=>{
 const f=fixture((o,c,n,index)=>({assessment:{bestIndex:index,winRate:.7,depth:15},recommendations:[{index:0,depth:15,winRate:.7},{index:1,depth:15,winRate:.4}]}));
 const r=await thinkAdaptive({board:new Uint8Array(225),sideToMove:1},f.search,f.settings);assert.equal(f.calls.length,2);assert.equal(r.adaptive.status,'首选稳定');assert.equal(f.time(),1100);assert.equal(f.calls[1].options.multiPV,1);
});
test('close candidates trigger opponent replies and an unrestricted final root, sharing 6 seconds',async()=>{
 const f=fixture(),b=board([[112,1]]),original=b.slice();const r=await thinkAdaptive({board:b,sideToMove:2},f.search,f.settings);
 assert.ok(f.calls.some(c=>c.context.root===false&&c.options.sideToMove===1));assert.equal(f.calls.at(-1).context.root,true);assert.ok(f.calls.at(-1).options.allowedMoves.length>2);
 assert.ok(f.time()<=6000);assert.ok(r.adaptive.candidateChecks>=2);assert.deepEqual(b,original);
});
test('mismatched assessment PV cannot establish stability or attach a score to the chosen move',async()=>{
 const f=fixture((o,c,n,index)=>({assessment:{bestIndex:index+1,winRate:.7,depth:15},recommendations:[{index:0,depth:15,winRate:.7},{index:1,depth:15,winRate:.3}]}));
 const r=await thinkAdaptive({board:new Uint8Array(225),sideToMove:1},f.search,f.settings);assert.ok(f.calls.length>2);assert.equal(r.adaptive.status,'有限复核');
});
test('0% without a completed mate proof is described as unfavorable, never proven defeat',async()=>{
 const f=fixture((o,c,n,index)=>({assessment:{bestIndex:index,winRate:0,depth:12,mate:null}}));const r=await thinkAdaptive({board:new Uint8Array(225),sideToMove:1},f.search,f.settings);
 assert.equal(r.adaptive.status,'局面仍不利');assert.doesNotMatch(r.adaptive.status,/必败/);
});
test('deadline stops a hung follow-up search and returns only a previously completed legal root',async()=>{
 let calls=0,cancelled=0;const result=await thinkAdaptive({board:new Uint8Array(225),sideToMove:1},async o=>{
  if(++calls>1)return new Promise(()=>{});return {index:112,recommendations:[{index:112},{index:113}]};
 },{budgetMs:150,cancelSearch:()=>cancelled++});assert.equal(result.index,112);assert.equal(cancelled,1);assert.equal(calls,2);assert.match(result.adaptive.status,/预算/);
});
test('cancellation after any hypothetical reply emits neither a final search nor a stale result',async()=>{
 let cancelled=false;const f=fixture((o,c)=>{if(c.root===false)cancelled=true;return {};});
 await assert.rejects(thinkAdaptive({board:board([[112,1]]),sideToMove:2},f.search,{...f.settings,isCancelled:()=>cancelled}),{name:'AbortError'});
 assert.equal(f.calls.at(-1).context.root,false);
});
test('nested search allocation and elapsed overhead consume the same deadline',async()=>{
 let time=0;const b=createThinkingBudget(async o=>{time+=o.timeMs+100;return {index:112};},{now:()=>time,budgetMs:1000});
 await b.run({board:new Uint8Array(225)},600,'first');await b.run({board:new Uint8Array(225)},600,'second');assert.ok(time<=1050);
 await assert.rejects(b.run({board:new Uint8Array(225)},100,'third'),BudgetExhausted);
});
for(const rule of ['rif','taraguchi10'])test(`${rule}: adaptive proposals compare white replies, keep exact distinct group size, and never place hypothetical stones`,async()=>{
 const s=formal(rule);if(s.decision)s.apply({type:'decision',choice:'ten'});const before=JSON.stringify(s.record()),f=fixture();
 const r=await adviseAdaptiveOpening(s,f.search,f.settings);assert.equal(r.points.length,s.offerCount);assert.equal(distinctCandidates(s.board,r.points).length,s.offerCount);
 assert.ok(f.calls.some(c=>c.options.sideToMove===2&&c.options.board.filter(Boolean).length===5));assert.ok(f.time()<=6000);assert.equal(JSON.stringify(s.record()),before);
});
test('white selects the worst black fifth from actual ten candidates with equal budgets',async()=>{
 const s=formal('taraguchi10');s.apply({type:'decision',choice:'ten'});for(const index of s.allowedMoves({safe:true}).slice(0,10))s.apply({type:'offer',index});
 const target=s.candidates.at(-1),f=fixture((o,c,n,index)=>({assessment:{bestIndex:index,winRate:o.board[target]===1?.95:.2,depth:12}}));
 const r=await adviseAdaptiveOpening(s,f.search,f.settings);assert.equal(r.points[0],target);assert.equal(f.calls.length,10);assert.equal(new Set(f.calls.map(c=>c.options.timeMs)).size,1);
});
test('partial proposal floor includes already recorded candidates while returning only remaining points',async()=>{
 const s=formal();s.apply({type:'offer',index:223});const f=fixture((o,c,n,index)=>o.sideToMove===2?{assessment:{bestIndex:index,winRate:o.board[223]===1?.99:.3,depth:12}}:{});
 const r=await adviseAdaptiveOpening(s,f.search,f.settings);assert.equal(r.points.length,1);assert.ok(r.adaptive.blackFloor<.02);assert.ok(!r.points.includes(223));
});
for(const [rule,stage] of [['rif','swap3'],['rif','w4'],['taraguchi10','route4']])test(`${rule} ${stage}: nested opening continuations share the deadline and preserve actual ownership`,async()=>{
 const s=formal(rule);// build the exact swap prefix separately
 const input=stage==='swap3'?new OpeningSession({rule:'rif',workflow:'follow',initialBlackSeat:1}):s;
 if(stage==='swap3')for(const index of [112,97,96])input.apply({type:'stone',index});
 const before=JSON.stringify(input.record()),f=fixture();const r=await adviseAdaptiveOpening(input,f.search,f.settings);
 assert.ok(f.time()<=6000);assert.equal(JSON.stringify(input.record()),before);assert.ok(r.choice || r.points?.length);assert.ok(r.adaptive.searches>1);
});
test('an incomplete candidate batch stays a limited review even when the final root score is known',async()=>{
 const f=fixture((o,c,n,index)=>({recommendations:[{index}]}));const r=await thinkAdaptive({board:new Uint8Array(225),sideToMove:1},f.search,f.settings);assert.equal(r.adaptive.status,'有限复核');
});
test('a forbidden sole blocking point cannot become a zero-search black defence',async()=>{
 const b=board([[0,1],[1,1],[2,1],[4,1],[5,1],[78,1],[18,2],[33,2],[48,2],[63,2]]),f=fixture();
 assert.equal(moveVerdict(b,3,1,'renju').forbidden,'长连');const r=await thinkAdaptive({board:b,sideToMove:1,rule:'renju'},f.search,f.settings);
 assert.notEqual(r.index,3);assert.ok(f.calls.length>0);assert.equal(moveVerdict(b,r.index,1,'renju').forbidden,'');
});
