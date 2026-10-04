import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createDevServer } from './dev-server.js';
import { createRecord, serializeRecord } from '../game-record.js';
const server=await createDevServer({port:0}), origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),...(process.env.CHROME_ARGS?{args:JSON.parse(process.env.CHROME_ARGS)}:{})});
const report={startedAt:new Date().toISOString(),browser:browser.version(),checks:[],runtime:'Real Rapfi WASM plus deterministic protocol fixture for cancellation and branch tests'};
const fixture=await readFile('tests/fixtures/rapfi-protocol-double.js','utf8');
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
const ready=page=>page.waitForFunction(()=>document.querySelector('#stateText').textContent==='轮到你落子');
const rate=page=>page.locator('#playerWinRate').innerText();
const points=page=>page.locator('#positionAnalysis').getAttribute('data-points');
const count=page=>page.locator('#boardSvg [data-stone]').count();
const snapshot=page=>page.evaluate(()=>({rate:document.querySelector('#playerWinRate').textContent,judgement:document.querySelector('#positionJudgement').textContent,ply:document.querySelector('#positionAnalysis').dataset.ply,points:document.querySelector('#positionAnalysis').dataset.points,curve:document.querySelector('#trendData').innerHTML}));
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem(`gomoku-analysis:${location.pathname}:v1`)));
const input=async(page,moves,color=1)=>{
 await page.locator('#recordFile').setInputFiles({name:'analysis.json',mimeType:'application/json',buffer:Buffer.from(serializeRecord(createRecord(moves,color)))});
 await page.locator('#recordDialog').waitFor({state:'visible'});
};
try{
 for(const prefix of ['plain','ai']){
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await ctx.route('**/engine/rapfi-250615/rapfi-*.js',route=>route.fulfill({contentType:'text/javascript',body:fixture}));
  await ctx.addInitScript(()=>{
   if(!localStorage.getItem('analysis-qa-initialized')){
    localStorage.setItem('analysis-qa-initialized','1');localStorage.setItem('gomoku-thinking-ms','1000');
    localStorage.setItem(`gomoku-game:${location.pathname}:v1`,JSON.stringify({format:'gomoku-studio',version:1,size:15,rule:'freestyle',playerColor:1,moves:[112,113]}));
   }
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/${prefix}/`);await ready(page);
  await page.waitForFunction(()=>document.querySelector('#playerWinRate').textContent==='80%');
  await page.locator('#ponderToggle').uncheck();await page.waitForTimeout(650);
  assert.equal(await points(page),'1');assert.equal((await saved(page)).points[0].ply,2);
  const initial=await snapshot(page);
  await page.locator('[data-index="97"]').tap();assert.equal(await count(page),2);
  await page.locator('#undoButton').tap();assert.deepEqual(await snapshot(page),initial);
  pass(`${prefix}: repeated ponder replaces one point; cancelling a pending touch leaves all three indicators unchanged`);
  await page.locator('[data-index="97"]').tap();await page.locator('[data-index="97"]').tap();await ready(page);
  assert.equal(await count(page),4);assert.equal(await rate(page),'20%');assert.equal(await points(page),'3');
  let history=await saved(page);assert.deepEqual(history.points.map(p=>p.ply),[2,3,4]);
  assert.equal(history.points.at(-1).kind,'continuation');
  await page.locator('#undoButton').tap();await ready(page);assert.deepEqual(await snapshot(page),initial);
  await page.locator('[data-index="98"]').tap();await page.locator('[data-index="98"]').tap();await ready(page);
  history=await saved(page);assert.equal(history.moves[2],98);assert.deepEqual(history.points.map(p=>p.ply),[2,3,4]);
  const branch=await snapshot(page);
  await page.reload();await ready(page);assert.deepEqual(await snapshot(page),branch);
  pass(`${prefix}: actual AI move carries the matching PV, undo truncates future points, a new branch and reload preserve the correct history`);
  await page.locator('#recommendButton').tap();await ready(page);
  assert.equal(await rate(page),'80%');assert.equal(await count(page),4);assert.equal(await points(page),'3');
  assert.equal(await page.locator('[data-recommendation]').count(),2);
  await page.locator('#recommendButton').tap();
  const beforePreview=await snapshot(page);await input(page,[112,113]);
  await page.locator('#cancelImport').tap();assert.deepEqual(await snapshot(page),beforePreview);
  await input(page,[112,113]);await page.locator('#confirmImport').tap();await ready(page);
  assert.equal(await points(page),'0');assert.equal(await rate(page),'—');
  assert.equal(await page.locator('#winRateBar').getAttribute('aria-valuenow'),null);
  pass(`${prefix}: MultiPV second candidate cannot overwrite win rate; import preview/cancel preserves history and confirmed import clears it`);
  await page.locator('[data-index="97"]').tap();await page.locator('[data-index="97"]').tap();
  await page.locator('#undoButton').tap();await ready(page);await page.waitForTimeout(450);
  assert.equal(await count(page),2);assert.equal(await points(page),'0');assert.equal(await rate(page),'—');
  await page.locator('[data-index="98"]').tap();await page.locator('[data-index="98"]').tap();
  await page.locator('#restartButton').tap();await ready(page);await page.waitForTimeout(450);
  assert.equal(await count(page),0);assert.equal(await points(page),'0');assert.equal(await rate(page),'—');
  await page.locator('#colorSelect').selectOption('2');await ready(page);
  await page.locator('#ponderToggle').check();await page.waitForFunction(()=>document.querySelector('#playerWinRate').textContent==='80%');
  await page.locator('#ponderToggle').uncheck();
  assert.equal(await count(page),1);
  pass(`${prefix}: undo/restart during foreground search discard late results; white-side analysis keeps the player's viewpoint`);
  await input(page,[0,30,1,32,2,34,3,36,4]);await page.locator('#confirmImport').tap();
  assert.equal(await rate(page),'100%');assert.match(await page.locator('#positionJudgement').innerText(),/你赢了/);
  assert.equal(await page.locator('#winRateCaption').innerText(),'最终结果');
  await page.locator('#undoButton').tap();await ready(page);assert.equal(await rate(page),'—');
  assert.deepEqual((await saved(page)).points,[]);
  pass(`${prefix}: imported terminal result overrides estimates, terminal undo removes the result point`);
  assert.deepEqual(errors,[]);await ctx.close();
 }
 const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'block'});
 await ctx.addInitScript(()=>{
  localStorage.setItem('gomoku-thinking-ms','1000');localStorage.setItem('gomoku-pondering','false');
  const NativeWorker=window.Worker;window.nativeAssessments=[];
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.stats?.assessment)window.nativeAssessments.push({requestId:data.requestId,sideToMove:data.sideToMove,assessment:data.stats.assessment});});}
  };
 });
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/plain/`);await ready(page);assert.equal(await rate(page),'—');
 for(let turn=0;turn<6;turn++){
  await page.locator('#recommendButton').tap();await ready(page);
  const marker=page.locator('[data-rank="1"]');
  if(!await marker.count())break;
  const index=await marker.getAttribute('data-recommendation');
  await page.locator(`[data-index="${index}"]`).tap();await page.locator(`[data-index="${index}"]`).tap();
  await page.waitForFunction(()=>['轮到你落子','你赢了','AI 获胜','平局'].includes(document.querySelector('#stateText').textContent));
  if(await page.locator('#stateText').innerText()!=='轮到你落子')break;
 }
 const native=await page.evaluate(()=>nativeAssessments);
 assert.ok(native.length>0,'Actual WASM must emit paired native WINRATE frames');
 assert.ok(native.every(e=>e.assessment.winRate>=0&&e.assessment.winRate<=1));
 assert.ok(Number(await points(page))>=4);
 await page.evaluate(()=>document.fonts.ready);await page.locator('#boardSvg').evaluate(el=>el.blur());
 await page.screenshot({path:'reports/position-game-390.jpg',type:'jpeg',quality:90,fullPage:true});
 report.native={assessments:native.length,points:Number(await points(page)),last:await snapshot(page)};
 pass('real Rapfi single-thread WASM: native WINRATE frames, completed MultiPV assessment and a full chronological trend over live UI play');
 assert.deepEqual(errors,[]);await ctx.close();
 await mkdir('.cache/position-analysis',{recursive:true});report.completedAt=new Date().toISOString();report.passed=true;
 await writeFile('.cache/position-analysis/interactions.json',JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
