import test from "node:test";
import assert from "node:assert/strict";
import { OpeningSession } from "../opening-session.js";
import { adviseOpening } from "../opening-advisor.js";
import { candidateKey, positionSymmetries, distinctCandidates } from "../renju-rules.js";
import { searchCommands } from "../engine-protocol.js";
import { openingFlow } from "../opening-flow.js";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

function position(rule, points, stage, initialBlackSeat = 0) {
  const s = new OpeningSession({ rule, workflow: "follow", initialBlackSeat });
  for (const index of points) {
    s.apply({ type: "stone", index });
    if (s.decision && s.stage !== stage) s.apply({ type: "decision", choice: "keep" });
  }
  assert.equal(s.stage, stage); return s;
}
const ranked = (points, rates = points.map(() => .5)) => ({ index: points[0],
  assessment: { winRate: rates[0] }, recommendations: points.map((index, i) => ({ index, winRate: rates[i], depth: 12 })) });

test("Taraguchi moves offered for swapping seek balance, and ordinary play keeps its winning objective", async () => {
  for (const [points, stage] of [[[112], "w2"], [[112,96], "b3"], [[112,96,81], "w4"], [[112,96,81,83], "b5"]]) {
    const session = position("taraguchi10", points, stage), before = JSON.stringify(session.record());
    let request;
    const advice = await adviseOpening(session, async options => { request = options; return ranked([options.allowedMoves[0]]); });
    assert.equal(request.balance, true); assert.equal(request.multiPV, 1);
    assert.equal(searchCommands(request.board, request.sideToMove, request.timeMs, request.multiPV, true, request).at(-1), "YXBALANCEONE 0");
    assert.equal(session.canPoint(advice.points[0]), true); assert.equal(JSON.stringify(session.record()), before);
  }
  for (const rule of ["freestyle", "renju", "rif", "taraguchi10"]) {
    const board = new Uint8Array(225); board[112] = 1; board[97] = 2;
    const session = new OpeningSession({ rule, seed: { board, sideToMove: 1 } });
    let request;
    await adviseOpening(session, async options => { request = options; return ranked(options.allowedMoves.slice(0,2)); });
    assert.equal(request.balance, false); assert.equal(request.multiPV, 2);
  }
  const whiteSixth = position("taraguchi10", [112,96,81,83,110], "w6");
  let request;
  await adviseOpening(whiteSixth, async options => { request = options; return ranked(options.allowedMoves.slice(0,2)); });
  assert.equal(request.balance, false); assert.equal(request.sideToMove, 2);
});

test("two and ten proposals concentrate the full budget on distinct candidates and preserve a partial group", async () => {
  for (const count of [2,10]) for (const supplied of [0,1]) {
    const session = position(count === 2 ? "rif" : "taraguchi10", [112,97,96,128], count === 2 ? "offer" : "route4");
    if(count === 10) session.apply({ type: "decision", choice: "ten" });
    if(supplied) session.apply({ type: "offer", index: session.allowedMoves({ safe:true })[0] });
    const before = JSON.stringify(session.record()); let request;
    const advice = await adviseOpening(session, async options => { request = options; return ranked(options.allowedMoves.slice(0,options.multiPV)); },1000);
    assert.equal(request.multiPV, count - supplied); assert.equal(request.timeMs, 1000);
    const symmetries = positionSymmetries(session.board);
    assert.equal(new Set(request.allowedMoves.map(i => candidateKey(i,symmetries))).size, request.allowedMoves.length);
    assert.equal(distinctCandidates(session.board,[...session.candidates,...advice.points]).length,count);
    assert.equal(JSON.stringify(session.record()),before); assert.equal(session.moves.length,4);
  }
});

test("RIF fourth compares the weaker fifth, rather than trusting the most favorable single-fifth line", async () => {
  const session = position("rif",[112,97,80],"w4"), before=JSON.stringify(session.record()), requests=[];
  const advice = await adviseOpening(session, async options => {
    requests.push(options);
    if(options.sideToMove===2) return ranked([96,128,126],[.95,.6,.5]);
    const fourth=[96,128,126].find(i=>options.board[i]===2);
    const rates={96:[.9,.7],128:[.6,.4],126:[.6,.5]}[fourth];
    return ranked(options.allowedMoves.slice(0,2),rates);
  });
  assert.equal(advice.points[0],128); assert.equal(advice.blackRate,.4);
  assert.equal(JSON.stringify(session.record()),before);
  assert.ok(requests.reduce((sum,job)=>sum+job.timeMs,0)<=1000);
  assert.ok(requests.every(job=>job.multiPV===2||job.multiPV===3));
});

test("RIF swap ownership uses the opening continuation consistently for either initial seat", async () => {
  for(const initialBlackSeat of [0,1]) {
    const session=position("rif",[112,97,80],"swap3",initialBlackSeat), before=JSON.stringify(session.record());
    const advice=await adviseOpening(session,async options=>options.sideToMove===2
      ? ranked([96,128,126],[.1,.2,.3]) : ranked(options.allowedMoves.slice(0,2),[.9,.2]));
    // Plain single-fifth analysis favors black, but white can choose its 20% fifth.
    assert.equal(advice.choice,"keep"); assert.equal(JSON.stringify(session.record()),before);
    assert.equal(session.actor,1-initialBlackSeat);
  }
});

