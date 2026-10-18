import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createDevServer} from './dev-server.js';
import {OpeningSession} from '../opening-session.js';
import {APP_VERSION} from '../app-release.js';
const server=await createDevServer({port:0}),origin=`http://127.0.0.1:${server.address().port}/plain/`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:JSON.parse(process.env.CHROME_ARGS||'[]')});
const report={version:APP_VERSION,startedAt:new Date().toISOString(),browser:browser.version(),method:'Real single-thread Rapfi WASM, no engine doubles; frame-by-frame current-color checks and one-screen layouts.',checks:[],layouts:[],frames:[],sources:{}};
const pass=name=>{console.log('PASS',name);report.checks.push(name);};
for(const name of ['opening-app.js','board-view.js','turn-hints.js','engine-jobs.js','styles.css','scripts/board-hints-qa.js'])report.sources[name]=createHash('sha256').update(await readFile(new URL('../'+name,import.meta.url))).digest('hex');
const hintRows=page=>page.locator('[data-hint]').evaluateAll(nodes=>nodes.map(n=>({index:+n.dataset.hint,color:+n.dataset.color,rank:+n.dataset.rank})));
const waitHints=page=>page.waitForFunction(()=>document.querySelectorAll('[data-hint]').length>0,undefined,{timeout:30000});
const tap=async(page,index)=>{await page.locator(`#boardSvg [data-index="${index}"]`).tap();await page.locator(`#boardSvg [data-index="${index}"]`).tap();};
const sizes=[[320,568],[360,640],[390,844],[780,360],[844,390],[768,1024],[820,1180],[1024,768],[1440,900]];
async function layouts(page,name,mode){
 for(const [width,height] of sizes){await page.setViewportSize({width,height});await page.waitForTimeout(140);
  const r=await page.evaluate(()=>{const b=document.querySelector('#boardSvg').getBoundingClientRect(),c=document.querySelector(document.body.classList.contains('simple-mode')?'#simpleControls':'.game-sidebar').getBoundingClientRect();return {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,board:{x:b.x,y:b.y,side:b.width,right:b.right,bottom:b.bottom},controls:{x:c.x,y:c.y,right:c.right,bottom:c.bottom}};});
  assert.ok(r.width<=width+1&&r.height<=height+1,`${name}/${mode}: page overflow`);
  for(const b of [r.board,r.controls])assert.ok(b.x>=-1&&b.y>=-1&&b.right<=width+1&&b.bottom<=height+1,`${name}/${mode}: clipped at ${width}x${height}`);
  report.layouts.push({page:name,mode,width,height,boardSide:Math.round(r.board.side),passed:true});
 }
 pass(`${name}: ${mode} layout passes all nine phone, tablet and desktop sizes`);
}
let page;
try{
 await mkdir('.cache/board-hints',{recursive:true});
 for(const workflow of ['freestyle','follow','copilot']){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const board=Array(225).fill(0);board[112]=1;board[97]=2;
  const record=new OpeningSession({rule:'taraguchi10',workflow:workflow==='freestyle'?'follow':workflow,initialBlackSeat:0,seed:{board,sideToMove:workflow==='copilot'?2:1}}).record();
  await context.addInitScript(({record,workflow})=>{
   localStorage.setItem('gomoku-thinking-ms','1000');localStorage.setItem('gomoku-pondering','true');localStorage.setItem('gomoku-candidate-reply-mode','manual');
   if(workflow!=='freestyle')localStorage.setItem('gomoku-opening:/plain/:v1',JSON.stringify({record,perspective:2}));
   const NativeWorker=window.Worker;window.hintJobs=[];window.hintFrames=[];
   window.Worker=class extends NativeWorker{postMessage(data,...args){if(['ponder','search'].includes(data.type))hintJobs.push(data);return super.postMessage(data,...args);}};
   document.addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{
    const svg=document.querySelector('#boardSvg'),nodes=[...svg.querySelectorAll('[data-hint]')],stones=[...svg.querySelectorAll('[data-stone]')];
    if(nodes.length)hintFrames.push({stones:stones.length,points:nodes.map(n=>({index:+n.dataset.hint,color:+n.dataset.color,occupied:stones.some(s=>s.dataset.stone===n.dataset.hint)}))});
   }).observe(document.querySelector('#boardSvg'),{childList:true}));
  },{record,workflow});
  page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const name=workflow==='freestyle'?'index.html':'renju.html';await page.goto(origin+name+'?view=simple');
  await waitHints(page);assert.equal(await page.locator('#moveCandidates').count(),0);assert.equal(await page.locator('#candidateReplyMode').count(),0);
  if(workflow==='freestyle')assert.equal((await hintRows(page)).length,3);
  await page.waitForFunction(()=>document.querySelector('#boardSvg').getAttribute('aria-disabled')==='false',undefined,{timeout:30000});
  pass(`${workflow}: current legal colored points appear with no panel or mode control`);
  const initial=await hintRows(page),outside=Array.from({length:225},(_,i)=>i).find(i=>!board[i]&&!initial.some(p=>p.index===i));
  await tap(page,outside);
  if(workflow==='follow'){
   await waitHints(page);assert.ok((await hintRows(page)).every(p=>p.color===2));
   const rows=await hintRows(page),second=Array.from({length:225},(_,i)=>i).find(i=>i!==outside&&!board[i]&&!rows.some(p=>p.index===i));
   await tap(page,second);await waitHints(page);assert.ok((await hintRows(page)).every(p=>p.color===1));
   await page.locator('#colorSelect').evaluate(select=>{select.value='1';select.dispatchEvent(new Event('change'));});await waitHints(page);assert.ok((await hintRows(page)).every(p=>p.color===1));
   await page.locator('#simpleUndoButton').tap();await waitHints(page);assert.ok((await hintRows(page)).every(p=>p.color===2));
   pass('follow: outside-list inputs switch black/white immediately, perspective does not change the mover, undo restores white');
   const selected=(await hintRows(page))[0].index;await tap(page,selected);await waitHints(page);
   assert.equal(await page.locator(`[data-stone="${selected}"]`).getAttribute('data-color'),'2');
   pass('follow: tapping a colored point uses the ordinary touch confirmation and places exactly that white stone');
  }else{
   const count=workflow==='freestyle'?2:4;
   await page.waitForFunction(count=>document.querySelectorAll('#boardSvg [data-stone]').length===count,count,{timeout:30000});await waitHints(page);
   const color=workflow==='freestyle'?1:2;assert.ok((await hintRows(page)).every(p=>p.color===color));
   const jobs=await page.evaluate(()=>hintJobs.filter(j=>j.type==='search'));assert.equal(jobs.length,1);assert.equal(jobs[0].timeMs,1000);assert.equal(jobs[0].multiPV,3);
   pass(`${workflow}: outside-list input causes one normal automatic response, with no review search or manual hold`);
  }
  const frames=await page.evaluate(()=>hintFrames);assert.ok(frames.length);
  for(const f of frames){const expected=workflow==='copilot'?(f.stones%2?1:2):(f.stones%2?2:1);assert.ok(f.points.length<=3&&f.points.every(p=>p.color===expected&&!p.occupied));}
  if(workflow!=='follow')assert.ok(frames.some(f=>f.stones===(workflow==='freestyle'?1:3)), 'AI-turn hints were not painted during automatic search');
  report.frames.push({workflow,verifiedFrames:frames.length,aiTurnFrames:workflow==='follow'?0:frames.filter(f=>f.stones===(workflow==='freestyle'?1:3)).length});
  pass(`${workflow}: every recorded frame uses the current mover and empty points, including the AI turn`);
  await page.screenshot({path:`.cache/board-hints/${workflow}.png`});
  if(workflow!=='copilot'){
   await layouts(page,name,'simple');await page.setViewportSize({width:390,height:844});
   // Enter full view by URL with the same persisted game.
   await page.goto(origin+name+'?view=full');await layouts(page,name,'full');
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 report.passed=true;report.finishedAt=new Date().toISOString();await writeFile('.cache/board-hints/result.json',JSON.stringify(report,null,2)+'\n');
}catch(error){if(page&&!page.isClosed()){await page.screenshot({path:'.cache/board-hints/failure.png'});await writeFile('.cache/board-hints/failure.json',JSON.stringify({error:String(error),state:await page.locator('#stateText').innerText(),jobs:await page.evaluate(()=>hintJobs.slice(-3)),frames:await page.evaluate(()=>hintFrames.slice(-5))},null,2));}throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
