import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createDevServer } from './dev-server.js';
import { createRecord, serializeRecord, parseRecord } from '../game-record.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root='.';
await mkdir('.cache/mobile-layout',{recursive:true});
const server=await createDevServer({port:0});
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,
 ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),
 ...(process.env.CHROME_ARGS ? {args:JSON.parse(process.env.CHROME_ARGS)} : {})});
const report={startedAt:new Date().toISOString(),browser:browser.version(),runtime:'Actual Rapfi WASM with real UI; injected initialization error only for retry layout',checks:[]};
const ready=page=>page.waitForFunction(()=>document.querySelector('#stateText').textContent==='轮到你落子');
const count=page=>page.locator('#boardSvg [data-stone]').count();
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
const fits=page=>page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
try{
 for(const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390},{width:667,height:375}]){
  const ctx=await browser.newContext({viewport,isMobile:true,hasTouch:true,serviceWorkers:'block',acceptDownloads:true});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await ctx.addInitScript(()=>{
   localStorage.setItem('gomoku-thinking-ms','1000');localStorage.setItem('gomoku-pondering','false');
   if(!localStorage.getItem(`gomoku-game:${location.pathname}:v1`)) localStorage.setItem(`gomoku-game:${location.pathname}:v1`,JSON.stringify({format:'gomoku-studio',version:1,size:15,rule:'freestyle',playerColor:1,moves:[112,113,97,128,98,127]}));
  });
  await page.goto(`${origin}/plain/`);await ready(page);assert.equal(await count(page),6);
  await page.locator('#recommendButton').tap();await ready(page);
  assert.equal(await page.locator('[data-recommendation]').count(),2);assert.equal(await count(page),6);
  const layout=await fits(page);assert.ok(layout.scrollWidth<=layout.width,JSON.stringify(layout));
  // Short portrait screens keep the full board and all controls at their
  // original size; the additional analysis can scroll below them.
  for (const id of ['recommendButton','undoButton','restartButton','colorSelect','timeSelect','ponderToggle']) {
    const box=await page.locator('#'+id).boundingBox();assert.ok(box.y+box.height<=layout.height+1,`${id}: ${JSON.stringify(box)}`);
  }
  const width=await page.locator('#boardSvg').evaluate(svg=>svg.getBoundingClientRect().width);
  await page.screenshot({path:`${root}/.cache/mobile-layout/recommend-${viewport.width}.png`,fullPage:true});
  const index=await page.locator('[data-rank="1"]').getAttribute('data-recommendation');
  // Test the screen-to-SVG conversion directly, including the cropped viewBox.
  const point=await page.locator(`[data-index="${index}"]`).evaluate(cell=>{
   const svg=cell.ownerSVGElement,p=svg.createSVGPoint();p.x=Number(cell.getAttribute('cx'));p.y=Number(cell.getAttribute('cy'));
   const screen=p.matrixTransform(svg.getScreenCTM());return {x:screen.x,y:screen.y};
  });
  const nearest=await page.evaluate(async point=>{
   const {createBoardView}=await import('./board-view.js');return createBoardView(document.querySelector('#boardSvg')).nearestIntersection(point.x,point.y);
  },point);assert.equal(nearest,Number(index));
  await page.touchscreen.tap(point.x,point.y);assert.equal(await count(page),6);assert.equal(await page.locator('.pending-stone').count(),1);
  await page.touchscreen.tap(point.x,point.y);await ready(page);assert.equal(await count(page),8);
  await page.locator('#undoButton').tap();await ready(page);assert.equal(await count(page),6);
  const saved=await page.evaluate(()=>localStorage.getItem(`gomoku-game:${location.pathname}:v1`));
  await page.reload();await ready(page);assert.equal(await count(page),6);
  assert.equal(await page.evaluate(()=>localStorage.getItem(`gomoku-game:${location.pathname}:v1`)),saved);
  pass(`${viewport.width}×${viewport.height}: full-size board, recommendation legend fits, coordinate mapping, two-tap play, undo and automatic resume`);
  assert.equal(await page.locator('#boardSvg').evaluate(svg=>svg.getBoundingClientRect().width),width);
  await page.locator('#recordMenu summary').tap();
  const menu=await page.locator('.record-options').boundingBox();assert.ok(menu.x>=0 && menu.x+menu.width<=viewport.width+1);
  const downloading=page.waitForEvent('download');await page.locator('#exportJson').tap();const file=await downloading;
  const downloaded=parseRecord(await readFile(await file.path(),'utf8')).record;assert.equal(downloaded.moves.length,6);
  await page.locator('#recordMenu summary').tap();const choosing=page.waitForEvent('filechooser');await page.locator('#importRecord').tap();
  const chooser=await choosing;await chooser.setFiles({name:'layout.gomoku.json',mimeType:'application/json',buffer:Buffer.from(serializeRecord(createRecord([112,113],1)))});
  await page.locator('#recordDialog').waitFor({state:'visible'});
  const dialog=await page.locator('#recordDialog').boundingBox();assert.ok(dialog.x>=0 && dialog.y>=0 && dialog.x+dialog.width<=viewport.width+1 && dialog.y+dialog.height<=viewport.height+1);
  await page.locator('#cancelImport').tap();assert.equal(await count(page),6);
  await page.locator('#recordFile').setInputFiles({name:'win.gomoku.json',mimeType:'application/json',buffer:Buffer.from(serializeRecord(createRecord([0,30,1,32,2,34,3,36,4],1)))});
  await page.locator('#confirmImport').tap();assert.equal(await page.locator('#stateText').innerText(),'你赢了');
  assert.equal(await page.locator('#boardSvg .winning-ring').count(),5);
  await page.locator('#undoButton').tap();await ready(page);assert.equal(await page.locator('#boardSvg .winning-ring').count(),0);
  await page.locator('#restartButton').tap();await ready(page);assert.equal(await count(page),0);
  await page.locator('#colorSelect').selectOption('2');await ready(page);assert.equal(await count(page),1);
  await page.locator('#timeSelect').selectOption('5000');await page.locator('#ponderToggle').check();
  await page.waitForFunction(()=>document.querySelector('#analysisState').textContent.includes('后台思考'));
  await page.locator('#ponderToggle').uncheck();
  pass(`${viewport.width}×${viewport.height}: header record menu, export, import preview/cancel/confirm, winning highlights, restart, color/time and pondering controls`);
  assert.deepEqual(errors,[]);await ctx.close();
 }
 const ctx=await browser.newContext({viewport:{width:320,height:568},hasTouch:true,isMobile:true,serviceWorkers:'block'});
 await ctx.addInitScript(()=>{
  const NativeWorker=window.Worker;let fail=true;
  window.Worker=class extends NativeWorker{
   postMessage(data,...args){if(data.type==='init' && fail){fail=false;queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{type:'error',message:'layout initialization failure'}})));}else super.postMessage(data,...args);}
  };
 });
 const page=await ctx.newPage();await page.goto(`${origin}/plain/`);await page.locator('#retryButton').waitFor({state:'visible'});
 assert.equal(await page.locator('#stateText').innerText(),'AI 暂不可用，请重试或悔棋');
 assert.equal((await fits(page)).scrollWidth,320);
 await page.locator('#retryButton').tap();await ready(page);assert.equal(await page.locator('#retryButton').isHidden(),true);
 pass('320×568: original long error prompt wraps without horizontal overflow and relocated retry button recovers the engine');
 await ctx.close();
 report.completedAt=new Date().toISOString();report.passed=true;
 await writeFile(`${root}/.cache/mobile-layout/interactions.json`,JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
