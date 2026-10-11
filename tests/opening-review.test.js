import test from 'node:test';
import assert from 'node:assert/strict';
import { OpeningSession } from '../opening-session.js';
import { distinctCandidates } from '../renju-rules.js';
import { reviewFrames } from '../game-review.js';
import { analyzeOpeningReview } from '../opening-review.js';
function position(rule='rif',opener=0) {
  const s=new OpeningSession({rule,workflow:'follow',initialBlackSeat:opener});
  for(const index of [112,97,96,128]) {s.apply({type:'stone',index});if(s.decision&&s.stage!=='route4')s.apply({type:'decision',choice:'keep'});}
  return s;
}
function finish(s) {while(!s.winner){const index=s.allowedMoves({safe:true})[0];assert.ok(Number.isInteger(index));s.apply({type:'stone',index});}return reviewFrames(s.record());}
function fake(probability=()=>.5,calls=[]) {
  return async o=>{calls.push(o);const points=o.allowedMoves??Array.from(o.board,(v,i)=>v?-1:i).filter(i=>i>=0),index=points[0];
    return {index,assessment:{bestIndex:index,winRate:probability(o),depth:12,mate:null},recommendations:points.slice(0,o.multiPV??1).map(index=>({index,winRate:.8,depth:12,score:20}))};};
}
function just(review,node){return {...review,openings:[node]};}
test('formal review retains a complete three-stone snapshot and one group per actual proposal set',()=>{
  for(const rule of ['rif','taraguchi10']) {
    const s=position(rule);if(s.decision)s.apply({type:'decision',choice:'ten'});
    const count=s.offerCount;for(const index of distinctCandidates(s.board,s.allowedMoves({safe:true})).slice(0,count))s.apply({type:'offer',index});
    s.apply({type:'select',index:s.candidates.at(-1)});const review=finish(s);
    const groups=review.openings.filter(o=>o.kind==='group');assert.equal(groups.length,1);assert.equal(groups[0].points.length,count);
    assert.equal(groups[0].record.events.filter(e=>e.type==='offer').length,0);assert.equal(groups[0].before.filter(Boolean).length,4);
    assert.equal(review.openings.filter(o=>o.kind==='three').length,1);assert.equal(review.moves[0].ply,6);
  }
});
test('RIF swap compares the deciding seat after two-fifth continuation for either opener',async()=>{
  for(const opener of [0,1]) {
    const s=position('rif',opener);for(const index of distinctCandidates(s.board,s.allowedMoves({safe:true})).slice(0,2))s.apply({type:'offer',index});s.apply({type:'select',index:s.candidates[0]});
    const review=finish(s),node=review.openings.find(o=>o.stage==='swap3'),before=JSON.stringify(node.record);
    const [row]=await analyzeOpeningReview(just(review,node),fake(()=>.2));assert.equal(row.choice,'swap');assert.ok(Math.abs(row.loss-.6)<1e-9);
    assert.equal(JSON.stringify(node.record),before);assert.equal(row.actor,1-opener);
  }
});
test('group review uses the weakest candidate, with equal budgets and no proposal becoming a real stone',async()=>{
  const s=position();for(const index of [223,224])s.apply({type:'offer',index});s.apply({type:'select',index:223});
  const review=finish(s),node=review.openings.find(o=>o.kind==='group'),calls=[];
  const [row]=await analyzeOpeningReview(just(review,node),fake(o=>o.board[223]===1?.95:.4,calls));
  assert.ok(Math.abs(row.afterRate-.05)<1e-9);assert.ok(Math.abs(row.beforeRate-.6)<1e-9);assert.ok(Math.abs(row.loss-.55)<1e-9);
  assert.equal(node.before.filter(Boolean).length,4);assert.ok(calls.filter(o=>o.sideToMove===2).every(o=>o.timeMs===1000));
});
test('ten selection is scored from white perspective, evaluating all actual candidates independently',async()=>{
  const s=position('taraguchi10');s.apply({type:'decision',choice:'ten'});
  for(const index of [0,1,2,3,4,5,6,7,8,9])s.apply({type:'offer',index});s.apply({type:'select',index:0});
  const review=finish(s),node=review.openings.find(o=>o.stage==='choose'),calls=[];
  const [row]=await analyzeOpeningReview(just(review,node),fake(o=>o.board[9]===1?.9:.2,calls));
  assert.equal(row.best,9);assert.ok(Math.abs(row.loss-.7)<1e-9);assert.equal(calls.length,10);assert.ok(calls.every(o=>o.sideToMove===2&&o.board.filter(Boolean).length===5&&o.rule==='taraguchi10'));
});
test('early Taraguchi exchanges are provisional, while a harmful forced ten route is compared with normal route',async()=>{
  const s=position('taraguchi10');s.apply({type:'decision',choice:'ten'});for(const index of [0,1,2,3,4,5,6,7,8,9])s.apply({type:'offer',index});s.apply({type:'select',index:0});
  const review=finish(s),node=review.openings.find(o=>o.stage==='route4');
  const [row]=await analyzeOpeningReview(just(review,node),fake(o=>o.board[9]===1?.95:.5));assert.equal(row.choice,'keep');assert.ok(Math.abs(row.loss-.45)<1e-9);
  const early=review.openings.find(o=>o.stage==='swap1');const [provisional]=await analyzeOpeningReview(just(review,early),fake(()=>.8));assert.equal(provisional.loss,null);assert.match(provisional.note,/后续仍有换色权/);
});
test('missing assessments remain unknown and cancellation emits no stale node or second search',async()=>{
  const s=position();for(const index of [223,224])s.apply({type:'offer',index});s.apply({type:'select',index:223});const review=finish(s),node=review.openings.find(o=>o.stage==='choose');
  const [unknown]=await analyzeOpeningReview(just(review,node),async o=>({index:o.board.findIndex(v=>!v)}));assert.equal(unknown.loss,null);assert.match(unknown.note,/未完成/);
  const controller=new AbortController();let calls=0,progress=0;
  await assert.rejects(analyzeOpeningReview(just(review,node),async o=>{calls++;controller.abort();return fake()(o);},{signal:controller.signal,onProgress:()=>progress++}),{name:'AbortError'});
  assert.equal(calls,1);assert.equal(progress,0);
});
