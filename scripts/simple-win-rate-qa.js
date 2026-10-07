import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { createDevServer } from "./dev-server.js";
import { OpeningSession } from "../opening-session.js";

const real = process.argv.includes("--real-engine");
const server = await createDevServer({ port: 0, isolated: false });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const base = `http://127.0.0.1:${server.address().port}/ai/`, output = ".cache/simple-win-rate-qa";
const engineFixture = `export class GomokuEngine {
  constructor(options) { Object.assign(this, options); this.ready=false; }
  async init() { this.ready=true; this.onState({state:'ready'}); }
  stopPonder() {} cancel() {} reset() {this.ready=false;}
  async ponder() {}
  async search(options) {
    this.onState({state:'thinking'});
    const index=(options.allowedMoves || Array.from(options.board).flatMap((v,i)=>v?[]:[i]))[0];
    let result;
    for (const [winRate,depth] of [[.65,2],[.8,4]]) {
      result={index,assessment:{winRate,depth,bestIndex:index},recommendations:[{index}],elapsed:1,requestId:options.requestId};
      this.onStats({requestId:options.requestId,sideToMove:options.sideToMove,stats:result});
      await new Promise(resolve=>setTimeout(resolve,350));
    }
    this.onState({state:'ready'}); return result;
  }
}`;
const pass = message => console.log("PASS", message);
const rated = page => page.waitForFunction(() => document.querySelector("#simpleWinRate").dataset.state === "rated" && document.querySelector("#boardSvg").getAttribute("aria-busy") === "false", null, { timeout:60000 });
const ready = page => page.waitForFunction(() => document.querySelector("#boardSvg").getAttribute("aria-disabled") === "false" && document.querySelector("#boardSvg").getAttribute("aria-busy") === "false", null, {timeout:60000});
async function play(page, index) { await ready(page); await page.locator(`[data-index="${index}"]`).tap(); await page.locator(`[data-index="${index}"]`).tap(); }
async function checkColors(page, ownColor, renju) {
  const mine = await page.locator("#playerWinRate").textContent(), other = await page.locator("#aiWinRate").textContent();
  const expected = `胜率 · 黑 ${ownColor === 1 ? mine : other} · 白 ${ownColor === 2 ? mine : other}`;
  assert.equal(await page.locator("#simpleWinRate").textContent(), expected);
  if (!real) assert.equal(mine, renju ? "80%" : "20%");
}
try {
  await mkdir(output, {recursive:true});
  for (const renju of [false,true]) for (const ownColor of [1,2]) {
    const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:"block"});
    const board = new Uint8Array(225); board[112]=1; board[97]=2;
    const opening = new OpeningSession({rule:"renju",workflow:"copilot",initialBlackSeat:ownColor === 1 ? 0 : 1,seed:{board,sideToMove:3-ownColor}});
    await context.addInitScript(({renju,ownColor,record}) => {
      localStorage.setItem("gomoku-thinking-ms","1000"); localStorage.setItem("gomoku-pondering","false");
      if (!localStorage.getItem("win-rate-fixture")) {
        localStorage.setItem("win-rate-fixture","1");
        if (renju) localStorage.setItem("gomoku-opening:/ai/:v1",JSON.stringify({record,perspective:ownColor}));
        else localStorage.setItem("gomoku-game:/ai/:v1",JSON.stringify({format:"gomoku-studio",version:1,size:15,rule:"freestyle",playerColor:ownColor,moves:ownColor === 1 ? [112,97] : [112]}));
      }
    },{renju,ownColor,record:opening.record()});
    const page=await context.newPage(), errors=[];page.on("pageerror",e=>errors.push(e.message));
    if (!real) await page.route("**/engine.js*",route=>route.fulfill({contentType:"text/javascript",body:engineFixture}));
    await page.goto(base+(renju?"renju.html":"")+"?view=simple"); await ready(page);
    assert.match(await page.locator("#simpleWinRate").textContent(),/等待评估/);
    if (renju) await play(page,96); else await play(page,ownColor === 1 ? 96 : 97);
    if (!real) {
      await page.waitForFunction(()=>document.querySelector("#simpleWinRate").textContent.includes("65%") && document.querySelector("#boardSvg").getAttribute("aria-busy")==="true");
      pass(`${renju?"Renju":"Freestyle"}, own ${ownColor}: engine stats update while AI is thinking`);
    }
    await rated(page); await checkColors(page,ownColor,renju);
    const finalText=await page.locator("#simpleWinRate").textContent();
    await page.reload(); await ready(page); assert.equal(await page.locator("#simpleWinRate").textContent(),finalText);
    if (renju) { await page.locator("#simpleUndoButton").tap(); await ready(page); assert.match(await page.locator("#simpleWinRate").textContent(),/等待评估/); }
    await page.screenshot({path:`${output}/${real?"real":"fixture"}-${renju?"renju":"freestyle"}-${ownColor}.png`});
    if (ownColor === 1) {
      for (const [width,height] of [[260,420],[320,480],[390,844],[820,1180],[1440,900],[320,240],[560,320],[844,390]]) {
        await page.setViewportSize({width,height});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const bounds=await page.evaluate(()=>{
          const rects=[".board-frame","#simpleWinRate","#simpleControls"].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};});
          return {rects,w:innerWidth,h:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight};
        });
        assert.equal(bounds.w,width); assert.equal(bounds.h,height);
        assert.ok(bounds.scrollWidth<=width+1 && bounds.scrollHeight<=height+1,JSON.stringify(bounds));
        for(const r of bounds.rects) assert.ok(r.x>=-1&&r.y>=-1&&r.right<=width+1&&r.bottom<=height+1&&r.width>0&&r.height>0,JSON.stringify(bounds));
        const [b,r]=bounds.rects; assert.ok(b.bottom<=r.y+1 || b.right<=r.x+1 || r.right<=b.x+1,"Win rate must not cover board intersections");
      }
    }
    assert.deepEqual(errors,[]); await context.close();
    pass(`${renju?"Renju":"Freestyle"}, own ${ownColor}: correct colors, completed PV retained with pondering off, reload and compact layout`);
  }
  const context=await browser.newContext({serviceWorkers:"block"});
  await context.addInitScript(()=>{
    localStorage.setItem("gomoku-game:/ai/:v1",JSON.stringify({format:"gomoku-studio",version:1,size:15,rule:"freestyle",playerColor:2,moves:[0,30,1,32,2,34,3,36,4]}));
  });
  const page=await context.newPage();await page.goto(base+"?view=simple");
  assert.equal(await page.locator("#simpleWinRate").textContent(),"胜率 · 黑胜");
  await page.goto(base+"renju.html?view=simple");assert.equal(await page.locator("#simpleWinRate").textContent(),"胜率 · 等待开局");
  await page.locator('#simpleOpeningFlow [data-flow-action="start"][data-value="1"]').click();
  assert.equal(await page.locator("#simpleWinRate").textContent(),"胜率 · 开局完成后评估");
  await context.close();pass("Terminal games show the result; formal-opening choices never display hypothetical search percentages");
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
