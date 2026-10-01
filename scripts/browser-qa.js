import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { createDevServer } from "./dev-server.js";
import { TACTICS, verifyTactic } from "../tests/fixtures/tactics.js";

await mkdir("reports", { recursive: true });
const server = await createDevServer({ port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { startedAt: new Date().toISOString(), checks: [], tactics: [] };
const browsers = [];
const waitReady = page => page.waitForFunction(() => document.querySelector("#stateText")?.textContent === "轮到你落子", undefined, { timeout: 30_000 });
const stones = (page, color) => page.locator(`[data-color="${color}"]`).count();
const freeIndex = page => page.evaluate(() => {
  const occupied = new Set([...document.querySelectorAll("[data-stone]")].map(node => Number(node.dataset.stone)));
  return [...document.querySelectorAll("[data-index]")].map(node => Number(node.dataset.index)).find(index => !occupied.has(index));
});
function passed(name, detail = {}) { report.checks.push({ name, passed: true, ...detail }); console.log("PASS", name); }

try {
  for (const channel of ["chrome", "msedge"]) {
    const browser = await chromium.launch({ channel, headless: true });
    browsers.push(browser);
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`${origin}/ai/tests/engine-harness.html`);
    for (const variant of ["rapfi-single-simd128", "rapfi-multi-simd128", "rapfi-single", "rapfi-multi"]) {
      const result = await page.evaluate(async variant => {
        const { GomokuEngine } = await import("../engine.js");
        const engine = new GomokuEngine({ variant, threads: 4 });
        try {
          const ready = await engine.init();
          const board = new Uint8Array(225); board[112] = 1;
          const original = [...board];
          const move = await engine.search({ board, sideToMove: 2, timeMs: 200, requestId: 1 });
          return { ready, move, unchanged: JSON.stringify([...board]) === JSON.stringify(original) };
        } finally { engine.dispose(); }
      }, variant);
      assert.ok(result.unchanged);
      assert.ok(result.move.index >= 0 && result.move.index < 225 && result.move.index !== 112);
      assert.equal(result.ready.threads, variant.includes("multi") ? 4 : 1);
      assert.equal(result.move.evaluator, "mix9svq");
      assert.ok(result.move.weight.endsWith("mix9svqfreestyle_bsmix.bin.lz4"));
      passed(`${channel}: ${variant}`, { browser: browser.version(), move: result.move });
    }
    if (channel === "chrome") {
      await page.evaluate(async () => {
        const { GomokuEngine } = await import("../engine.js");
        globalThis.tacticalEngine = new GomokuEngine({ variant: "rapfi-single-simd128" });
        await tacticalEngine.init();
      });
      let id = 0;
      for (const fixture of TACTICS) {
        const proof = verifyTactic(fixture);
        const move = await page.evaluate(async job => await tacticalEngine.search(job),
          { board: fixture.board, sideToMove: fixture.sideToMove, timeMs: 10_000, requestId: ++id });
        assert.ok(proof.expected.includes(move.index), `${fixture.id}: ${move.index}, expected ${proof.expected}`);
        report.tactics.push({ id: fixture.id, passed: true, ...proof, result: move });
      }
      await page.evaluate(() => tacticalEngine.dispose());
      passed("all 12 independently proven tactical positions");
    }
    assert.deepEqual(pageErrors, []);
    await context.close();

    for (const prefix of ["ai", "plain"]) {
      const ui = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await ui.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.engineWorkerCreations = 0;
        window.Worker = class extends NativeWorker {
          constructor(url, options) { super(url, options); if (String(url).endsWith("/engine.worker.js")) window.engineWorkerCreations++; }
        };
      });
      const game = await ui.newPage();
      const errors = [];
      game.on("pageerror", error => errors.push(error.message));
      await game.goto(`${origin}/${prefix}/`);
      await waitReady(game);
      assert.equal(await game.evaluate(() => crossOriginIsolated), prefix === "ai");
      assert.equal(await game.locator("#timeSelect").inputValue(), "10000");
      await game.locator("#timeSelect").selectOption("5000");
      await game.reload();
      await waitReady(game);
      assert.equal(await game.locator("#timeSelect").inputValue(), "5000");
      await game.locator("#timeSelect").selectOption("1000");
      await game.reload();
      await waitReady(game);
      assert.equal(await game.locator("#timeSelect").inputValue(), "1000");
      await game.locator('[data-index="112"]').hover();
      assert.equal(await game.locator(".hover-stone").count(), 1);
      await game.locator('[data-index="112"]').click();
      assert.equal(await stones(game, 1), 1);
      await game.waitForFunction(() => document.querySelectorAll('[data-color="2"]').length === 1, undefined, { timeout: 15_000 });
      await waitReady(game);
      const workerCount = await game.evaluate(() => engineWorkerCreations);
      await game.locator(`[data-index="${await freeIndex(game)}"]`).click();
      await game.waitForFunction(() => document.querySelectorAll('[data-color="2"]').length === 2, undefined, { timeout: 15_000 });
      await waitReady(game);
      assert.equal(await stones(game, 1), 2);
      assert.equal(await game.evaluate(() => engineWorkerCreations), workerCount);
      if (channel === "chrome" && prefix === "ai") await game.screenshot({ path: "reports/desktop.png", fullPage: true });
      const free = await freeIndex(game);
      await game.locator(`[data-index="${free}"]`).click();
      assert.equal(await game.locator("#timeSelect").isDisabled(), true);
      assert.equal(await game.locator("#undoButton").isDisabled(), false);
      assert.equal(await game.evaluate(() => engineWorkerCreations), workerCount);
      await game.locator("#undoButton").click();
      await waitReady(game);
      assert.equal(await stones(game, 1), 2); assert.equal(await stones(game, 2), 2);
      await game.waitForTimeout(800);
      assert.equal(await stones(game, 2), 2);
      await game.locator(`[data-index="${free}"]`).click();
      await game.locator("#restartButton").click();
      await waitReady(game);
      assert.equal(await game.locator("[data-stone]").count(), 0);
      await game.waitForTimeout(800);
      assert.equal(await game.locator("[data-stone]").count(), 0);
      await game.locator("#boardSvg").focus();
      await game.keyboard.press("ArrowRight"); await game.keyboard.press("Enter");
      assert.equal(await stones(game, 1), 1);
      await game.locator("#undoButton").click();
      await waitReady(game);
      assert.equal(await game.locator("[data-stone]").count(), 0);
      await game.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 30_000 });
      await ui.setOffline(true);
      await game.reload();
      await waitReady(game);
      await game.locator('[data-index="112"]').click();
      await game.waitForFunction(() => document.querySelectorAll('[data-color="2"]').length === 1, undefined, { timeout: 15_000 });
      await game.goto(`${origin}/${prefix}/about.html`);
      assert.equal(await game.title(), "关于五目");
      const license = await game.goto(`${origin}/${prefix}/engine/rapfi-250615/NOTICE-Dependencies.txt`);
      assert.ok(license.ok());
      assert.ok((await game.locator("body").innerText()).includes("Emscripten-3.1.64"));
      assert.deepEqual(errors, []);
      passed(`${channel}: /${prefix}/ mouse, keyboard, preference, consecutive rounds, worker reuse, undo/restart while thinking, offline game and licenses`);
      await ui.close();
    }

    if (channel === "chrome") {
      const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const mobile = await touch.newPage();
      await mobile.goto(`${origin}/plain/`); await waitReady(mobile);
      const box = await mobile.locator('[data-index="112"]').boundingBox();
      await mobile.touchscreen.tap(box.x + box.width/2, box.y + box.height/2);
      assert.equal(await stones(mobile, 1), 0); assert.equal(await mobile.locator(".pending-stone").count(), 1);
      await mobile.screenshot({ path: "reports/mobile.png", fullPage: true });
      await mobile.touchscreen.tap(box.x + box.width/2, box.y + box.height/2);
      assert.equal(await stones(mobile, 1), 1);
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      passed("mobile: two-tap confirmation and no horizontal overflow");
      await touch.close();

      const fault = await browser.newContext({ serviceWorkers: "block" });
      const failed = await fault.newPage();
      await fault.route("**/engine/rapfi-250615/rapfi-*.js", route => route.abort());
      await failed.goto(`${origin}/ai/`);
      await failed.waitForFunction(() => !document.querySelector("#retryButton").hidden);
      assert.equal(await failed.locator("[data-stone]").count(), 0);
      await fault.unroute("**/engine/rapfi-250615/rapfi-*.js");
      await failed.locator("#retryButton").click(); await waitReady(failed);
      passed("engine load failure and successful retry");
      await fault.close();

      const searchFault = await browser.newContext({ serviceWorkers: "block" });
      await searchFault.addInitScript(() => {
        const NativeWorker = window.Worker;
        let failOnce = true;
        window.Worker = class extends NativeWorker {
          postMessage(data, ...args) {
            if (data.type === "search" && failOnce) {
              failOnce = false;
              queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "error", requestId: data.requestId, message: "injected search failure" } })));
            } else super.postMessage(data, ...args);
          }
        };
      });
      const failGame = await searchFault.newPage();
      await failGame.goto(`${origin}/plain/`); await waitReady(failGame);
      await failGame.locator('[data-index="112"]').click();
      await failGame.waitForFunction(() => !document.querySelector("#retryButton").hidden);
      assert.equal(await stones(failGame, 1), 1); assert.equal(await stones(failGame, 2), 0);
      await failGame.locator("#retryButton").click();
      await failGame.waitForFunction(() => document.querySelectorAll('[data-color="2"]').length === 1, undefined, { timeout: 20_000 });
      assert.equal(await stones(failGame, 1), 1);
      passed("search failure preserves the board and retry continues the same turn");
      await searchFault.close();

      const scopes = await browser.newContext();
      const scopedPage = await scopes.newPage();
      for (const prefix of ["ai", "plain"]) {
        await scopedPage.goto(`${origin}/${prefix}/`); await waitReady(scopedPage);
        await scopedPage.waitForFunction(() => document.querySelector("#offlineState").textContent === "已缓存 · 可离线使用");
      }
      const cacheNames = await scopedPage.evaluate(() => caches.keys());
      assert.ok(cacheNames.some(name => name.startsWith("gomoku-rapfi:/ai/:")));
      assert.ok(cacheNames.some(name => name.startsWith("gomoku-rapfi:/plain/:")));
      await scopes.setOffline(true);
      for (const prefix of ["ai", "plain"]) {
        await scopedPage.goto(`${origin}/${prefix}/`); await waitReady(scopedPage);
      }
      passed("service worker caches coexist across subdirectory scopes and both reload offline");
      await scopes.close();
    }
  }
  report.completedAt = new Date().toISOString();
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack; process.exitCode = 1; console.error(error);
} finally {
  await writeFile("reports/browser-qa.json", JSON.stringify(report, null, 2) + "\n");
  for (const browser of browsers) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
