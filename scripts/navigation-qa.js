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
const quick=page.locator('[aria-controls="simpleQuickTools"]'), panel=page.locator('#simpleQuickTools');
const tab=key=>panel.locator(`[data-quick-tab="${key}"]`);
async function openTools() { await quick.tap(); await tab('tools').tap(); }
const settle=()=>page.evaluate(()=>new Promise(resolve=>{let n=0;const f=()=>++n===5?resolve():requestAnimationFrame(f);requestAnimationFrame(f);}));
async function tap(index){const p=page.locator(`#boardSvg [data-index="${index}"]`);await p.tap();await p.tap();}
async function settings(rule,workflow){await page.locator('#simpleColor').tap();await page.locator('#ruleMode').selectOption(rule);await page.locator('#workflowMode').selectOption(workflow);await page.locator('#startMode').tap();await flow('start').first().waitFor();}
async function importFile(name,text){await page.locator('#recordFile').setInputFiles({name,mimeType:name.endsWith('sgf')?'application/x-go-sgf':'application/json',buffer:Buffer.from(text)});await page.locator('#recordDialog').waitFor();}
try{
 await mkdir('.cache/navigation',{recursive:true});
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#boardSvg').getAttribute('aria-disabled')==='false');
 assert.equal(await page.locator('.mode-link').count(),0);await page.locator('#recordMenu summary').tap();await page.locator('#enterSimpleMode').tap();
 assert.deepEqual(await page.locator('#simpleControls > button > span:first-of-type').allTextContents(),['新局','对局','悔棋','推荐']);
 const board=page.locator('#boardSvg'),cursor=board.locator('[data-keyboard-point]'),preview=board.locator('.pending-stone');
 await board.press('ArrowLeft');assert.equal(await cursor.getAttribute('data-keyboard-point'),'111');
 await board.press('Home');assert.equal(await cursor.getAttribute('data-keyboard-point'),'112');
 await board.press('r');await page.getByRole('button',{name:'收起推荐',exact:true}).waitFor();
 await board.press('r');assert.equal(await board.locator('[data-recommendation]').count(),0);
 await board.locator('[data-index="112"]').tap();await preview.waitFor();
 for(const selector of ['#stateText','#simpleOpeningFlow h2','#openingFlow h2']) assert.match(await page.locator(selector).textContent(),/再点一次确认 · H8/);
 await page.keyboard.press('Escape');assert.equal(await preview.count(),0);
 assert.doesNotMatch(await page.locator('#simpleOpeningFlow h2').textContent(),/再点一次确认/);
 assert.equal(await page.locator('body.simple-mode').count(),1);
 await tap(112);await page.waitForFunction(()=>document.querySelectorAll('#boardSvg [data-stone]').length===2);
 await board.press('Home');assert.equal(await cursor.getAttribute('data-available'),'false');
 assert.match(await board.getAttribute('aria-label'),/H8，此处不可选/);
 await board.locator('[data-index="97"]').tap();await preview.waitFor();
 const stone=await board.locator('[data-stone="112"]').boundingBox();
 await page.touchscreen.tap(stone.x+stone.width/2,stone.y+stone.height/2);assert.equal(await preview.count(),0);
 await board.locator('[data-index="97"]').tap();await preview.waitFor();assert.equal((await game()).moves.length,2);
 await page.keyboard.press('Escape');assert.equal(await preview.count(),0);
 pass('Touch previews identify the point and cancel safely; board keyboard cursor, Home and R work');
 const current=await record();
 await page.locator('#simpleColor').tap();await page.locator('#ruleMode').selectOption('taraguchi10');await page.locator('#workflowMode').selectOption('follow');await page.locator('#modeDialog [data-close]').tap();
 assert.deepEqual(await record(),current);pass('Home enters the complete simple view directly; settings are an isolated draft');
 await page.goto(base+'renju.html?view=simple');await flow('start').count();assert.deepEqual(await record(),current);
 await page.goto(base+'?view=simple');assert.deepEqual(await record(),current);pass('Home and old Renju URL resume the same current game');
 await settings('taraguchi10','follow');await flow('start',0).press('Enter');
 assert.equal(await board.evaluate(node=>node===document.activeElement),true);
 assert.equal((await game()).moves[0],112);assert.equal((await game()).events.at(-1).automatic,true);
 await flow('decision','keep').tap();
 assert.equal((await game()).stage,'w2');await page.locator('#simpleRestart').tap();assert.equal((await game()).workflow,'follow');assert.equal((await game()).stage,'setup');
 await page.locator('#simpleRestart').dispatchEvent('contextmenu');assert.ok(await page.locator('body').evaluate(n=>n.classList.contains('simple-mode')));
 pass('New preserves rule and workflow; there is no long-press display switch');
 await settings('freestyle','copilot');await flow('start',1).tap();await tap(112);await flow('handoff').tap();
 await page.waitForFunction(()=>document.querySelectorAll('#boardSvg [data-stone]').length===2);assert.equal((await game()).playerColor,2);assert.equal((await game()).events.at(-1).automatic,true);
 pass('All workflows are available from Home; external-game handoff automatically answers with the correct color');await page.screenshot({path:'.cache/navigation/simple.png'});
 const partial=new OpeningSession({rule:'rif',workflow:'follow',initialBlackSeat:0});for(const index of [112,97,96])partial.apply({type:'stone',index});partial.apply({type:'decision',choice:'keep'});partial.apply({type:'stone',index:0});partial.apply({type:'offer',index:1});
 const beforeImport=await record();await importFile('opening.json',JSON.stringify(partial.record()));assert.deepEqual(await record(),beforeImport);await page.locator('#cancelImport').tap();assert.deepEqual(await record(),beforeImport);
 await importFile('opening.json',JSON.stringify(partial.record()));await page.locator('#confirmImport').tap();assert.deepEqual(await record(),partial.record());pass('Formal JSON import previews before confirmation and preserves partial proposals');
 await openTools();await page.getByRole('button',{name:'自定义摆局',exact:true}).tap();assert.equal(await page.locator('#setupActor').isVisible(),false);await page.locator('#cancelSetup').tap();assert.deepEqual(await record(),partial.record());
 await openTools();await page.getByRole('button',{name:'自定义摆局',exact:true}).tap();
 const setup=page.locator('#setupBoard');
 await setup.press('Home');await setup.press('2');await setup.press('Enter');
 assert.equal(await setup.locator('[data-keyboard-point="112"]').count(),1);assert.match(await setup.getAttribute('aria-label'),/摆白棋.*H8/);
 await page.locator('#clearSetup').tap();assert.equal(await page.locator('#clearSetup').isDisabled(),true);
 await page.locator('#cancelSetup').tap();assert.equal(await quick.evaluate(button=>button===document.activeElement),true);
 assert.deepEqual(await record(),partial.record());
 const screenshot=await board.screenshot();
 await openTools();await panel.locator('[data-image]').tap();
 await page.locator('.image-picker input[accept^="image/"]').setInputFiles({name:'board.png',mimeType:'',buffer:screenshot});
 const frame=page.locator('.import-image'), correction=page.locator('.import-board');
 await frame.waitFor();await frame.press('Shift+ArrowLeft');await frame.press('Home');
 await page.locator('[data-recognize]').tap();assert.equal(await correction.evaluate(node=>node===document.activeElement),true);
 await correction.press('ArrowLeft');await correction.press('Home');assert.equal(await correction.locator('[data-keyboard-point="112"]').count(),1);
 await page.locator('[data-recalibrate]').tap();assert.equal(await frame.evaluate(node=>node===document.activeElement),true);
 await page.getByRole('button',{name:'返回原局',exact:true}).tap();assert.deepEqual(await record(),partial.record());
 pass('Setup and screenshot calibration support keyboard editing and restore focus without replacing the board');
 await openTools();await panel.locator('[data-image]').tap();assert.equal(await page.locator('[data-actor]').isVisible(),false);await page.getByRole('button',{name:'返回原局',exact:true}).tap();assert.deepEqual(await record(),partial.record());
 assert.equal(await page.locator('[aria-controls="simpleQuickTools"]').evaluate(node=>node===document.activeElement),true);
 pass('Manual recording offers no misleading AI actor in custom setup or image import');
 await page.locator('.simple-notice').waitFor({state:'hidden'});
 for(const [width,height]of [[260,420],[320,240],[390,844],[844,390],[820,1180],[1440,900]]){
  await page.setViewportSize({width,height});await settle();const before=await page.locator('.board-frame').first().boundingBox();
  await page.locator('[aria-controls="simpleQuickTools"]').tap();await settle();const after=await page.locator('.board-frame').first().boundingBox();assert.deepEqual(after,before);
  const b=await page.locator('#simpleQuickTools').boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=width+.5&&b.y+b.height<=height+.5);if(width===390)await page.screenshot({path:'.cache/navigation/more.png'});
  if(width<=380){
   await tab('tools').tap();const columns=await page.locator('.quick-tools-actions').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);assert.equal(columns,2);
   await panel.locator('.quick-tools-body').evaluate(node=>{node.scrollTop=node.scrollHeight;});
   const close=await page.locator('#simpleQuickTools [data-collapse]').boundingBox();assert.ok(close.y>=b.y&&close.y+close.height<=b.y+b.height);
  }
  await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.ok(await page.locator('body').evaluate(n=>n.classList.contains('simple-mode')));
  report.layouts.push({width,height,boardSide:before.width,morePreservesBoard:true});
 }
 pass('More overlays temporarily without resizing the board; Escape closes one level at a time');
 const more=quick,closeQuick=panel.locator('[data-collapse]');
 await more.focus();await page.keyboard.press('Enter');assert.equal(await closeQuick.evaluate(button=>button===document.activeElement),true);
 await page.keyboard.press('Enter');assert.equal(await more.getAttribute('aria-expanded'),'false');assert.equal(await more.evaluate(button=>button===document.activeElement),true);
 await more.press('Enter');await page.locator('#simpleRestart').focus();assert.equal(await more.getAttribute('aria-expanded'),'false');
 pass('Quick settings move keyboard focus on open, restore it on close, and dismiss when focus moves away');
 await page.setViewportSize({width:390,height:844});await quick.tap();await tab('game').tap();
 await panel.locator('[data-time="3000"]').tap();assert.equal(await panel.locator('[data-time="3000"]').getAttribute('aria-checked'),'true');
 await panel.locator('[data-time="3000"]').press('ArrowRight');assert.equal(await panel.locator('[data-time="5000"]').getAttribute('aria-checked'),'true');
 await panel.locator('[data-hints]').tap();await panel.locator('[data-ponder]').tap();
 assert.equal(await quick.getAttribute('aria-expanded'),'true');
 await tab('game').press('ArrowRight');await panel.locator('[data-appearance="coordinates"]').check();
 assert.equal(await board.getAttribute('data-coordinates'),'true');
 await tab('board').press('End');assert.equal(await tab('tools').getAttribute('aria-selected'),'true');
 const openNotes=panel.locator('[data-notes-toggle]');await openNotes.tap();
 assert.equal(await panel.locator('.release-notes-panel').isVisible(),true);
 await page.keyboard.press('Escape');assert.equal(await openNotes.evaluate(node=>document.activeElement===node),true);
 assert.equal(await quick.getAttribute('aria-expanded'),'true');
 const unchangedByDismiss=await record(), rect=await board.boundingBox();
 await page.touchscreen.tap(rect.x+rect.width/2,rect.y+6);
 await panel.waitFor({state:'hidden'});assert.deepEqual(await record(),unchangedByDismiss);
 assert.equal(await board.locator('.pending-stone').count(),0);
 pass('Tabs, switches and radio keys update in-place; the notes reader returns to tools and outside taps cannot place stones');
 await page.setViewportSize({width:390,height:844});const unchanged=await record();await openTools();await panel.locator('[data-full-view]').tap();await page.waitForFunction(()=>!document.body.classList.contains('simple-mode'));assert.deepEqual(await record(),unchanged);
 await page.locator('#recordMenu summary').tap();await page.locator('#enterSimpleMode').tap();assert.deepEqual(await record(),unchanged);pass('Explicit full/simple controls preserve the exact game');
 const old=createRecord([112,97],1);await importFile('old.json',JSON.stringify(old));assert.ok(await page.locator('#importColor').isVisible());await page.locator('#confirmImport').tap();assert.deepEqual((await game()).moves,old.moves);assert.equal((await game()).workflow,'duel');
 await importFile('old.sgf',exportSgf(old));await page.locator('#confirmImport').tap();assert.deepEqual((await game()).moves,old.moves);pass('Old freestyle JSON and SGF remain importable in the same interface');
 await openTools();await panel.locator('[data-full-view]').tap();await page.waitForFunction(()=>!document.body.classList.contains('simple-mode'));
 const menu=page.locator('#recordMenu'),summary=menu.locator('summary');
 await page.setViewportSize({width:320,height:240});await summary.press('Enter');
 const menuBounds=await menu.locator('.record-options').boundingBox();assert.ok(menuBounds.y+menuBounds.height<=240.5);
 await page.locator('#openModes').focus();await board.focus();assert.equal(await menu.evaluate(node=>node.open),false);
 await page.setViewportSize({width:390,height:844});await summary.tap();await menu.getByRole('button',{name:'截图导入',exact:true}).tap();
 await page.getByRole('button',{name:'返回原局',exact:true}).tap();assert.equal(await summary.evaluate(node=>node===document.activeElement),true);
 pass('Full menu stays in short viewports, closes when focus leaves, and screenshot import returns focus');
 for(const selector of ['#exportJson','#exportSgf']) {
  await summary.tap();const [download]=await Promise.all([page.waitForEvent('download'),page.locator(selector).tap()]);
  const parsed=parseSessionRecord(await readFile(await download.path(),'utf8'));assert.deepEqual(parsed.session.board,(await game()).board);
  assert.equal(await summary.evaluate(node=>node===document.activeElement),true);
 }
 await summary.tap();const [picker]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#importRecord').tap()]);
 await picker.setFiles([]);assert.equal(await summary.evaluate(node=>node===document.activeElement),true);
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
