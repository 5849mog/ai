// Browser regression for the match-first report and replay controls.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { createDevServer } from './dev-server.js';
import { validateTournament } from '../real-game-model.js';
const raw=JSON.parse(await readFile(new URL('../reports/real-games-latest.json',import.meta.url)));
const report=validateTournament(raw),games=report.games.filter(g=>g.winner),pairs=report.batches.flatMap(b=>b.identity.matchups);
const server=await createDevServer({port:0,isolated:false}),origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:JSON.parse(process.env.CHROME_ARGS||'[]')});
try{
 for(const [name,options] of [['desktop',{viewport:{width:1440,height:900}}],['mobile',{...devices['iPhone 15']}]]){
  const context=await browser.newContext({...options,serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/report.html`);await page.locator('#reportContent').waitFor({state:'visible'});
  assert.equal(Number(await page.locator('#heroGames').innerText()),games.length);assert.equal(await page.locator('.real-match-card').count(),pairs.length);assert.equal(await page.locator('#gameRows tr').count(),games.length);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(games.length){const before=Number(await page.locator('#replayRange').inputValue());await page.locator('#replayPrev').click();assert.equal(Number(await page.locator('#replayRange').inputValue()),before-1);await page.locator('#replayNext').click();assert.equal(Number(await page.locator('#replayRange').inputValue()),before);}
  await page.route('**/reports/real-games-latest.json*',route=>route.fulfill({status:503,body:'test outage'}));await page.locator('#refreshReport').click();await page.locator('#reportError').waitFor({state:'visible'});assert.equal(await page.locator('#reportContent').isVisible(),true);await page.unroute('**/reports/real-games-latest.json*');await page.locator('#retryReport').click();await page.locator('#reportError').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);console.log(`PASS ${name}: actual match data, layout, replay and refresh recovery`);await context.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
