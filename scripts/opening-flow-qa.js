import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { createDevServer } from "./dev-server.js";
import { OpeningSession, replaySession, isAutomaticTurn } from "../opening-session.js";

// Run without --mock-engine to use the repository's actual Rapfi assets.
// The fixture isolates UI/role sequencing from engine strength and availability.
const mocked = process.argv.includes("--mock-engine");
const layoutOnly = process.argv.includes("--layout-only");
const fixture = `export class GomokuEngine {
  constructor(options) { Object.assign(this, options); this.ready = false; this.pondering = false; }
  async init() { this.ready = true; this.onState({state:'ready'}); }
  cancel() {} stopPonder() {} reset() { this.ready = false; }
  async search(options) {
    this.onState({state:'thinking'});
    await new Promise(resolve => setTimeout(resolve, 25));
    if (window.failNextSearch) { window.failNextSearch = false; throw new Error('QA injected search failure'); }
    const points = options.allowedMoves || Array.from(options.board).flatMap((c, i) => c ? [] : [i]);
    const result = {index:points[0], assessment:{winRate:.55}, recommendations:points.slice(0, options.multiPV || 2).map(index=>({index})), requestId:options.requestId};
    this.onState({state:'ready'}); return result;
  }
  async ponder() {}
}`;
const server = await createDevServer({ port: 0, isolated: false });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const output = mocked ? ".cache/opening-flow-qa-mock" : ".cache/opening-flow-qa", base = `http://127.0.0.1:${server.address().port}/ai/`;
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const errors = [], page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
await context.addInitScript(() => {
  const fixture = sessionStorage.getItem("qaOpeningFixture");
  if (fixture) { localStorage.setItem("gomoku-opening:/ai/:v1", fixture); sessionStorage.removeItem("qaOpeningFixture"); }
  localStorage.setItem("gomoku-thinking-ms", "1000"); localStorage.setItem("gomoku-pondering", "false");
  HTMLDialogElement.prototype.showModal = function () { throw new Error("Opening flow must not open a dialog"); };
});
if (mocked) await page.route("**/engine.js?v=22", route => route.fulfill({ contentType: "text/javascript", body: fixture }));
const record = () => page.evaluate(() => JSON.parse(localStorage.getItem("gomoku-opening:/ai/:v1")).record);
const game = async () => replaySession(await record());
const flow = "#simpleOpeningFlow";
const action = (name, value) => page.locator(`${flow} [data-flow-action="${name}"]${value === undefined ? "" : `[data-value="${value}"]`}`);
const stage = value => page.waitForFunction(value => document.querySelector("#boardSvg").dataset.stage === value, value, { timeout: 60000 });
const manual = () => page.waitForFunction(() => document.querySelector("#boardSvg").getAttribute("aria-disabled") === "false" && document.querySelector("#boardSvg").getAttribute("aria-busy") === "false", null, { timeout: 60000 });
async function play(index) { await manual(); const point = page.locator(`#boardSvg [data-index="${index}"]`); await point.tap(); await point.tap(); }
async function selectRule(rule) { await page.locator("#simpleColor").tap(); await action("rule", rule).tap(); await stage("setup"); }
async function decide(choice) { await page.waitForFunction(({flow, choice}) => { const button = document.querySelector(flow + ' [data-choice="' + choice + '"]'); return button && !button.disabled; }, {flow, choice}, {timeout:60000}); await action("decision", choice).tap(); }
function pass(message) { console.log("PASS", message); }
try {
  await mkdir(output, { recursive: true });
  await page.goto(base + "renju.html?view=simple"); await stage("setup");
  assert.equal(await action("start").count(), 2); assert.equal(await page.locator("#boardSvg [data-stone]").count(), 0);
  if (!layoutOnly) {
  for (const opener of [0, 1]) for (const swap of ["keep", "swap"]) {
    await page.locator("#simpleRestart").tap(); await stage("setup"); await action("start", opener).tap();
    if (opener === 1) for (const index of [112, 97, 96]) await play(index);
    await stage("swap3");
    let s = await game(); assert.deepEqual(s.colors, [1, 2, 1]); assert.equal(s.moves.length, 3);
    assert.deepEqual(await page.locator(".opening-order").allTextContents(), ["1", "2", "3"]);
    if (opener === 0 && swap === "keep") await page.screenshot({ path: `${output}/ai-three.png` });
    await decide(swap);
    s = await game();
    if (s.actor === 1 && s.stage === "w4") await play(s.allowedMoves({ safe: true })[0]);
    // A user-owned fourth move is automatic; a user-owned offer is automatic too.
    const userBlack = (opener ^ Number(swap === "swap")) === 0;
    if (userBlack) await stage("choose");
    else {
      await stage("offer"); await manual();
      for (let i = 0; i < 2; i++) await play((await game()).allowedMoves({ safe: true })[0]);
    }
    if (userBlack) {
      await manual(); s = await game(); assert.equal(s.board.filter(Boolean).length, 4); assert.equal(s.candidates.length, 2);
      assert.deepEqual(await page.locator(".opening-proposal text").allTextContents(), ["A1", "A2"]);
      await page.screenshot({ path: `${output}/ai-candidates.png` });
      const selected = s.candidates[1]; await action("select", selected).tap(); await stage("w6");
      assert.equal(await page.locator('[data-order-number="5"]').textContent(), "A2");
      await play((await game()).allowedMoves({ safe: true })[0]);
    }
    await stage("play"); await manual(); s = await game();
    assert.equal(s.playerColor, userBlack ? 1 : 2); assert.equal(s.actor, 1); assert.equal(s.moves.length, userBlack ? 7 : 6);
    if (!userBlack) { assert.ok((await page.locator(flow).textContent()).includes("AI 选择 A")); assert.equal(s.colors[5], 2); }
    const openingRecord = await record(), before = s.moves.length;
    await play(s.allowedMoves({ safe: true })[0]); await manual(); s = await game();
    assert.equal(s.moves.length, before + 2); assert.equal(s.colors.at(-1), s.playerColor); assert.equal(s.events.at(-1).automatic, true);
    await page.locator("#simpleUndoButton").tap(); await manual(); assert.deepEqual(await record(), openingRecord);
    await page.reload(); await manual(); assert.deepEqual(await record(), openingRecord);
    assert.equal(await page.locator("dialog[open]").count(), 0);
    pass(`RIF opener=${opener}, swap=${swap}: B-W-B, automatic own actions, A1/A2, normal reply, undo and reload`);
  }

  for (const opener of [0, 1]) for (const route of ["normal", "ten"]) {
    await selectRule("taraguchi10"); await action("start", opener).tap();
    for (let guard = 0; guard < 45; guard++) {
      const s = await game(); if (s.stage === "play") break;
      if (s.decision) { await decide(s.stage === "route4" ? route === "ten" ? "ten" : "keep" : s.stage === "swap2" ? "swap" : "keep"); }
      else if (isAutomaticTurn(s)) {
        await page.waitForFunction(({stage, length}) => {
          const saved = JSON.parse(localStorage.getItem("gomoku-opening:/ai/:v1")).record;
          return document.querySelector("#boardSvg").dataset.stage !== stage || saved.events.length > length;
        }, { stage:s.stage, length:s.events.length }, { timeout:60000 });
      } else await play(s.stage === "choose" ? s.candidates.at(-1) : s.allowedMoves({ safe: true })[0]);
    }
    await stage("play"); await manual(); const s = await game(); assert.equal(s.actor, 1); assert.ok(s.moves.length >= 6);
    if (route === "ten") assert.equal(s.events.filter(event => event.type === "offer").length, 10);
    pass(`Taraguchi opener=${opener}, route=${route}: inline swaps, correct seat after swap, automatic own proposals/selection`);
  }

  await selectRule("renju"); await action("start", 0).tap();
  await play(112); await play(97); assert.equal((await game()).moves.length, 2);
  await action("handoff").tap(); await manual(); assert.equal((await game()).moves.length, 3);
  await page.locator("#simpleUndoButton").tap(); assert.equal((await game()).copilotReady, false);
  pass("Free Renju opening stays manual until inline handoff; undo restores handoff state");

  const board = new Uint8Array(225); for (const index of [109,110,111,113,114]) board[index] = 1;
  const seeded = new OpeningSession({ rule:"renju", workflow:"copilot", initialBlackSeat:1, seed:{ board, sideToMove:1 } });
  await page.evaluate(record => sessionStorage.setItem("qaOpeningFixture", JSON.stringify({ record, perspective:2 })), seeded.record()); await page.reload();
  await play(112); await action("forbidden", "cancel").tap(); assert.equal((await game()).board[112], 0);
  await play(112); await action("forbidden", "confirm").tap(); assert.equal((await game()).winner, 2);
  await page.locator("#simpleUndoButton").tap(); await manual(); assert.equal((await game()).winner, 0);
  pass("External forbidden-move confirmation and cancellation are inline, and undo restores the position");

  if (mocked) {
    await selectRule("rif"); await page.evaluate(() => { window.failNextSearch = true; }); await action("start", 0).tap();
    await action("retry").waitFor(); assert.equal((await game()).moves.length, 1);
    await action("retry").tap(); await stage("swap3"); assert.equal((await game()).moves.length, 3);
    pass("Failed automatic opening retries from the saved partial position without duplicate stones");
  }

  await selectRule("rif");
  }
  for (const [width, height] of [[260,420],[320,480],[360,740],[390,844],[820,1180],[1440,900],[320,240],[560,320],[844,390]]) {
    await page.setViewportSize({ width, height });
    for (const rulesOpen of [false, true]) {
      if (rulesOpen) await page.locator("#simpleColor").tap();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await page.evaluate(() => {
        const board = document.querySelector(".board-frame").getBoundingClientRect(), flow = document.querySelector("#simpleOpeningFlow").getBoundingClientRect(), controls = document.querySelector("#simpleControls").getBoundingClientRect();
        return { scrollX:document.documentElement.scrollWidth > innerWidth + 1, scrollY:document.documentElement.scrollHeight > innerHeight + 1, board:{ x:board.x, y:board.y, w:board.width, h:board.height }, flowBottom:flow.bottom, controlsBottom:controls.bottom, width:innerWidth, height:innerHeight };
      });
      assert.equal(layout.scrollX, false, `${width}x${height} horizontal, rules=${rulesOpen}`);
      assert.equal(layout.scrollY, false, `${width}x${height} vertical, rules=${rulesOpen}`);
      assert.ok(layout.board.w > 70 && layout.board.h > 70, JSON.stringify(layout));
      assert.ok(layout.board.x >= -1 && layout.board.y >= -1 && layout.board.x + layout.board.w <= width + 1 && layout.board.y + layout.board.h <= height + 1, JSON.stringify(layout));
      assert.equal(layout.width, width); assert.equal(layout.height, height);
      assert.ok(layout.controlsBottom <= height + 1 && layout.flowBottom <= height + 1, JSON.stringify(layout));
      if (rulesOpen) await action("rules", "close").tap();
    }
    if (width === 320 && height === 240) await page.screenshot({path:`${output}/small-window.png`});
  }
  pass("Nine small-window, phone, tablet, desktop and landscape viewports fit the board, inline choices and controls");
  assert.deepEqual(errors, []); assert.equal(await page.locator("dialog[open]").count(), 0);
  pass(layoutOnly ? "Simple-mode layout verified" : mocked ? "Browser flow verified with deterministic engine fixture (Rapfi strength/runtime not covered)" : "Browser flow verified with real Rapfi engine");
} catch (error) {
  console.error("FAILED STATE", JSON.stringify({ record:await record(), flow:await page.locator(flow).textContent(), notice:await page.locator("#gameNotice").textContent(), errors }));
  await page.screenshot({ path:`${output}/failure.png` }); throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
