import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createDevServer } from "./dev-server.js";
import { replaySession } from "../opening-session.js";

// Isolate startup ownership and persistence from engine search timing.
const fixture = `export class GomokuEngine {
  constructor(options) { Object.assign(this, options); this.ready = false; this.pondering = false; }
  async init() { this.ready = true; this.onState({state:'ready'}); }
  cancel() {} stopPonder() {} reset() { this.ready = false; }
  async search(options) {
    this.onState({state:'thinking'});
    const points = options.allowedMoves || Array.from(options.board).flatMap((c, i) => c ? [] : [i]);
    const result = {index:points[0], assessment:{winRate:.55}, recommendations:points.slice(0, options.multiPV || 2).map(index=>({index})), requestId:options.requestId};
    this.onState({state:'ready'}); return result;
  }
  async ponder() {}
}`;
const server = await createDevServer({ port: 0, isolated: false });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [], context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
await context.addInitScript(() => localStorage.setItem("gomoku-pondering", "false"));
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
await page.route("**/engine.js?v=22", route => route.fulfill({ contentType: "text/javascript", body: fixture }));
const record = () => page.evaluate(() => JSON.parse(localStorage.getItem("gomoku-opening:/ai/:v1")).record);
const game = async () => replaySession(await record());
const stage = value => page.waitForFunction(value => document.querySelector("#boardSvg").dataset.stage === value, value);
const start = opener => page.locator(`#openingFlow [data-flow-action="start"][data-value="${opener}"]`).click();
async function setup() {
  await stage("setup");
  assert.equal(await page.locator('#openingFlow [data-flow-action="start"]:visible').count(), 2);
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal((await game()).playerColor, 0);
  // Give even an immediately resolving engine a chance to expose accidental autoplay.
  await page.waitForTimeout(100);
  assert.equal((await game()).events.length, 0);
  assert.equal(await page.locator("#boardSvg").getAttribute("aria-disabled"), "true");
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/ai/renju.html`);
  await setup();
  for (const rule of ["rif", "taraguchi10", "freestyle", "renju"]) for (const workflow of ["follow", "duel", "copilot"]) {
    await page.locator("#recordMenu summary").click(); await page.locator("#openModes").click();
    assert.equal(await page.locator("#firstSeat").count(), 0);
    await page.locator("#ruleMode").selectOption(rule); await page.locator("#workflowMode").selectOption(workflow);
    await page.locator("#startMode").click(); await setup();
    // An unfinished startup survives reload with both buttons still available.
    await page.reload(); await setup();
    for (const opener of [0, 1]) {
      await start(opener);
      const formal = ["rif", "taraguchi10"].includes(rule);
      const automatic = workflow === "duel" ? opener === 1 : workflow === "copilot" && formal && opener === 0;
      const expectedStage = formal ? automatic ? rule === "rif" ? "swap3" : "swap1" : "b1" : "play";
      await stage(expectedStage);
      if (automatic) await page.waitForFunction(count => JSON.parse(localStorage.getItem("gomoku-opening:/ai/:v1")).record.events.filter(event => event.type === "stone").length === count, rule === "rif" ? 3 : 1);
      const selected = await record(); assert.equal((await game()).playerColor, opener === 0 ? 1 : 2);
      assert.equal(await page.locator('#openingFlow [data-flow-action="start"]').count(), 0);
      await page.reload(); await stage(expectedStage); assert.deepEqual(await record(), selected);
      await page.locator("#restartButton").click(); await setup();
      assert.equal((await game()).rule, rule); assert.equal((await game()).workflow, workflow);
    }
    console.log("PASS", rule, workflow, "inline roles, both openers, reload, restart, no autoplay before choice");
  }
  // A duel new game in the small window also asks inline instead of inheriting color.
  await page.locator("#recordMenu summary").click(); await page.locator("#openModes").click();
  await page.locator("#ruleMode").selectOption("rif"); await page.locator("#workflowMode").selectOption("duel");
  await page.locator("#startMode").click(); await start(0);
  await page.locator("#recordMenu summary").click(); await page.locator("#enterSimpleMode").click();
  await page.locator("#simpleRestart").click(); await stage("setup");
  assert.equal(await page.locator('#simpleOpeningFlow [data-flow-action="start"]:visible').count(), 2);
  assert.equal((await game()).workflow, "duel"); assert.equal((await game()).events.length, 0);
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.deepEqual(errors, []); console.log("PASS simple duel restart roles and no browser errors");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
