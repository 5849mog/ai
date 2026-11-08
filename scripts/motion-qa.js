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
  assert.equal(await page.locator(".game-state").getAttribute("aria-atomic"), "true");
  await page.locator("#boardSvg").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator(".keyboard-cursor").getAttribute("data-keyboard-cursor"), "113");
  assert.equal(await page.locator(".keyboard-cursor text").textContent(), "I8");
  assert.match(await page.locator("#boardCursorStatus").textContent(), /I8，空点/);
  await page.keyboard.press("Home");
  assert.equal(await page.locator(".keyboard-cursor text").textContent(), "H8");
  assert.match(await page.locator("#boardSvg").getAttribute("aria-label"), /共 0 手.*当前选点 H8/);
  await page.locator("#recordMenu summary").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#recordMenu").getAttribute("open"), null);
  assert.equal(await page.locator("#recordMenu summary").evaluate(element => element === document.activeElement), true);
  await page.locator("#recordMenu summary").click();
  await page.locator(".board-toolbar").click();
  assert.equal(await page.locator("#recordMenu").getAttribute("open"), null);
  pass("keyboard cursor, Home, coordinate announcements, board context and menu dismissal");
  await page.locator("#timeSelect").selectOption("1000");
  await page.locator('[data-index="112"]').click();
  await page.locator('[data-impact="112"]').waitFor({ state: "attached" });
  assert.equal(await page.locator("#boardSvg").getAttribute("data-board-action"), "place");
  assert.equal(await page.locator("html").getAttribute("data-game-phase"), "thinking");
  assert.equal(await page.locator('[data-impact="112"] .impact-ring').count(), 1);
  await page.waitForTimeout(130);
  await page.screenshot({ path: "reports/motion-desktop-thinking.png", fullPage: true });
  await page.waitForFunction(() => document.querySelectorAll('#boardSvg [data-color="2"]').length === 1, undefined, { timeout: 20_000 });
  await ready(page);
  await page.waitForTimeout(700);
  assert.equal(await page.locator(".stone-impact").count(), 0);
  assert.match(await page.locator("#boardSvg").getAttribute("aria-label"), /共 2 手.*最后一手/);
  assert.match(await page.locator("#winRateBar").getAttribute("aria-valuetext"), /当前视角 \d+%，对方 \d+%/);
  pass("desktop placement, impact cleanup, AI thinking phase and automatic reply");

  await page.locator("#boardSvg").focus(); await page.keyboard.press("r");
  await page.waitForFunction(() => document.querySelectorAll("#boardSvg [data-recommendation]").length > 0, undefined, { timeout: 20_000 });
  await ready(page);
  const markerMotion = await page.locator("#boardSvg [data-recommendation]").first().evaluate(element => getComputedStyle(element).animationName);
  assert.equal(markerMotion, "candidateArrive");
  await page.screenshot({ path: "reports/motion-desktop-candidates.png", fullPage: true });
  pass("recommendations enter with ranked motion and remain readable");

  await page.locator("#boardSvg").focus(); await page.keyboard.press("u");
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
  assert.equal(await page.locator(".winning-ring").first().evaluate(element => getComputedStyle(element).animationName), "none");
  assert.equal(await page.locator(".winning-connector").first().evaluate(element => getComputedStyle(element).animationName), "none");
  pass("real five-in-a-row finale and reload restoration without false placement or entrance replays");
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const phone = await mobile.newPage(); watch(phone);
  await phone.goto(`${origin}/plain/`); await ready(phone);
  assert.ok(await phone.locator("#recordMenu summary").evaluate(element => element.getBoundingClientRect().height >= 44));
  assert.equal(await phone.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches), false);
  await phone.locator("#recordMenu summary").tap(); await phone.locator("#enterSimpleMode").tap();
  assert.ok(parseFloat(await phone.locator("#gameNotice").evaluate(element => getComputedStyle(element).bottom)) >= 104);
  await phone.locator('[data-index="112"]').tap();
  assert.equal(await phone.locator(".pending-stone").count(), 1);
  assert.equal(await phone.locator(".aim-guides").count(), 1);
  assert.equal(await phone.locator(".pending-ring").evaluate(element => getComputedStyle(element).animationName), "pendingOrbit");
  assert.match(await phone.locator("#stateText").textContent(), /再点一次确认 · H8/);
  assert.match(await phone.locator("#simpleUndoButton").getAttribute("aria-label"), /取消待确认落点 H8/);
  await phone.screenshot({ path: "reports/motion-mobile-pending.png", fullPage: true });
  await phone.locator("#simpleWinRate").tap();
  assert.equal(await phone.locator(".pending-stone").count(), 0);
  await phone.locator('[data-index="112"]').tap();
  await phone.keyboard.press("Escape");
  assert.equal(await phone.locator(".pending-stone").count(), 0);
  await phone.locator('[data-index="112"]').tap();
  await phone.locator('[data-index="112"]').tap();
  assert.equal(await phone.locator('[data-stone="112"]').count(), 1);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  pass("mobile two-tap confirmation, aiming motion and no horizontal overflow");
  await mobile.close();

  const contrast = await browser.newContext({ viewport: { width: 1280, height: 900 }, forcedColors: "active", serviceWorkers: "block" });
  const high = await contrast.newPage(); watch(high);
  await high.addInitScript(saved => localStorage.setItem("gomoku-opening:/plain/:v1", JSON.stringify(saved)), seeded);
  await high.goto(`${origin}/plain/`); await ready(high);
  assert.equal(await high.locator("[data-stone]").count(), 6);
  assert.equal(await high.locator(".stone-texture").first().evaluate(element => getComputedStyle(element).display), "none");
  const stoneFills = await high.locator("[data-stone]").evaluateAll(elements => elements.map(element => getComputedStyle(element).fill));
  assert.ok(new Set(stoneFills).size >= 2);
  await high.screenshot({ path: "reports/motion-forced-colors.png", fullPage: true });
  pass("forced-colors mode preserves both stone colors and grid without textures");
  await contrast.close();

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