test("Taraguchi route compares all ten fifths with a swappable balanced fifth, including the weakest proposal", async () => {
  for(const tenFloor of [.75,.05]) {
    const session=position("taraguchi10",[112,97,96,160],"route4"), before=JSON.stringify(session.record()), requests=[];
    const advice=await adviseOpening(session,async options=>{
      requests.push(options);
      if(options.balance) return ranked([options.allowedMoves[0]],[.52]);
      return ranked(options.allowedMoves.slice(0,10),[...Array(9).fill(.99),tenFloor]);
    });
    assert.equal(advice.choice,tenFloor===.75?"ten":"keep");
    const flow=openingFlow(session,{advice});
    assert.equal(flow.actions.find(action=>action.value===advice.choice).suggested,true);
    if(advice.choice==="ten")assert.match(flow.note,/AI 建议提出十打/);
    assert.match(flow.note,/十打是可选路线/);
    assert.equal(JSON.stringify(session.record()),before);
    assert.ok(requests.reduce((sum,job)=>sum+job.timeMs,0)<=1000);
    assert.equal(requests[0].multiPV,10);
  }
});

test("automatic ordinary replies spend their budget on one best line while manual recommendations keep two", async () => {
  for(const rule of ["freestyle","renju","rif","taraguchi10"])for(const includeAlternative of [false,true]) {
    const board=new Uint8Array(225);board[112]=1;board[97]=2;
    const session=new OpeningSession({rule,seed:{board,sideToMove:1}});let request;
    await adviseOpening(session,async options=>{request=options;return ranked(options.allowedMoves.slice(0,options.multiPV));},5000,{includeAlternative});
    assert.equal(request.multiPV,includeAlternative?2:1);assert.equal(request.timeMs,5000);assert.equal(request.balance,false);
  }
});

test("missing individual proposal rates receive independent white evaluations and never reuse PV zero's rate", async () => {
  const session=position("rif",[112,97,80],"w4"), requests=[];
  const advice=await adviseOpening(session,async options=>{
    requests.push(options);
    if(options.board.filter(Boolean).length===3) return ranked([96]);
    if(options.sideToMove===1) return {index:options.allowedMoves[0],assessment:{winRate:.99},recommendations:options.allowedMoves.slice(0,2).map(index=>({index}))};
    return {index:0,assessment:{winRate:.8}};
  });
  assert.ok(Math.abs(advice.blackRate-.2)<1e-9);
  assert.equal(requests.filter(job=>job.sideToMove===2&&job.board.filter(Boolean).length===5).length,2);
  assert.ok(requests.reduce((sum,job)=>sum+job.timeMs,0)<=1000);
});

test("incomplete proposal batches and invalid estimates abort without changing the live opening", async () => {
  const session=position("rif",[112,97,80,96],"offer"),before=JSON.stringify(session.record());
  await assert.rejects(adviseOpening(session,async options=>({index:options.allowedMoves[0]})),/未完成整组/);
  assert.equal(JSON.stringify(session.record()),before);
  const swap=position("taraguchi10",[112,97,96,128,126],"swap5");
  for(const winRate of [NaN,Infinity,-1,2]) await assert.rejects(adviseOpening(swap,async()=>({assessment:{winRate}})),/评估尚未完成/);
});

test("cancelled hypothetical opening search propagates and cannot produce a decision or mutate stones", async () => {
  const session=position("rif",[112,97,80],"swap3"),before=JSON.stringify(session.record());let calls=0;
  await assert.rejects(adviseOpening(session,async()=>{
    if(++calls===1)return ranked([96,128,126]);
    throw new DOMException("cancelled","AbortError");
  }),{name:"AbortError"});
  assert.equal(calls,2);assert.equal(JSON.stringify(session.record()),before);
});

test("published WASM comparison matches the shipped strategy and keeps its estimates separate from match results", async () => {
  const digest=data=>createHash("sha256").update(data).digest("hex");
  const report=JSON.parse(await readFile(new URL("../reports/opening-strength-v35.json",import.meta.url),"utf8"));
  assert.equal(report.cases.length,10);
  assert.equal(report.casesSha256,digest(JSON.stringify(report.cases)));
  for(const [path,hash] of Object.entries(report.sources)) assert.equal(hash,digest(await readFile(new URL("../"+path,import.meta.url))));
  for(const budget of [1000,5000]) {
    const pair=report.cases.filter(entry=>entry.name==="taraguchi-fifth-swap"&&entry.budget===budget);
    assert.equal(pair.length,2);assert.ok(pair.find(entry=>entry.policy==="v34").utility<.25);
    assert.ok(pair.find(entry=>entry.policy==="v35").utility>.35);
  }
  for(const entry of report.cases) {
    assert.equal(entry.record.format,"gomoku-opening");
    for(const evaluation of [entry.evaluation,...(entry.fifths??[]).map(point=>point.evaluation)].filter(Boolean))
      assert.match(evaluation.weight,/mix9svqrenju_bs15_(black|white)\.bin\.lz4$/);
  }
  const pool=JSON.parse(await readFile(new URL("../reports/opening-pool-v35-recheck.json",import.meta.url),"utf8"));
  assert.equal(pool.cases.length,4);assert.equal(pool.casesSha256,digest(JSON.stringify(pool.cases)));
  assert.equal(pool.advisorImplementation,report.sources["opening-advisor.js"]);
  assert.equal(pool.recommendationsImplementation,report.sources["recommendations.js"]);
  assert.ok(pool.cases.every(entry=>entry.openerUtility>=.35));
});
