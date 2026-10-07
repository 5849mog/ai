import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { createDevServer } from "./dev-server.js";
import { replaySession, OpeningSession } from "../opening-session.js";
const server = await createDevServer({ port: 0, isolated: false });
const base = `http://127.0.0.1:${server.address().port}/ai/`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: JSON.parse(process.env.CHROME_ARGS || "[]") });
const report = { checks: [], layouts: [], errors: [] }, output = ".cache/renju-qa";
const mark = message => { report.checks.push(message); console.log("PASS", message); };
const record = page => page.evaluate(() => JSON.parse(localStorage.getItem("gomoku-opening:/ai/:v1")).record);
const game = async page => replaySession(await record(page));
const stage = (page, value) => page.waitForFunction(v => document.querySelector("#boardSvg").dataset.stage === v, value);
const ready = page => page.waitForFunction(() => !document.querySelector("#recommendButton").disabled, null, { timeout: 30000 });
async function menu(page, selector) { await page.locator("#recordMenu summary").click(); await page.locator(selector).click(); }
async function play(page, index) { const target = page.locator(`#boardSvg [data-index="${index}"]`); await target.tap(); await target.tap(); }
async function configure(page, rule, workflow = "follow", first = "0") {
  await menu(page, "#openModes"); await page.locator("#ruleMode").selectOption(rule); await page.locator("#workflowMode").selectOption(workflow);
  if (workflow !== "copilot") await page.locator("#firstSeat").selectOption(first);
  await page.locator("#startMode").click();
}
async function load(page, session) {
  await page.evaluate(record => localStorage.setItem("gomoku-opening:/ai/:v1", JSON.stringify({ record, perspective: 1 })), session.record()); await page.reload();
}
try {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await context.addInitScript(() => { localStorage.setItem("gomoku-thinking-ms", "1000"); localStorage.setItem("gomoku-pondering", "false"); });
  const page = await context.newPage(); page.on("pageerror", e => report.errors.push(e.message));
  await page.goto(base + "renju.html"); await stage(page, "setup"); await configure(page, "rif", "follow", "0");
  await play(page, 112); await stage(page, "w2"); await play(page, 97); await play(page, 96); await stage(page, "swap3");
  const stones = (await game(page)).board.slice(); await page.locator('#openingFlow [data-choice="swap"]').click(); assert.deepEqual((await game(page)).board, stones);
  await play(page, 128); await stage(page, "offer");
  const points = (await game(page)).allowedMoves().slice(0, 2);
  await play(page, points[0]); await page.reload(); await stage(page, "offer"); assert.equal((await game(page)).candidates.length, 1);
  const next = (await game(page)).allowedMoves()[0]; await play(page, next); await stage(page, "choose");
  assert.equal((await game(page)).moves.length, 4); await ready(page); await page.locator("#recommendButton").click();
  await page.waitForFunction(() => document.querySelectorAll(".opening-proposal.suggested").length > 0, null, { timeout: 15000 });
  assert.equal((await game(page)).moves.length, 4); await play(page, next); await stage(page, "w6");
  assert.equal((await game(page)).board[next], 1); await page.locator("#undoButton").click(); await stage(page, "choose"); assert.equal((await game(page)).board[next], 0);
  await play(page, points[0]); await play(page, 129); await stage(page, "play");
  await ready(page); await page.locator("#recommendButton").click(); await page.waitForFunction(() => document.querySelector("#recommendationLegend").hidden === false);
  const beforeView = await record(page); await page.locator("#colorSelect").selectOption("2"); assert.deepEqual(await record(page), beforeView);
  mark("RIF manual roles, swap, partial proposals across reload, white selection advice and undo, perspective without restart");

  await configure(page, "rif", "copilot", "1");
  await stage(page, "setup"); await page.locator('#openingFlow [data-flow-action="start"][data-value="1"]').click();
  for (const point of [112, 97, 96]) await play(page, point);
  await stage(page, "swap3"); await page.locator('#openingFlow [data-choice="keep"]').click(); await stage(page, "offer");
  await page.waitForFunction(() => document.querySelector("#boardSvg").getAttribute("aria-disabled") === "false");
  assert.equal((await game(page)).moves.length, 4); assert.equal((await game(page)).events.at(-1).automatic, true);
  for (let i = 0; i < 2; i++) await play(page, (await game(page)).allowedMoves({ safe: true })[0]);
  await stage(page, "play"); await page.waitForFunction(() => document.querySelector("#boardSvg").getAttribute("aria-disabled") === "false");
  assert.equal((await game(page)).moves.length, 6); assert.equal((await game(page)).actor, 1);
  const opponentMove = (await game(page)).allowedMoves({ safe: true })[0]; await play(page, opponentMove);
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem("gomoku-opening:/ai/:v1")).record;
    return saved.events.filter(event => ["stone", "select"].includes(event.type)).length === 8 && saved.events.at(-1).automatic === true;
  }, null, { timeout: 30000 });
  const assisted = await game(page); assert.equal(assisted.playerColor, 2); assert.equal(assisted.moves.length, 8); assert.equal(assisted.colors.at(-1), 2);
  mark("Copilot records opponent B-W-B, confirms actual swap inline, and automatically handles own fourth, selection, sixth and normal reply");

  await configure(page, "taraguchi10");
  for (const [i, point] of [112,97,96].entries()) { await play(page,point); await stage(page,`swap${i+1}`); await page.locator('#openingFlow [data-choice="swap"]').click(); }
  await play(page,128); await stage(page,"route4"); await page.locator('#openingFlow [data-choice="ten"]').click(); await stage(page,"offer10");
  for (let i=0;i<10;i++) await play(page,(await game(page)).allowedMoves()[0]);
  await stage(page,"choose"); assert.equal((await game(page)).moves.length,4); assert.equal(await page.locator(".opening-proposal").count(),10);
  await page.screenshot({ path: `${output}/ten-phone.png` }); await page.reload(); await stage(page,"choose");
  const selected=(await game(page)).candidates[6]; await play(page,selected); await play(page,129); await stage(page,"play");
  assert.equal((await game(page)).moves.length,6); await page.locator("#undoButton").click(); await stage(page,"w6"); await page.locator("#undoButton").click(); await stage(page,"choose");
  mark("Taraguchi repeated swaps, ten arbitrary non-equivalent proposals, reload and selection reversal");

  await menu(page,"#openSetup"); await page.locator("#clearSetup").click();
  for(const index of [109,110,111,113,114])await page.locator(`#setupBoard [data-index="${index}"]`).tap();
  await page.locator("#setupSide").selectOption("1"); await page.locator("#setupActor").selectOption("player"); await page.locator("#startSetup").click(); await stage(page,"play");
  assert.equal((await game(page)).workflow,"follow"); await play(page,112); await page.locator('#openingFlow [data-flow-action="forbidden"][data-value="confirm"]').click();
  await page.waitForFunction(()=>document.querySelector("#stateText").textContent.includes("禁手")); assert.equal((await game(page)).winner,2); assert.equal(await page.locator(".winning-connector").count(),0);
  await page.locator("#undoButton").click(); assert.equal((await game(page)).winner,0); assert.equal((await game(page)).board[112],0);
  mark("Custom seed retains follow workflow; forbidden actual move confirms White win and undoes without false winning line");

  await configure(page,"rif","duel","1"); await stage(page,"swap3"); await page.waitForFunction(()=>!document.querySelector('#openingFlow [data-choice="swap"]').disabled,null,{timeout:30000});
  assert.equal((await game(page)).moves.length,3); await page.locator('#openingFlow [data-choice="keep"]').click(); await play(page,(await game(page)).allowedMoves()[0]);
  await stage(page,"choose"); await page.waitForFunction(()=>document.querySelector("#boardSvg").getAttribute("aria-disabled")==="false",null,{timeout:15000});
  assert.equal((await game(page)).candidates.length,2); await play(page,(await game(page)).candidates[0]); await stage(page,"w6");
  await page.locator("#undoButton").click(); await stage(page,"choose"); mark("Real Renju AI places all first three, offers two fifths, and undo restores a human opening choice");

  const beforeSimple=await record(page);
  await menu(page,"#enterSimpleMode");
  await page.locator("#simpleRecommendButton").click();
  await page.waitForFunction(()=>document.querySelectorAll(".opening-proposal.suggested").length>0,null,{timeout:15000});
  assert.deepEqual(await record(page),beforeSimple);
  const restartRect=await page.locator("#simpleRestart").boundingBox();
  await page.mouse.move(restartRect.x+restartRect.width/2,restartRect.y+restartRect.height/2);await page.mouse.down();
  await page.waitForTimeout(800);
  await page.waitForFunction(()=>!document.body.classList.contains("simple-mode"));
  await page.mouse.up();
  mark("Simple mode one-tap recommendation keeps controls available and never changes roles or commits advice");

  for(const [width,height]of [[360,740],[390,844],[430,932],[768,1024],[820,1180],[1024,768],[1440,900],[844,390]]){
    await page.setViewportSize({width,height}); const layout=await page.evaluate(()=>{const b=document.querySelector(".board-frame").getBoundingClientRect();return {scrollX:document.documentElement.scrollWidth>innerWidth+1,scrollY:document.documentElement.scrollHeight>innerHeight+1,board:[b.width,b.height],footer:document.querySelector(".page-footer").getBoundingClientRect().bottom};});
    assert.equal(layout.scrollX,false,`${width} x ${height} horizontal`);assert.equal(layout.scrollY,false,`${width} x ${height} vertical`);assert.ok(layout.board[0]>200);report.layouts.push({width,height,...layout});
  }
  await page.setViewportSize({width:820,height:1180}); await page.screenshot({path:`${output}/ipad.png`});
  await menu(page,"#openGuide"); assert.ok((await page.locator("#guideDialog").textContent()).includes("十打")); await page.screenshot({path:`${output}/guide-ipad.png`}); await page.locator('#guideDialog [data-close]').click();
  mark("All controls fit one screen on eight phone, tablet, desktop and landscape viewports; embedded manual opens");
  assert.deepEqual(report.errors,[]);
} finally {
  await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)); await browser.close(); await new Promise(resolve=>server.close(resolve));
}
