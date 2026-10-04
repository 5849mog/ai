import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=await readFile(path.join(root,'sw.js'),'utf8');
const version=/250615-(v\d+)/.exec(source)[1];
let stage='old',oldVersion='v11',largeDownloads=0,forcedEngineReloads=0;
const oldIndex='<!doctype html><meta name="viewport" content="width=device-width"><p>Previous release fixture</p><script type="module" src="./app.js"></script>';
const oldApp='navigator.serviceWorker.register("./sw.js",{scope:"./"});';
const server=http.createServer(async(req,res)=>{
 try{
  const relative=new URL(req.url,'http://local').pathname.replace(/^\/plain\//,'')||'index.html';
  if(relative.split('/').includes('..')){res.writeHead(403);res.end();return;}
  const file=path.join(root,relative);
  res.setHeader('Cache-Control',relative==='sw.js'?'no-cache':'public, max-age=3600');
  const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
  res.setHeader('Content-Type',mime);
  if(stage==='old'&&relative==='index.html'){res.end(oldIndex);return;}
  if(stage==='old'&&relative==='app.js'){res.end(oldApp);return;}
  if(stage==='old'&&relative==='sw.js'){
   const old=source.replaceAll(version,oldVersion).replaceAll(version.replace('v','v='),oldVersion.replace('v','v='))
    .replace('...CORE.map(path => new Request(url(path), { cache: "reload" }))','...CORE.map(url)');
   res.end(old);return;
  }
  if(stage==='new'&&/\.(?:data|wasm)$/.test(relative)){largeDownloads++;if(/no-cache|max-age=0/.test(req.headers['cache-control']||''))forcedEngineReloads++;}
  const info=await stat(file);res.setHeader('Content-Length',info.size);createReadStream(file).pipe(res);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),...(process.env.CHROME_ARGS?{args:JSON.parse(process.env.CHROME_ARGS)}:{})});
const report={startedAt:new Date().toISOString(),version,checks:[]};
const pass=name=>{report.checks.push(name);console.log('PASS',name);};
async function waitCache(page,desired,removed){
 for(let i=0;i<150;i++){
  const ok=await page.evaluate(async({desired,removed})=>{
   const names=await caches.keys();if(!names.includes(`gomoku-rapfi:/plain/:250615-${desired}`)||removed&&names.includes(`gomoku-rapfi:/plain/:250615-${removed}`))return false;
   const c=await caches.open(`gomoku-rapfi:/plain/:250615-${desired}`);
   return !!await c.match(new URL('app.js',location.href).href)&&!!navigator.serviceWorker.controller;
  },{desired,removed});
  if(ok)return;if(i===149)throw Error('cache activation timeout');await page.waitForTimeout(200);
 }
}
try{
 for(oldVersion of ['v11','v12']){
  stage='old';largeDownloads=0;forcedEngineReloads=0;
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await ctx.addInitScript(()=>{
   localStorage.setItem('gomoku-thinking-ms','1000');localStorage.setItem('gomoku-pondering','false');
   if(!localStorage.getItem(`gomoku-game:${location.pathname}:v1`))localStorage.setItem(`gomoku-game:${location.pathname}:v1`,JSON.stringify({format:'gomoku-studio',version:1,size:15,rule:'freestyle',playerColor:1,moves:[112,113]}));
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/plain/`);await waitCache(page,oldVersion);
  const old=await page.evaluate(async oldVersion=>{const c=await caches.open(`gomoku-rapfi:/plain/:250615-${oldVersion}`);return(await c.match(new URL('app.js',location.href).href)).text();},oldVersion);
  assert.equal(old,oldApp);
  stage='new';await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});
  await waitCache(page,version,oldVersion);
  const cached=await page.evaluate(async version=>{
   const c=await caches.open(`gomoku-rapfi:/plain/:250615-${version}`);
   return Promise.all(['index.html','app.js','engine-jobs.js','position-analysis.js','analysis-view.js',`styles.css?${version.replace('v','v=')}`].map(async name=>({name,text:await(await c.match(new URL(name,location.href).href)).text()})));
  },version);
  for(const item of cached)assert.equal(item.text,await readFile(path.join(root,item.name.split('?')[0]),'utf8'),item.name);
  assert.equal(forcedEngineReloads,0,'Pinned engine WASM/data must retain their normal HTTP cache policy');
  report.engineRequests??=[];report.engineRequests.push({from:oldVersion,networkMisses:largeDownloads,forcedReloads:forcedEngineReloads});
  pass(`${oldVersion} → ${version}: fresh app files bypass one-hour HTTP cache, legacy offline cache removed, pinned WASM/data retain normal cache policy`);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#stateText').textContent==='轮到你落子');
  assert.equal(await page.locator('#boardSvg [data-stone]').count(),2);
  assert.equal(await page.locator('#positionAnalysis').getAttribute('data-ply'),'2');
  assert.equal(await page.locator('#boardSvg').evaluate(el=>el.getBoundingClientRect().width),378);
  await ctx.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('#stateText').textContent==='轮到你落子');
  await page.locator('[data-index="97"]').tap();await page.locator('[data-index="97"]').tap();await page.waitForFunction(()=>document.querySelector('#stateText').textContent==='轮到你落子');
  assert.equal(await page.locator('#boardSvg [data-stone]').count(),4);
  await page.locator('#ponderToggle').check();await page.waitForFunction(()=>document.querySelector('#playerWinRate').textContent!=='—');await page.locator('#ponderToggle').uncheck();
  await page.locator('#undoButton').tap();await page.waitForFunction(()=>document.querySelector('#stateText').textContent==='轮到你落子');
  assert.equal(await page.locator('#boardSvg [data-stone]').count(),2);
  assert.equal(await page.locator('#positionAnalysis').getAttribute('data-ply'),'2');
  pass(`${oldVersion} → ${version}: current game preserved; new UI, native win rate, foreground move and undo work after offline reload`);
  assert.deepEqual(errors,[]);await ctx.close();
 }
 report.passed=true;report.completedAt=new Date().toISOString();await mkdir(path.join(root,'.cache/position-analysis'),{recursive:true});
 await writeFile(path.join(root,'.cache/position-analysis/upgrade.json'),JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
