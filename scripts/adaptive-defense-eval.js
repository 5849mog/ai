// Frozen v37 vs current, with independent same-budget reply evaluations.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRenjuNodeEngine } from "./renju-node-engine.js";
import { thinkAdaptive } from "../adaptive-search.js";
import { thinkAdaptive as legacyThink } from "./adaptive-search-v37.fixture.js";
import { adviseAdaptiveOpening } from "../adaptive-opening.js";
import { adviseAdaptiveOpening as legacyOpening } from "./adaptive-opening-v37.fixture.js";
import { replaySession } from "../opening-session.js";
import { moveVerdict } from "../renju-rules.js";
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const output=process.argv[2]??"reports/adaptive-defense-v39.json";
const source=JSON.parse(await readFile(new URL("../reports/formal-modes-v35.json",import.meta.url)));
const report={version:1,started:new Date().toISOString(),runtime:process.version,budgetMs:6000,replyBudgetMs:5000,
  method:"Same frozen positions, cleared hash before each v37/current decision and each independent opponent search. Reply estimates are diagnostics, not human win rates or a match result.",sources:{},cases:[]};
for(const path of ["adaptive-search.js","adaptive-opening.js","scripts/adaptive-search-v37.fixture.js","scripts/adaptive-opening-v37.fixture.js","scripts/adaptive-defense-eval.js"])
  report.sources[path]=digest(await readFile(new URL("../"+path,import.meta.url)));
const e=await createRenjuNodeEngine();await e.search({board:new Uint8Array(225),sideToMove:1,timeMs:100,allowSetup:true});
const save=()=>writeFile(output,JSON.stringify(report,null,2)+"\n");
for(const name of ["rif-seat0-keep","taraguchi-seat0-normal-mixed"]) {
  const s=replaySession(source.cases.find(c=>c.name===name).record);
  for(const [policy,think] of [["v37",legacyThink],["v39",thinkAdaptive]]) {
    e.clear();const result=await think({board:s.board,sideToMove:s.color,rule:s.rule,allowSetup:true,
      allowedMoves:s.allowedMoves({safe:true})},o=>e.search(o));
    assert.equal(moveVerdict(s.board,result.index,s.color,s.rule).forbidden,"");
    const next=s.board.slice();next[result.index]=s.color;e.clear();
    const reply=await e.search({board:next,sideToMove:3-s.color,timeMs:5000,allowSetup:true});
    const rate=reply.assessment?.winRate;
    assert.ok(Number.isFinite(rate));
    const entry={name,kind:"ordinary",policy,record:s.record(),result,reply,moverRate:1-rate};
    report.cases.push(entry);await save();console.log(name,policy,result.index,result.adaptive.status,entry.moverRate);
  }
}
const sourceRecord=source.cases.find(c=>c.name==="taraguchi-seat0-normal-mixed").record;
for(const [policy,advise] of [["v37",legacyOpening],["v39",adviseAdaptiveOpening]]) {
  const s=replaySession({...sourceRecord,events:[]});for(const event of sourceRecord.events){if(s.stage==="b5")break;s.apply(event);}
  assert.equal(s.stage,"b5");e.clear();const result=await advise(s,o=>e.search(o));
  assert.ok(s.canPoint(result.points[0]));const before=s.record();s.apply({type:"stone",index:result.points[0]});e.clear();
  const reply=await e.search({board:s.board,sideToMove:2,timeMs:5000,allowSetup:true});
  const rate=reply.assessment?.winRate;assert.ok(Number.isFinite(rate));
  const entry={name:"taraguchi-b5",kind:"opening",policy,record:before,result,reply,swapFloor:Math.min(rate,1-rate)};
  report.cases.push(entry);await save();console.log(entry.name,policy,result.points[0],entry.swapFloor);
}
report.finished=new Date().toISOString();await save();
