import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { APP_VERSION } from '../app-release.js';
const root=fileURLToPath(new URL('../',import.meta.url)), data=join(process.env.LOCALAPPDATA,'GomokuRemote');
const {chromium}=await import(pathToFileURL(join(root,'node_modules/playwright/index.mjs')).href);
let url=process.env.GOMOKU_REMOTE_PUBLIC_URL;
if(!url)try { const session=JSON.parse(await readFile(join(data,'phone-session.json'),'utf8'));const control=new URL(session.controlUrl);const response=await fetch(control.origin+'/api/status',{headers:{Authorization:'Bearer '+control.hash.slice(1)},signal:AbortSignal.timeout(3000)});url=(await response.json()).url; } catch {}
url??=(await readFile(join(data,'pinggy.log'),'utf8')).match(/https:\/\/[a-z0-9-]+\.run\.pinggy-free\.link/)?.[0];
if(!url||!/^https:\/\/[a-z0-9-]+\.run\.pinggy-free\.link$/.test(url))throw Error('Start the phone connection first');
const token=(await readFile(join(data,'pairing-key.txt'),'utf8')).trim(), results=[];
const channels=process.env.GOMOKU_REMOTE_QA_CHANNEL ? [process.env.GOMOKU_REMOTE_QA_CHANNEL] : ['chrome','msedge'];
for(const channel of channels){
 const proxy=process.env.GOMOKU_REMOTE_QA_PROXY;
 const browser=await chromium.launch({channel,headless:true,...(proxy?{proxy:{server:proxy}}:{})});
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},hasTouch:true});
  await context.addInitScript(()=>{localStorage.setItem('gomoku-thinking-ms','1000');localStorage.setItem('gomoku-pondering','false');});
  if(process.argv.includes('--candidate'))await context.route('**/remote-engine.js*',async route=>route.fulfill({contentType:'text/javascript',body:await readFile(join(root,'remote-engine.js'),'utf8')}));
  const page=await context.newPage();
  page.on('response',async response=>{if(response.request().method()==='GET'&&new URL(response.url()).pathname==='/gomoku')try{for(const message of await response.json())if(message.type==='error')console.error('Remote engine: '+message.message);}catch{}});
  await page.goto('https://5849mog.github.io/ai/?computer-launch='+APP_VERSION+'#computer='+encodeURIComponent(JSON.stringify({url,token})));
  if(!process.argv.includes('--candidate')){
   const actual=await page.evaluate(async()=>{const r=await fetch('./remote-engine.js?v=46',{cache:'reload'});return r.text();});
   assert.equal(actual.replace(/\r\n/g,'\n'),(await readFile(join(root,'remote-engine.js'),'utf8')).replace(/\r\n/g,'\n'));
  }
  await page.locator('#remoteConnect').click();
  const ready=()=>page.waitForFunction(()=>document.querySelector('#stateText').textContent==='轮到你落子',null,{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#openRemoteEngine')?.textContent.includes('15 线程'),null,{timeout:45000});await ready();
  assert.equal(await page.evaluate(()=>location.hash),'');
  await page.locator('[data-index="112"]').tap();assert.equal(await page.locator('#boardSvg [data-stone]').count(),0);
  const started=Date.now();await page.locator('[data-index="112"]').tap();await page.waitForFunction(()=>document.querySelectorAll('#boardSvg [data-stone]').length===2,null,{timeout:30000});await ready();const answerWallMs=Date.now()-started;
  await page.locator('[data-index="0"]').tap();await page.locator('[data-index="0"]').tap();await page.locator('#undoButton').click();await ready();
  await page.waitForTimeout(1500);assert.equal(await page.locator('#boardSvg [data-stone]').count(),2);
  await page.locator('#undoButton').click();await ready();assert.equal(await page.locator('#boardSvg [data-stone]').count(),0);
  await page.goto('https://5849mog.github.io/ai/tests/engine-harness.html');
  const result=await page.evaluate(async()=>{const{GomokuEngine}=await import('../engine.js');const engine=new GomokuEngine({rule:'rif'});const board=Array(225).fill(0);board[112]=1;const before=JSON.stringify(board);try{const result=await engine.search({board,sideToMove:2,timeMs:1000,multiPV:3,requestId:1});if(JSON.stringify(board)!==before)throw Error('Input changed');return result;}finally{engine.dispose();}});
  assert.equal(result.threads,15);assert.equal(result.memoryMiB,256);assert.match(result.weight,/renju/);assert.ok(result.recommendations.length>0);
  const record={channel,browser:browser.version(),publicTunnel:url,publicTransport:'authenticated HTTP long polling',nativeThreads:15,memoryMiB:256,budgetMs:1000,answerWallMs,touchAndGameAndUndoAndRenjuPassed:true,undoDuringThinkingPassed:true,computerExistingProxyUsed:Boolean(proxy),unusedBrowserModelsBlocked:false,actualPhysicalPhoneTested:false,liveRelease:!process.argv.includes('--candidate')};results.push(record);console.log(JSON.stringify(record));await context.close();
 }catch(error){console.error(error.message.replace(/#computer=\S+/g,'#computer=REDACTED'));for(const p of browser.contexts().flatMap(c=>c.pages())) console.error(await p.evaluate(()=>({state:document.querySelector('#stateText')?.textContent,remote:document.querySelector('#remoteMessage')?.textContent,button:document.querySelector('#openRemoteEngine')?.textContent})).catch(()=>({})));process.exitCode=1;break;}finally{await browser.close();}
 // A closed browser cannot guarantee delivery of its final DELETE. Respect
 // the single-user engine and the server's 20s idle lease plus 5s sweep.
 if(channel!==channels.at(-1))await new Promise(resolve=>setTimeout(resolve,26000));
}
await writeFile(join(root,'.cache/remote-qa/public-http.json'),JSON.stringify({completedAt:new Date().toISOString(),results},null,2));
