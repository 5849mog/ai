import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { APP_VERSION } from "../app-release.js";
const root=fileURLToPath(new URL('../',import.meta.url)), oldCommit='7186428a8a7050f44d23e7e46dd356ffcb8c7d2a';
const oldFiles=new Map();
const prior=name=>{if(!oldFiles.has(name))oldFiles.set(name,execFileSync('git',['show',`${oldCommit}:${name}`],{cwd:root,maxBuffer:8*1024*1024}));return oldFiles.get(name);};
const oldSource=prior('sw.js').toString(),currentSource=await readFile(path.join(root,'sw.js'),'utf8');
const cacheName=source=>'gomoku-rapfi:/plain/:'+ /const VERSION = PREFIX \+ "([^"]+)"/.exec(source)[1];
const oldCache=cacheName(oldSource),newCache=cacheName(currentSource);
let stage='old',newModelRequests=0;
const server=http.createServer(async(req,res)=>{
 try{
  const name=new URL(req.url,'http://localhost').pathname.replace(/^\/plain\//,'')||'index.html';
  if(name.split('/').some(x=>x.startsWith('.'))){res.writeHead(403);res.end();return;}
  const model=name.startsWith('engine/');
  if(stage==='new'&&model&&/\.(?:wasm|data|part)$/.test(name))newModelRequests++;
  const bytes=stage==='old'&&!model?prior(name):await readFile(path.join(root,name));
  res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.ttf':'font/ttf'})[path.extname(name)]||'application/octet-stream');
  res.setHeader('Cache-Control',name==='sw.js'?'no-cache':'public, max-age=3600');res.end(bytes);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:JSON.parse(process.env.CHROME_ARGS||'[]')});
const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
await ctx.addInitScript(()=>{
 if(!localStorage.getItem('gomoku-game:/plain/:v1'))localStorage.setItem('gomoku-game:/plain/:v1',JSON.stringify({format:'gomoku-studio',version:1,size:15,rule:'freestyle',playerColor:1,moves:[112,113]}));
 localStorage.setItem('gomoku-pondering','false');localStorage.setItem('gomoku-thinking-ms','1000');
});
const page=await ctx.newPage(),errors=[],report={version:APP_VERSION,fromCommit:oldCommit,method:'Real cached previous release upgraded to current source, then real Rapfi offline play',checks:[]};
page.on('pageerror',e=>errors.push(e.message));const pass=s=>{report.checks.push(s);console.log('PASS',s);};
const ready=count=>page.waitForFunction(n=>document.querySelector('#boardSvg')?.getAttribute('aria-disabled')==='false'&&document.querySelectorAll('#boardSvg [data-stone]').length===n,count,{timeout:60000});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/plain/?view=simple`);await ready(2);
 await page.waitForFunction(async name=>{const names=await caches.keys();return names.includes(name)&&Boolean(navigator.serviceWorker.controller)&&Boolean(await(await caches.open('gomoku-rapfi:/plain/:engine-250615')).match(new URL('__engine_offline_ready__',location.href).href));},oldCache,{timeout:60000});
 pass('Previous v47 page and fixed engine models are actually cached');
 stage='new';await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});
 await page.waitForFunction(async name=>{const c=await caches.open(name);return Boolean(await c.match(new URL('session-records.js',location.href).href))&&document.querySelector('[data-app-version]')?.textContent.includes('缓存 2026.10.18.3');},newCache,{timeout:60000});
 await page.locator('[aria-controls="simpleQuickTools"]').tap();
 await page.waitForFunction(()=>document.querySelector('#simpleQuickTools [data-app-update]')?.textContent==='刷新使用新版');
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#simpleQuickTools [data-app-update]').click()]);await ready(2);
 assert.equal(await page.locator('#simpleUndoButton').count(),1);assert.equal(await page.locator('#simpleColorLabel').textContent(),'对局');
 const cached=await page.evaluate(async name=>{const c=await caches.open(name);return Promise.all(['index.html','renju.html','opening-app.js','session-records.js','display-modes.js'].map(async path=>({path,text:await(await c.match(new URL(path,location.href).href)).text()})));},newCache);
 for(const f of cached)assert.equal(f.text,await readFile(path.join(root,f.path),'utf8'));
 assert.equal(await page.evaluate(async name=>Boolean(await(await caches.open(name)).match(new URL('app.js',location.href).href)),newCache),false);
 pass('User update control loads one complete interface with the old two stones preserved');
 assert.equal(newModelRequests,0);pass('Pinned engine models are reused without downloading again');
 await ctx.setOffline(true);await page.reload();await ready(2);
 await page.locator('[data-index="97"]').tap();await page.locator('[data-index="97"]').tap();await ready(4);
 await page.locator('#simpleUndoButton').tap();await ready(2);
 const current=await page.evaluate(()=>JSON.parse(localStorage.getItem('gomoku-opening:/plain/:v1')));assert.equal(current.unified,true);assert.equal(current.record.workflow,'duel');assert.deepEqual(current.record.events.map(e=>e.index),[112,113]);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('gomoku-game:/plain/:v1')).moves),[112,113]);
 pass('Offline reload, real AI reply, undo and legacy-data preservation pass after migration');
 assert.deepEqual(errors,[]);report.passed=true;report.browser=browser.version();await mkdir('.cache/upgrade',{recursive:true});await writeFile('.cache/upgrade/result.json',JSON.stringify(report,null,2)+'\n');
}catch(error){await mkdir('.cache/upgrade',{recursive:true});await page.screenshot({path:'.cache/upgrade/failure.png'});throw error;}
finally{await browser.close();await new Promise(r=>server.close(r));}
