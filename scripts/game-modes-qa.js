import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createDevServer } from "./dev-server.js";
import { parseRecord } from "../game-record.js";

const server = await createDevServer({ port: 0, isolated: false });
const base = `http://127.0.0.1:${server.address().port}/ai/`;
const launchOptions = { headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  ...(process.env.CHROME_ARGS ? { args: JSON.parse(process.env.CHROME_ARGS) } : {}) };
let browser = await chromium.launch(launchOptions);
const report = { engine: "real Rapfi WASM, header-free hosting", checks: [], layouts: [], errors: [] };
const output = ".cache/game-modes-qa";
const ready = page => page.waitForFunction(() => document.querySelector("#stateText").textContent === "轮到你落子", null, { timeout: 30000 });
const position = page => page.locator("#boardSvg [data-stone]").evaluateAll(nodes => nodes.map(node => [Number(node.dataset.stone), Number(node.dataset.color)]));
const record = page => page.evaluate(() => JSON.parse(localStorage.getItem("gomoku-game:/ai/:v1")));
const mark = (name, details = {}) => { report.checks.push({ name, ...details }); console.log("PASS", name); };
async function menu(page, action) {
  await page.locator("#recordMenu summary").click(); await page.locator(action).click();
}
async function openSetup(page) { await menu(page, "#openSetup"); await page.waitForFunction(() => document.querySelector("#setupDialog").open); }
async function draft(page, black, white, side, actor) {
  await openSetup(page); await page.locator("#clearSetup").click();
  for (const [color, indices] of [[1, black], [2, white]]) {
    await page.locator(`[data-setup-tool="${color}"]`).click();
    for (const index of indices) await page.locator(`#setupBoard [data-index="${index}"]`).tap();
  }
  await page.locator("#setupSide").selectOption(String(side)); await page.locator("#setupActor").selectOption(actor);
}
async function begin(page) { await page.locator("#startSetup").click(); await page.waitForFunction(() => !document.querySelector("#setupDialog").open); }
async function play(page, index) {
  await page.locator(`#boardSvg [data-index="${index}"]`).tap();
  await page.locator(`#boardSvg [data-index="${index}"]`).tap(); await ready(page);
}
async function download(page, selector, filename) {
  await page.locator("#recordMenu summary").click();
  const pending = page.waitForEvent("download"); await page.locator(selector).click();
  const file = await pending; const path = `${output}/${filename}`; await file.saveAs(path);
  return readFile(path, "utf8");
}
try {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await context.addInitScript(() => {
    localStorage.setItem("gomoku-thinking-ms", "1000"); localStorage.setItem("gomoku-pondering", "false");
  });
  const page = await context.newPage(); page.on("pageerror", error => report.errors.push(error.message));
  await page.goto(base); await ready(page);
  await openSetup(page);
  await page.locator('#setupBoard [data-index="112"]').tap();
  await page.locator('[data-setup-tool="2"]').click(); await page.locator('#setupBoard [data-index="112"]').tap();
  assert.equal(await page.locator('#setupBoard [data-stone="112"]').getAttribute("data-color"), "2");
  await page.locator("#undoSetup").click();
  assert.equal(await page.locator('#setupBoard [data-stone="112"]').getAttribute("data-color"), "1");
  await page.locator('[data-setup-tool="0"]').click(); await page.locator('#setupBoard [data-index="112"]').tap();
  assert.equal(await page.locator("#setupBoard [data-stone]").count(), 0);
  await page.locator("#undoSetup").click(); await page.locator("#clearSetup").click(); await page.locator("#undoSetup").click();
  assert.equal(await page.locator("#setupBoard [data-stone]").count(), 1);
  await page.locator("#cancelSetup").click(); await ready(page);
  assert.deepEqual(await position(page), []);
  mark("draft replace, erase, undo, clear and cancel leave actual game untouched");

  await draft(page, [112, 114], [97], 1, "player");
  await page.screenshot({ path: `${output}/setup-phone.png` }); await begin(page); await ready(page);
  const initial = await record(page), seed = await position(page);
  assert.equal(initial.version, 2); assert.equal(initial.setup.sideToMove, 1); assert.equal(initial.playerColor, 1);
  assert.deepEqual(initial.moves, []); assert.equal(seed.length, 3);
  await play(page, 100); assert.equal((await record(page)).moves.length, 2);
  const beforeHints = await position(page);
  await page.locator("#recommendButton").click(); await ready(page);
  assert((await page.locator("[data-recommendation]").count()) >= 1); assert.deepEqual(await position(page), beforeHints);
  await page.locator("#undoButton").click(); await ready(page);
  assert.deepEqual(await position(page), seed); assert.deepEqual((await record(page)).moves, []);
  assert.equal(await page.locator("#positionContext").textContent(), "续下第 0 手");
  await page.reload(); await ready(page); assert.deepEqual(await position(page), seed);
  mark("arbitrary black-to-move setup continues, recommends, undoes only new moves and reloads");

  const json = await download(page, "#exportJson", "custom.gomoku.json"), sgf = await download(page, "#exportSgf", "custom.sgf");
  assert.deepEqual(parseRecord(json).record, initial); assert.deepEqual(parseRecord(sgf).record, initial);
  await page.locator("#restartButton").click(); await ready(page);
  assert.equal((await record(page)).version, 1); assert.deepEqual(await position(page), []);
  await page.locator("#recordFile").setInputFiles({ name: "custom.sgf", mimeType: "application/x-go-sgf", buffer: Buffer.from(sgf) });
  await page.waitForFunction(() => document.querySelector("#recordDialog").open);
  assert((await page.locator("#importSummary").textContent()).includes("自定义局面"));
  await page.locator("#confirmImport").click(); await ready(page);
  assert.deepEqual(await record(page), initial); assert.deepEqual(await position(page), seed);
  await draft(page, [108, 109, 110, 111, 112], [], 2, "ai");
  assert(await page.locator("#startSetup").isDisabled());
  assert((await page.locator("#setupMessage").textContent()).includes("五子相连"));
  await page.locator("#cancelSetup").click(); await ready(page); assert.deepEqual(await record(page), initial);
  mark("JSON and SGF retain setup and side; import restores them; terminal drafts cannot replace the game");

  for (const color of [1, 2]) {
    await draft(page, color === 1 ? [108, 109, 110, 111] : [107], color === 2 ? [108, 109, 110, 111] : [107], color, "ai");
    await begin(page);
    await page.waitForFunction(() => document.querySelector("#stateText").textContent === "AI 获胜");
    const saved = await record(page);
    assert.equal(saved.playerColor, 3 - color); assert.deepEqual(saved.moves, [112]);
    assert.equal((await position(page)).find(([index]) => index === 112)[1], color);
    await page.reload(); await page.waitForFunction(() => document.querySelector("#stateText").textContent === "AI 获胜");
    mark(`AI takes the explicitly chosen ${color === 1 ? "black" : "white"} turn and wins at the correct color`);
  }
  await draft(page, [112], [110, 111, 113], 2, "player"); await begin(page); await ready(page);
  const whiteSeed = await position(page);
  await page.locator("#ponderToggle").check();
  await page.waitForFunction(() => document.querySelector("#analysisState").textContent === "AI 后台思考中" && document.querySelector("#searchDepth").textContent !== "—");
  await page.locator("#recommendButton").click(); await ready(page);
  const selected = Number(await page.locator('#boardSvg [data-rank="1"]').getAttribute("data-recommendation"));
  await play(page, selected); assert.equal((await record(page)).moves.length, 2);
  await page.locator("#undoButton").click(); await ready(page); assert.deepEqual(await position(page), whiteSeed);
  await page.locator("#ponderToggle").uncheck();
  mark("human can begin as white with unequal counts; pondering, recommendation and full-round undo retain all seed stones");

  await draft(page, [112], [97, 113, 129], 1, "ai"); await begin(page);
  await page.waitForFunction(() => document.querySelector("#stateText").textContent === "AI 思考中");
  const waiting = await record(page); await openSetup(page); await page.waitForTimeout(1200);
  assert.deepEqual(await record(page), waiting); assert.deepEqual(waiting.moves, []);
  await page.locator("#cancelSetup").click(); await ready(page);
  assert.equal((await record(page)).moves.length, 1);
  mark("opening editor cancels active AI search; cancel resumes the correct turn once without stale moves");

  const retained = await position(page); await menu(page, "#enterSimpleMode");
  assert.deepEqual(await position(page), retained);
  assert.equal(await page.locator("button:visible").count(), 3); assert.equal(await page.locator("select:visible").count(), 0);
  if (await page.locator("#simpleRecommendButton").getAttribute("aria-pressed") === "true") await page.locator("#simpleRecommendButton").click();
  const beforeRecommendation = await position(page);
  await page.locator("#simpleRecommendButton").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-recommendation]").length > 0, null, { timeout: 15000 });
  assert.deepEqual(await position(page), beforeRecommendation);
  await page.locator("#simpleColor").click(); await ready(page);
  assert.equal(await page.locator("#simpleColorLabel").textContent(), "你执黑"); assert.deepEqual(await position(page), []);
  await page.locator("#simpleColor").click(); await ready(page);
  assert.equal(await page.locator("#simpleColorLabel").textContent(), "AI 执黑"); assert.equal((await position(page)).length, 1);
  await page.locator("#simpleColor").click(); await ready(page); await play(page, 112);
  const afterPlay = await position(page);
  await page.reload(); await ready(page); assert(await page.locator("body").evaluate(body => body.classList.contains("simple-mode")));
  assert.deepEqual(await position(page), afterPlay);
  const button = await page.locator("#simpleRestart").boundingBox();
  const touch = await context.newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: button.x + button.width / 2, y: button.y + button.height / 2 }] });
  await page.waitForTimeout(850);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.detach();
  await page.waitForFunction(() => !document.body.classList.contains("simple-mode"));
  assert.deepEqual(await position(page), afterPlay);
  await menu(page, "#enterSimpleMode"); await page.goBack();
  await page.waitForFunction(() => !document.body.classList.contains("simple-mode"));
  assert.deepEqual(await position(page), afterPlay);
  await menu(page, "#enterSimpleMode"); await page.locator("#simpleRestart").tap(); await ready(page);
  assert.deepEqual(await position(page), []);
  mark("simple mode shows three buttons, recommends with one tap, toggles roles directly, restores on reload, and exits without changing game");
  await context.close();

  for (const [width, height] of [[320, 568], [390, 700], [390, 844], [667, 375], [768, 1024], [820, 1180], [1024, 768], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", hasTouch: true, reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("gomoku-pondering", "false"));
    const page = await context.newPage(); page.on("pageerror", error => report.errors.push(error.message));
    await page.goto(base); await ready(page);
    const normal = await page.locator(".board-wrap > .board-frame").boundingBox();
    await menu(page, "#enterSimpleMode");
    const simple = await page.locator(".board-wrap > .board-frame").boundingBox();
    assert(simple.width > normal.width, `simple board not larger at ${width}x${height}: ${simple.width} vs ${normal.width}`);
    const bounds = await page.evaluate(() => ({ x: document.documentElement.scrollWidth, y: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight }));
    assert(bounds.x <= bounds.w && bounds.y <= bounds.h, `page overflow at ${width}x${height}`);
    assert.equal(await page.locator("button:visible").count(), 3);
    await page.screenshot({ path: `${output}/simple-${width}-${height}.png` });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.body.classList.contains("simple-mode"));
    assert.deepEqual(await page.locator(".board-wrap > .board-frame").boundingBox(), normal);
    await openSetup(page);
    const editor = await page.locator("#setupBoard").boundingBox();
    const fits = await page.locator("#setupDialog").evaluate(dialog => dialog.scrollHeight <= dialog.clientHeight && dialog.scrollWidth <= dialog.clientWidth);
    assert(fits, `editor overflow at ${width}x${height}`); assert(editor.width > 0 && editor.height > 0);
    if (width === 768 || width === 1440) await page.screenshot({ path: `${output}/setup-${width}.png` });
    await page.locator("#cancelSetup").click();
    report.layouts.push({ width, height, normalBoard: normal.width, simpleBoard: simple.width, editorBoard: editor.width, oneScreen: true });
    await context.close(); console.log(`LAYOUT ${width}x${height}: ${normal.width.toFixed(1)} → ${simple.width.toFixed(1)}`);
  }
  await browser.close(); browser = await chromium.launch(launchOptions);
  const offline = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  offline.on("pageerror", error => report.errors.push(error.message));
  await offline.addInitScript(() => { localStorage.setItem("gomoku-thinking-ms", "1000"); localStorage.setItem("gomoku-pondering", "false"); });
  await offline.goto(base); await ready(offline);
  await offline.waitForFunction(() => navigator.serviceWorker.controller);
  const cached = await offline.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const name = (await caches.keys()).find(key => key.endsWith("250615-v27"));
    const cache = await caches.open(name);
    return { cache: name, ready: (await Promise.all(["setup-ui.js", "display-modes.js", "game-modes.css?v=4", "opening.css?v=3", "analysis-view.js"].map(path => cache.match(new URL(path, location.href).href)))).every(Boolean) };
  });
  assert(cached.ready); await offline.context().setOffline(true); await offline.reload(); await ready(offline);
  await draft(offline, [112], [97, 113], 2, "player"); await begin(offline); await ready(offline);
  assert.equal((await record(offline)).version, 2);
  await menu(offline, "#enterSimpleMode"); await offline.reload(); await ready(offline);
  assert.equal(await offline.locator("button:visible").count(), 3); assert.equal((await position(offline)).length, 3);
  mark("v27 caches mode UI; custom setup and simple-mode resume work offline", cached);
  assert.deepEqual(report.errors, []);
  report.browser = browser.version();
  await writeFile("reports/game-modes-qa.json", JSON.stringify(report, null, 2) + "\n");
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
