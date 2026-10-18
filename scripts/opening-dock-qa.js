import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createDevServer } from "./dev-server.js";
import { OpeningSession } from "../opening-session.js";
import { APP_VERSION } from "../app-release.js";

// Deterministic engine isolates layout and input checks. Actual Rapfi opening
// sequencing is separately covered by opening-flow-qa.js without --mock-engine.
const fixture = `export class GomokuEngine {
  constructor(options) { Object.assign(this, options); this.ready = false; }
  async init() { this.ready = true; this.onState({ state: 'ready' }); }
  cancel() {} stopPonder() {} reset() { this.ready = false; }
  async ponder() {}
}`;
function until(rule, stage) {
  const s = new OpeningSession({ rule, workflow: "follow", initialBlackSeat: 0 });
  for (let n = 0; s.stage !== stage && n < 30; n++) {
    s.apply(s.decision ? { type: "decision", choice: "keep" }
      : { type: s.offerCount ? "offer" : "stone", index: s.allowedMoves({ safe: true })[0] });
  }
  assert.equal(s.stage, stage); return s;
}
const two = until("rif", "offer");
while (two.offerCount) two.apply({ type: "offer", index: two.allowedMoves({ safe: true })[0] });
const ten = until("taraguchi10", "route4"); ten.apply({ type: "decision", choice: "ten" });
while (ten.offerCount) ten.apply({ type: "offer", index: ten.allowedMoves({ safe: true })[0] });
const overline = Array(225).fill(0); for (const i of [109, 110, 111, 113, 114]) overline[i] = 1;
const finished = new OpeningSession({rule:"freestyle",workflow:"follow",initialBlackSeat:0});
for (const index of [0,15,1,16,2,17,3,18,4]) finished.apply({type:"stone",index});
const scenarios = [
  ["role", new OpeningSession({ rule: "rif", initialBlackSeat: null })],
  ["swap", until("rif", "swap3")],
  ["route", until("taraguchi10", "route4")],
  ["offer", until("rif", "offer")],
  ["choose-two", two], ["choose-ten", ten],
  ["handoff", new OpeningSession({ rule: "renju", workflow: "copilot", initialBlackSeat: 1 })],
  ["play", new OpeningSession({ rule: "renju", workflow: "follow", initialBlackSeat: 0 })],
  ["forbidden", new OpeningSession({ rule: "renju", workflow: "copilot", initialBlackSeat: 1, seed: { board: overline, sideToMove: 1 } })],
  ["finished", finished],
];
const sizes = [[260, 420], [320, 480], [360, 640], [390, 844], [240, 320], [320, 240], [480, 320], [560, 320], [844, 390], [768, 1024], [820, 1180], [1440, 900]];
const server = await createDevServer({ port: 0, isolated: false });
const base = `http://127.0.0.1:${server.address().port}/ai/renju.html`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: JSON.parse(process.env.CHROME_ARGS || "[]") });
const context = await browser.newContext({ hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage(), errors = [], report = { version: APP_VERSION, method: "Actual page and touch input, deterministic engine fixture for layout only", layouts: [], checks: [] };
page.on("pageerror", e => errors.push(e.message));
await page.route(/\/engine\.js(?:\?.*)?$/, route => route.fulfill({ contentType: "text/javascript", body: fixture }));
await page.addInitScript(() => {
  const record = sessionStorage.getItem("dock-fixture");
  if (record) { localStorage.setItem("gomoku-opening:/ai/:v1", JSON.stringify({ record: JSON.parse(record), perspective: 1 })); sessionStorage.removeItem("dock-fixture"); }
  localStorage.setItem("gomoku-pondering", "false");
});
const settle = () => page.evaluate(() => new Promise(resolve => { let n = 0; const tick = () => ++n === 5 ? resolve() : requestAnimationFrame(tick); requestAnimationFrame(tick); }));
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("gomoku-opening:/ai/:v1")).record);
const action = (type, value) => page.locator(`#simpleOpeningFlow [data-flow-action="${type}"]${value === undefined ? "" : `[data-value="${value}"]`}`);
async function load(session) {
  await page.evaluate(record => sessionStorage.setItem("dock-fixture", JSON.stringify(record)), session.record());
  await page.goto(base + "?view=simple"); await settle();
}
try {
  await mkdir(".cache/opening-dock", { recursive: true });
  await page.goto(base + "?view=simple");
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const [name, session] of scenarios) {
      await load(session);
      if (name === "forbidden") {
        await page.locator('#boardSvg [data-index="112"]').tap(); await page.locator('#boardSvg [data-index="112"]').tap();
        await action("forbidden", "cancel").waitFor();
      }
      await settle();
      const layout = await page.evaluate(() => {
        const svg = document.querySelector("#boardSvg"), dock = document.querySelector("#simpleOpeningFlow");
        const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const points = Array.from({ length: 225 }, (_, i) => { const p = svg.createSVGPoint(); p.x = 46 + i % 15 * 528 / 14; p.y = 46 + Math.floor(i / 15) * 528 / 14; return p.matrixTransform(svg.getScreenCTM()); });
        const reachable = points.every(p => document.elementFromPoint(p.x, p.y)?.closest("#boardSvg") === svg);
        return { board: rect(svg.parentElement), dock: rect(dock), placement: dock.dataset.placement, points: points.length, reachable,
          scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], dockOverflow: dock.scrollHeight > dock.clientHeight + 1 };
      });
      for (const r of [layout.board, layout.dock]) assert.ok(r.x >= -.5 && r.y >= -.5 && r.right <= width + .5 && r.bottom <= height + .5, `${name} ${width}x${height} clipped: ${JSON.stringify(layout)}`);
      assert.ok(layout.board.width >= 80, `${name}: unusable board`);
      assert.ok(layout.dock.bottom <= layout.board.y - 5 || layout.dock.x >= layout.board.right + 5, `${name}: dock covers board`);
      assert.equal(layout.points, 225); assert.ok(layout.reachable, `${name}: obscured board intersection`);
      assert.ok(layout.scroll[0] <= width + 1 && layout.scroll[1] <= height + 1, `${name}: page scroll`);
      assert.equal(layout.dockOverflow, false, `${name} ${width}x${height}: ordinary choices require scrolling`);
      report.layouts.push({ name, width, height, ...layout });
      if ((width === 390 || width === 320 && height === 240) && ["swap", "route", "choose-two"].includes(name)) await page.screenshot({ path: `.cache/opening-dock/${name}-${width}x${height}.png` });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await load(until("rif", "swap3")); const before = await saved();
  await action("decision", "swap").tap();
  assert.equal((await saved()).events.at(-1).choice, "swap");
  assert.equal(await page.locator("#boardSvg [data-stone]").count(), 3, "decision tap must not place a stone");
  await page.locator("#simpleUndoButton").tap(); assert.deepEqual(await saved(), before);
  await page.reload(); await settle(); assert.equal(await action("decision").count(), 2);
  await action("decision", "keep").focus(); await page.keyboard.press("Enter"); assert.equal((await saved()).events.at(-1).choice, "keep");
  report.checks.push("Touch and keyboard swap decisions, correct persisted events, undo and reload, no accidental board placement");
  await load(two); await action("select", two.candidates[1]).tap();
  assert.equal((await saved()).events.at(-1).index, two.candidates[1]);
  assert.equal(await page.locator("#boardSvg [data-stone]").count(), 5);
  report.checks.push("Candidate button selects the exact fifth stone");
  await load(until("taraguchi10", "route4")); await action("decision", "ten").tap();
  assert.equal(await page.locator("#boardSvg").getAttribute("data-stage"), "offer10");
  report.checks.push("Ten-proposal route keeps the correct rule state");
  await load(scenarios.find(([n]) => n === "play")[1]);
  for (const i of [0, 224]) { await page.locator(`#boardSvg [data-index="${i}"]`).tap(); await page.locator(`#boardSvg [data-index="${i}"]`).tap(); }
  assert.deepEqual((await saved()).events.map(e => e.index), [0, 224]);
  report.checks.push("Both opposite corner intersections remain usable with touch confirmation");
  const position = await saved();
  await page.goto(base + "?view=full"); await settle(); assert.equal(await page.locator("#simpleOpeningFlow").isVisible(), false);
  assert.ok(await page.locator("#openingFlow").isVisible()); assert.deepEqual(await saved(), position);
  await page.goto(base + "?view=simple"); await settle();
  for (const size of [[844, 390], [390, 844], [320, 240], [390, 844]]) { await page.setViewportSize({ width: size[0], height: size[1] }); await settle(); }
  const frames = await page.evaluate(() => new Promise(resolve => { const samples = []; const next = () => { const r = document.querySelector(".board-frame").getBoundingClientRect(); samples.push([r.x, r.y, r.width]); samples.length === 30 ? resolve(samples) : requestAnimationFrame(next); }; next(); }));
  assert.ok(frames.every(f => f.every((v, i) => Math.abs(v - frames[0][i]) < .5)), "layout keeps moving after orientation change");
  report.checks.push("Full/simple switching and repeated orientation changes settle without moving the board");
  assert.deepEqual(errors, []); report.passed = true; report.completedAt = new Date().toISOString();
  await writeFile(".cache/opening-dock/result.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, layouts: report.layouts.length, checks: report.checks }));
} catch (error) {
  await page.screenshot({ path: ".cache/opening-dock/failure.png" }); throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
