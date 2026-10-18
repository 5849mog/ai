import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createDevServer } from "./dev-server.js";
import { OpeningSession, replaySession } from "../opening-session.js";
import { createRecord, exportSgf } from "../game-record.js";
import { parseSessionRecord } from "../session-records.js";
import { APP_VERSION } from "../app-release.js";
const engine = `export class GomokuEngine {
 constructor(options){Object.assign(this,options);this.ready=false;window.flowJobs=[];}
 async init(){this.ready=true;this.onState({state:'ready'});} cancel(){} stopPonder(){} reset(){this.ready=false;}
 async ponder(){}
 async search(o){window.flowJobs.push(o);this.onState({state:'thinking'});await new Promise(r=>setTimeout(r,30));
  const a=o.allowedMoves||o.board.flatMap((v,i)=>v?[]:[i]),index=a.includes(113)?113:a[0];
  this.onState({state:'ready'});return {index,requestId:o.requestId,assessment:{winRate:.55},recommendations:a.slice(0,o.multiPV||1).map(index=>({index}))};}
}`;
const server=await createDevServer({port:0,isolated:false}),base=`http://127.0.0.1:${server.address().port}/ai/`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:JSON.parse(process.env.CHROME_ARGS||'[]')});
const report={version:APP_VERSION,method:"Actual pages and touch input; deterministic engine for navigation and storage checks",checks:[],layouts:[]},errors=[];
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
await context.route(/\/engine\.js(?:\?.*)?$/,r=>r.fulfill({contentType:'text/javascript',body:engine}));
await context.addInitScript(()=>{localStorage.setItem('gomoku-pondering','false');localStorage.setItem('gomoku-thinking-ms','1000');});
page.on('pageerror',e=>errors.push(e.message));
const record=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gomoku-opening:/ai/:v1')).record);
const game=async()=>replaySession(await record());
const flow=(action,value)=>page.locator(`#simpleOpeningFlow [data-flow-action="${action}"]${value===undefined?'':`[data-value="${value}"]`}`);
const settle=()=>page.evaluate(()=>new Promise(resolve=>{let n=0;const f=()=>++n===5?resolve():requestAnimationFrame(f);requestAnimationFrame(f);}));
async function tap(index){const p=page.locator(`#boardSvg [data-index="${index}"]`);await p.tap();await p.tap();}
async function settings(rule,workflow){await page.locator('#simpleColor').tap();await page.locator('#ruleMode').selectOption(rule);await page.locator('#workflowMode').selectOption(workflow);await page.locator('#startMode').tap();await flow('start').first().waitFor();}
async function importFile(name,text){await page.locator('#recordFile').setInputFiles({name,mimeType:name.endsWith('sgf')?'application/x-go-sgf':'application/json',buffer:Buffer.from(text)});await page.locator('#recordDialog').waitFor();}
try{
 await mkdir('.cache/navigation',{recursive:true});
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#boardSvg').getAttribute('aria-disabled')==='false');
 assert.equal(await page.locator('.mode-link').count(),0);await page.locator('#recordMenu summary').tap();await page.locator('#enterSimpleMode').tap();
 assert.deepEqual(await page.locator('#simpleControls > button > span:first-of-type').allTextContents(),['新局','对局','悔棋','推荐']);
 await tap(112);await page.waitForFunction(()=>document.querySelectorAll('#boardSvg [data-stone]').length===2);
 const current=await record();
 await page.locator('#simpleColor').tap();await page.locator('#ruleMode').selectOption('taraguchi10');await page.locator('#workflowMode').selectOption('follow');await page.locator('#modeDialog [data-close]').tap();
 assert.deepEqual(await record(),current);pass('Home enters the complete simple view directly; settings are an isolated draft');
 await page.goto(base+'renju.html?view=simple');await flow('start').count();assert.deepEqual(await record(),current);
 await page.goto(base+'?view=simple');assert.deepEqual(await record(),current);pass('Home and old Renju URL resume the same current game');
 await settings('taraguchi10','follow');await flow('start',0).tap();await tap(112);await flow('decision','keep').tap();
 assert.equal((await game()).stage,'w2');await page.locator('#simpleRestart').tap();assert.equal((await game()).workflow,'follow');assert.equal((await game()).stage,'setup');
 await page.locator('#simpleRestart').dispatchEvent('contextmenu');assert.ok(await page.locator('body').evaluate(n=>n.classList.contains('simple-mode')));
 pass('New preserves rule and workflow; there is no long-press display switch');
 await settings('freestyle','copilot');await flow('start',1).tap();await tap(112);await flow('handoff').tap();
 await page.waitForFunction(()=>document.querySelectorAll('#boardSvg [data-stone]').length===2);assert.equal((await game()).playerColor,2);assert.equal((await game()).events.at(-1).automatic,true);
 pass('All workflows are available from Home; external-game handoff automatically answers with the correct color');await page.screenshot({path:'.cache/navigation/simple.png'});
 const partial=new OpeningSession({rule:'rif',workflow:'follow',initialBlackSeat:0});for(const index of [112,97,96])partial.apply({type:'stone',index});partial.apply({type:'decision',choice:'keep'});partial.apply({type:'stone',index:0});partial.apply({type:'offer',index:1});
 const beforeImport=await record();await importFile('opening.json',JSON.stringify(partial.record()));assert.deepEqual(await record(),beforeImport);await page.locator('#cancelImport').tap();assert.deepEqual(await record(),beforeImport);
 await importFile('opening.json',JSON.stringify(partial.record()));await page.locator('#confirmImport').tap();assert.deepEqual(await record(),partial.record());pass('Formal JSON import previews before confirmation and preserves partial proposals');
 await page.locator('[aria-controls="simpleQuickTools"]').tap();await page.getByRole('button',{name:'自定义摆局',exact:true}).tap();assert.equal(await page.locator('#setupActor').isVisible(),false);await page.locator('#cancelSetup').tap();assert.deepEqual(await record(),partial.record());
 await page.locator('[aria-controls="simpleQuickTools"]').tap();await page.locator('[data-image]').tap();assert.equal(await page.locator('[data-actor]').isVisible(),false);await page.getByRole('button',{name:'返回原局',exact:true}).tap();assert.deepEqual(await record(),partial.record());
 pass('Manual recording offers no misleading AI actor in custom setup or image import');
 for(const [width,height]of [[260,420],[320,240],[390,844],[844,390],[820,1180],[1440,900]]){
  await page.setViewportSize({width,height});await settle();const before=await page.locator('.board-frame').first().boundingBox();
  await page.locator('[aria-controls="simpleQuickTools"]').tap();await settle();const after=await page.locator('.board-frame').first().boundingBox();assert.deepEqual(after,before);
  const b=await page.locator('#simpleQuickTools').boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=width+.5&&b.y+b.height<=height+.5);if(width===390)await page.screenshot({path:'.cache/navigation/more.png'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#simpleQuickTools').isVisible(),false);assert.ok(await page.locator('body').evaluate(n=>n.classList.contains('simple-mode')));
  report.layouts.push({width,height,boardSide:before.width,morePreservesBoard:true});
 }
 pass('More overlays temporarily without resizing the board; Escape closes one level at a time');
 await page.setViewportSize({width:390,height:844});const unchanged=await record();await page.locator('[aria-controls="simpleQuickTools"]').tap();await page.locator('[data-full-view]').tap();await page.waitForFunction(()=>!document.body.classList.contains('simple-mode'));assert.deepEqual(await record(),unchanged);
 await page.locator('#recordMenu summary').tap();await page.locator('#enterSimpleMode').tap();assert.deepEqual(await record(),unchanged);pass('Explicit full/simple controls preserve the exact game');
 const old=createRecord([112,97],1);await importFile('old.json',JSON.stringify(old));assert.ok(await page.locator('#importColor').isVisible());await page.locator('#confirmImport').tap();assert.deepEqual((await game()).moves,old.moves);assert.equal((await game()).workflow,'duel');
 await importFile('old.sgf',exportSgf(old));await page.locator('#confirmImport').tap();assert.deepEqual((await game()).moves,old.moves);pass('Old freestyle JSON and SGF remain importable in the same interface');
 await page.locator('[aria-controls="simpleQuickTools"]').tap();await page.locator('[data-full-view]').tap();await page.waitForFunction(()=>!document.body.classList.contains('simple-mode'));
 for(const [selector,name]of [['#exportJson','json'],['#exportSgf','sgf']]){await page.locator('#recordMenu summary').tap();const [download]=await Promise.all([page.waitForEvent('download'),page.locator(selector).tap()]);const parsed=parseSessionRecord(await readFile(await download.path(),'utf8'));assert.deepEqual(parsed.session.board,(await game()).board);}
 pass('JSON and SGF downloads contain the current actual position');
 for(const latest of ['freestyle','opening']){
  const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});await ctx.route(/\/engine\.js(?:\?.*)?$/,r=>r.fulfill({contentType:'text/javascript',body:engine}));
  await ctx.addInitScript(({old,record,latest})=>{if(sessionStorage.getItem('migration-seeded'))return;sessionStorage.setItem('migration-seeded','1');localStorage.setItem('gomoku-game:/ai/:v1',JSON.stringify(old));localStorage.setItem('gomoku-opening:/ai/:v1',JSON.stringify({record,perspective:1}));localStorage.setItem('gomoku-archive:/ai/:v1',JSON.stringify({version:1,entries:[{id:'old',createdAt:1,updatedAt:latest==='freestyle'?20:10,record:old},{id:'formal',createdAt:1,updatedAt:latest==='opening'?20:10,record}]}));localStorage.setItem('gomoku-archive:/ai/:v1:active:opening','formal');localStorage.setItem('gomoku-archive:/ai/:v1:active:freestyle','old');localStorage.setItem('gomoku-pondering','false');},{old,record:partial.record(),latest});
  const p=await ctx.newPage();await p.goto(base+'?view=simple');await p.locator('#simpleColor').waitFor();
  const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('gomoku-opening:/ai/:v1')));assert.equal(saved.unified,true);assert.equal(saved.record.rule,latest==='freestyle'?'freestyle':'rif');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('gomoku-archive:/ai/:v1')).entries.length),2);
  assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('gomoku-game:/ai/:v1'))),old);
  await p.locator('#simpleRestart').tap();await p.reload();assert.equal(await p.locator('#boardSvg').getAttribute('data-stage'),'setup');
  await p.goto(base+'renju.html?view=simple');assert.equal(await p.locator('#boardSvg').getAttribute('data-stage'),'setup');await ctx.close();
 }
 pass('First upgrade chooses the most recent old game, retains original data, and New remains selected across both URLs');
 assert.deepEqual(errors,[]);report.passed=true;report.completedAt=new Date().toISOString();await writeFile('.cache/navigation/result.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:true,checks:report.checks.length,layouts:report.layouts.length}));
}catch(e){await page.screenshot({path:'.cache/navigation/failure.png'});throw e;}
finally{await browser.close();await new Promise(r=>server.close(r));}
