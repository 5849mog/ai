import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createDevServer } from "./dev-server.js";
import { APP_VERSION } from "../app-release.js";

const server = await createDevServer({ port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox"] });
const report = { version: APP_VERSION, browser: browser.version(), checks: [], errors: [] };
const pass = (name, detail = {}) => { report.checks.push({ name, ...detail }); console.log("PASS", name); };
const ready = page => page.waitForFunction(() => document.querySelector("#boardSvg")?.getAttribute("aria-disabled") === "false" && document.documentElement.dataset.gamePhase === "ready", undefined, { timeout: 30_000 });
const watch = page => page.on("pageerror", error => report.errors.push(error.message));

try {
  await mkdir("reports", { recursive: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const page = await desktop.newPage(); watch(page);
  await page.goto(`${origin}/plain/`); await ready(page);
  await page.waitForFunction(() => document.querySelectorAll("#boardSvg [data-hint]").length === 3, undefined, { timeout: 30_000 });
  const hintMotion = await page.locator("#boardSvg [data-hint]").evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName));
  assert.ok(hintMotion.every(name => name === "none"));
  pass("live hint rerenders stay stable without entrance or rank flicker");
  await page.locator("#timeSelect").selectOption("1000");
  await page.locator('[data-index="112"]').click();
  await page.locator('[data-impact="112"]').waitFor({ state: "attached" });
  assert.equal(await page.locator("#boardSvg").getAttribute("data-board-action"), "place");
  assert.equal(await page.locator("html").getAttribute("data-game-phase"), "thinking");
  await page.waitForTimeout(130);
  await page.screenshot({ path: "reports/motion-desktop-thinking.png", fullPage: true });
  await page.waitForFunction(() => document.querySelectorAll('#boardSvg [data-color="2"]').length === 1, undefined, { timeout: 20_000 });
  await ready(page);
  await page.waitForTimeout(700);
  assert.equal(await page.locator(".stone-impact").count(), 0);
  const persistentRingMotion = await page.locator(".last-ring, .answer-ring").evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName));
  assert.ok(persistentRingMotion.every(name => name === "none"));
  pass("desktop placement, impact cleanup, stable rings, AI thinking phase and automatic reply");

  await page.locator("#recommendButton").click();
  await page.waitForFunction(() => document.querySelectorAll("#boardSvg [data-recommendation]").length > 0, undefined, { timeout: 20_000 });
  await ready(page);
  const markerMotion = await page.locator("#boardSvg [data-recommendation]").first().evaluate(element => getComputedStyle(element).animationName);
  assert.equal(markerMotion, "candidateArrive");
  await page.screenshot({ path: "reports/motion-desktop-candidates.png", fullPage: true });
  pass("recommendations enter with ranked motion and remain readable");

  await page.locator("#undoButton").click();
  await page.locator(".removed-stone").first().waitFor({ state: "attached" });
  assert.equal(await page.locator("#boardSvg").getAttribute("data-board-action"), "undo");
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".removed-stone").count(), 0);
  pass("undo removes the actual prior stones with bounded recovery ghosts");

  await page.locator("#restartButton").click();
  assert.equal(await page.locator("[data-stone]").count(), 0);
  assert.equal(await page.locator(".removed-stone").count(), 0);
  assert.equal(await page.locator("#boardSvg").getAttribute("data-board-action"), "reset");
  const start = page.locator('#openingFlow [data-flow-action="start"][data-value="0"]');
  if (await start.count()) await start.click();
  await ready(page);
  const seeded = await page.evaluate(async () => {
    const { OpeningSession } = await import("./opening-session.js");
    const board = new Uint8Array(225);
    for (const index of [105, 106, 107, 108]) board[index] = 1;
    board[82] = 2; board[97] = 2;
    const session = new OpeningSession({ rule: "freestyle", workflow: "follow", seed: { board, sideToMove: 1 } });
    return { unified: true, record: session.record(), perspective: 1 };
  });
  await page.addInitScript(saved => {
    if (sessionStorage.getItem("motion-seed-applied")) return;
    localStorage.setItem("gomoku-opening:/plain/:v1", JSON.stringify(saved));
    sessionStorage.setItem("motion-seed-applied", "1");
  }, seeded);
  await page.reload(); await ready(page);
  assert.equal(await page.locator("[data-stone]").count(), 6);
  assert.equal(await page.locator(".stone-impact").count(), 0);
  await page.locator('[data-index="109"]').click();
  await page.waitForFunction(() => document.querySelector("#boardSvg")?.dataset.phase === "finished");
  assert.ok(await page.locator(".winning-ring").count() >= 5);
  assert.equal(await page.locator(".winning-connector").first().evaluate(element => getComputedStyle(element).animationName), "victoryDraw");
  await page.waitForTimeout(360);
  await page.screenshot({ path: "reports/motion-desktop-victory.png", fullPage: true });
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#boardSvg")?.dataset.phase === "finished");
  assert.equal(await page.locator(".stone-impact").count(), 0);
  assert.equal(await page.locator("#boardSvg").getAttribute("data-board-action"), "initial");
  pass("real five-in-a-row finale and reload restoration without false placement");
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const phone = await mobile.newPage(); watch(phone);
  await phone.goto(`${origin}/plain/`); await ready(phone);
  const center = await phone.locator('[data-index="112"]').boundingBox();
  await phone.touchscreen.tap(center.x + center.width / 2, center.y + center.height / 2);
  assert.equal(await phone.locator(".pending-stone").count(), 1);
  assert.equal(await phone.locator(".aim-guides").count(), 1);
  assert.equal(await phone.locator(".pending-ring").evaluate(element => getComputedStyle(element).animationName), "pendingOrbit");
  await phone.screenshot({ path: "reports/motion-mobile-pending.png", fullPage: true });
  await phone.touchscreen.tap(center.x + center.width / 2, center.y + center.height / 2);
  assert.equal(await phone.locator('[data-stone="112"]').count(), 1);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  pass("mobile two-tap confirmation, aiming motion and no horizontal overflow");
  await mobile.close();

  const reduced = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const quiet = await reduced.newPage(); watch(quiet);
  await quiet.goto(`${origin}/plain/`); await ready(quiet);
  await quiet.locator('[data-index="112"]').click();
  assert.equal(await quiet.locator(".stone-impact").count(), 0);
  assert.equal(await quiet.locator("#boardSvg").getAttribute("data-board-action"), "reduced");
  assert.equal(await quiet.evaluate(() => document.getAnimations().length), 0);
  pass("reduced-motion mode disables both CSS and Web Animations effects");
  await reduced.close();
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack; process.exitCode = 1; console.error(error);
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile("reports/motion-qa.json", JSON.stringify(report, null, 2) + "\n");
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
