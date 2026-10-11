import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { replaySession } from '../opening-session.js';
import { moveVerdict, distinctCandidates } from '../renju-rules.js';
const digest=b=>createHash('sha256').update(b).digest('hex');
test('historical v37 WASM evidence matches frozen source, total budget, legal proposals and preserved records',async()=>{
 const r=JSON.parse(await readFile(new URL('../reports/adaptive-v37.json',import.meta.url)));
 assert.equal(r.budgetMs,6000);assert.equal(r.cases.length,13);
 for(const [path,expected]of Object.entries({...r.sources,...r.assets})){
  let bytes=await readFile(new URL('../'+path,import.meta.url));
  if(['adaptive-search.js','adaptive-opening.js'].includes(path)) {
   const frozen=await readFile(new URL('../scripts/'+path.replace('.js','-v37.fixture.js'),import.meta.url),'utf8');
   bytes=Buffer.from(frozen.replaceAll('from "../','from "./').replace('from "./adaptive-search-v37.fixture.js"','from "./adaptive-search.js"'));
  }
  if(path==='scripts/adaptive-eval.js')bytes=await readFile(new URL('./fixtures/adaptive-eval-v37.txt',import.meta.url));
  assert.equal(digest(bytes),expected,path);
 }
 for(const c of r.cases){if(c.kind==='fixed')continue;
  assert.equal(c.result.adaptive.budgetMs,6000);if(c.kind==='shortcut'){assert.equal(c.result.adaptive.searches,0);assert.equal(c.result.index,4);continue;}
  assert.ok(c.wallMs<6500);const s=replaySession(c.record);
  if(c.kind==='ordinary'){assert.ok(s.canPoint(c.result.index));assert.equal(moveVerdict(s.board,c.result.index,s.color,s.rule).forbidden,'');}
  if(c.result.points){assert.ok(c.result.points.every(i=>s.canPoint(i)));if(s.offerCount){assert.equal(c.result.points.length,s.offerCount-s.candidates.length);assert.equal(distinctCandidates(s.board,[...s.candidates,...c.result.points]).length,s.candidates.length+c.result.points.length);}}
  assert.equal(c.searches.length,c.result.adaptive.searches);
 }
 assert.equal(r.cases.find(c=>c.name==='negative-route').result.choice,'keep');
});
test('v39 native validation matches shipped sources and covers Taraguchi swap and continuations',async()=>{
 const r=JSON.parse(await readFile(new URL('../reports/adaptive-v39.json',import.meta.url)));
 assert.equal(r.budgetMs,6000);assert.equal(r.cases.length,17);
 for(const [path,expected]of Object.entries({...r.sources,...r.assets}))assert.equal(digest(await readFile(new URL('../'+path,import.meta.url))),expected,path);
 for(const c of r.cases){if(c.kind==='fixed')continue;
  assert.equal(c.result.adaptive.budgetMs,6000);
  if(c.kind==='shortcut'){assert.equal(c.result.adaptive.searches,0);continue;}
  assert.ok(c.wallMs<6500);const s=replaySession(c.record);
  assert.equal(c.searches.length,c.result.adaptive.searches);
  if(c.kind==='ordinary'){assert.ok(s.canPoint(c.result.index));assert.ok(c.searches.every(q=>q.root));assert.equal(c.result.adaptive.strategy,'root-continuation');}
  if(c.result.points){assert.ok(c.result.points.every(i=>s.canPoint(i)));if(s.offerCount)assert.equal(distinctCandidates(s.board,[...s.candidates,...c.result.points]).length,s.offerCount);}
 }
 assert.notEqual(r.cases.find(c=>c.name==='negative-route').result.choice,'ten');
 for(const stage of ['swap3','w4','b5','swap5'])assert.ok(r.cases.some(c=>c.name==='taraguchi-'+stage));
});
