import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { createDevServer } from "./dev-server.js";

const server = await createDevServer({ port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`;
const browsers = [];
const runtime = await readFile("tests/fixtures/rapfi-protocol-double.js", "utf8");
const report = { startedAt: new Date().toISOString(), device: `${os.platform()} ${os.arch()}; ${os.cpus()[0]?.model}`,
  engine: "Rapfi 250615 / mix9svq freestyle", recommendationBudgetMs: 1000, checks: [] };
const ready = page => page.waitForFunction(() => document.querySelector("#stateText")?.textContent === "轮到你落子", undefined, { timeout: 30_000 });
const markers = page => page.locator("[data-recommendation]").count();
const stones = page => page.locator("[data-stone]").count();
const position = page => page.locator("[data-stone]").evaluateAll(nodes => nodes.map(node => [node.dataset.stone, node.dataset.color]));
function passed(name, detail = {}) { console.log("PASS", name); report.checks.push({ name, ...detail }); }
async function recommend(page) {
  await page.locator("#recommendButton").click();
  await ready(page);
  await page.waitForFunction(() => document.querySelectorAll("[data-recommendation]").length > 0);
}
async function testContext(browser, options = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...options });
  await ctx.route("**/engine/rapfi-250615/rapfi-*.js", route => route.fulfill({ contentType: "text/javascript", body: runtime }));
  await ctx.addInitScript(() => {
    localStorage.setItem("gomoku-pondering", "false");
    localStorage.setItem("gomoku-thinking-ms", "1000");
  });
  return ctx;
}

try {
  await mkdir(".cache/recommendation-qa", { recursive: true });
  await mkdir("reports", { recursive: true });
  for (const channel of ["chrome", "msedge"]) {
    const browser = await chromium.launch({ channel, headless: true }); browsers.push(browser);
    const harnessContext = await browser.newContext({ serviceWorkers: "block" });
    const harness = await harnessContext.newPage();
    await harness.goto(`${origin}/ai/tests/engine-harness.html`);
    for (const variant of ["rapfi-single-simd128", "rapfi-single", "rapfi-multi-simd128", "rapfi-multi"]) {
      const result = await harness.evaluate(async variant => {
        const { GomokuEngine } = await import("../engine.js");
        let workers = 0;
        const engine = new GomokuEngine({ variant, threads: 2,
          workerFactory: () => { workers++; return new Worker(new URL("../engine.worker.js", location.href)); } });
        try {
          const blank = new Uint8Array(225);
          const opening = await engine.search({ board: blank, sideToMove: 1, timeMs: 1000, requestId: 1, multiPV: 2 });
          const board = new Uint8Array(225); board[112] = 1;
          const original = [...board];
          const white = await engine.search({ board, sideToMove: 2, timeMs: 1000, requestId: 2, multiPV: 2 });
          const whiteUnchanged = JSON.stringify([...board]) === JSON.stringify(original);
          board[white.index] = 2;
          const beforeBlack = [...board];
          const black = await engine.search({ board, sideToMove: 1, timeMs: 1000, requestId: 3, multiPV: 2 });
          const blackUnchanged = JSON.stringify([...board]) === JSON.stringify(beforeBlack);
          const normal = await engine.search({ board, sideToMove: 1, timeMs: 200, requestId: 4 });
          return { opening, white, black, normal, whiteUnchanged, blackUnchanged, workers, board: beforeBlack };
        } finally { engine.dispose(); }
      }, variant);
      assert.deepEqual(result.opening.recommendations.map(move => move.index), [112]);
      assert.equal(result.white.recommendations.length, 2);
      assert.equal(result.black.recommendations.length, 2);
      for (const value of [result.white, result.black]) {
        assert.equal(value.evaluator, "mix9svq");
        assert.equal(new Set(value.recommendations.map(move => move.index)).size, 2);
        for (const move of value.recommendations) assert.ok(move.index >= 0 && move.index < 225
          && (value === result.white ? move.index !== 112 : !result.board[move.index]));
      }
      assert.ok(result.whiteUnchanged && result.blackUnchanged);
      assert.equal(result.workers, 1);
      assert.equal(result.normal.recommendations, undefined);
      passed(`${channel}: real ${variant}, both colors, two root moves, empty-board center, input preserved and worker reused`,
        { browser: browser.version(), elapsedMs: [result.white.elapsed, result.black.elapsed], moves: [result.white.recommendations, result.black.recommendations] });
    }
    await harnessContext.close();

    for (const prefix of ["plain", "ai"]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript(() => {
        localStorage.setItem("gomoku-pondering", "false"); localStorage.setItem("gomoku-thinking-ms", "1000");
        const NativeWorker = window.Worker; window.workerCreations = 0;
        window.Worker = class extends NativeWorker { constructor(...args) { super(...args); window.workerCreations++; } };
      });
      const page = await ctx.newPage(), errors = [], resources = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("response", response => { if (response.status() >= 400) resources.push(response.url()); });
      await page.goto(`${origin}/${prefix}/`); await ready(page);
      assert.equal(await page.evaluate(() => crossOriginIsolated), prefix === "ai");
      const workerCount = await page.evaluate(() => workerCreations);
      await recommend(page);
      assert.equal(await markers(page), 1); assert.equal(await stones(page), 0);
      assert.equal(await page.locator("#undoButton").isDisabled(), true);
      await page.locator("#recommendButton").click(); await ready(page);
      assert.equal(await markers(page), 0);
      assert.equal(await page.evaluate(() => workerCreations), workerCount);
      await page.locator("#colorSelect").selectOption("2"); await ready(page);
      const before = await position(page);
      await recommend(page);
      assert.equal(await markers(page), 2); assert.deepEqual(await position(page), before);
      assert.equal(await page.locator("#undoButton").isDisabled(), true);
      assert.equal(await page.locator("#recommendationLegend").isVisible(), true);
      await page.screenshot({ path: `.cache/recommendation-qa/${channel}-${prefix}.png`, fullPage: true });
      const first = await page.locator('[data-rank="1"]').getAttribute("data-recommendation");
      await page.locator(`[data-index="${first}"]`).click(); await ready(page);
      assert.equal(await markers(page), 0); assert.equal(await stones(page), 3);
      await recommend(page); assert.equal(await markers(page), 2);
      await page.locator("#undoButton").click(); await ready(page);
      assert.deepEqual(await position(page), before); assert.equal(await markers(page), 0);
      await page.waitForFunction(() => document.querySelector("#offlineState").textContent === "已缓存 · 可离线使用", undefined, { timeout: 60_000 });
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      const cachedModule = await page.evaluate(async () => Boolean(await caches.match(new URL("recommendations.js", location.href))));
      assert.ok(cachedModule);
      await ctx.setOffline(true); await page.reload(); await ready(page);
      await recommend(page); assert.equal(await markers(page), 2);
      assert.equal(await stones(page), 1);
      assert.deepEqual(errors, []); assert.deepEqual(resources, []);
      passed(`${channel}: /${prefix}/ real UI, colors, read-only hints, clear/place/undo, resource paths and offline recommendations`);
      await ctx.close();
    }
  }

  const browser = browsers[0];
  for (const prefix of ["plain", "ai"]) {
    const ctx = await testContext(browser), page = await ctx.newPage();
    await page.goto(`${origin}/${prefix}/`); await ready(page);
    await page.locator('[data-index="112"]').click(); await ready(page);
    for (const action of ["cancel", "escape", "undo", "restart", "color"]) {
      if (await stones(page) < 2) {
        await page.locator("#colorSelect").selectOption("1"); await ready(page);
        await page.locator('[data-index="112"]').click(); await ready(page);
      }
      const before = await position(page);
      await page.locator("#recommendButton").click();
      assert.equal(await page.locator("#timeSelect").isDisabled(), true);
      if (action === "cancel") await page.locator("#recommendButton").click();
      if (action === "escape") await page.keyboard.press("Escape");
      if (action === "undo") await page.locator("#undoButton").click();
      if (action === "restart") await page.locator("#restartButton").click();
      if (action === "color") await page.locator("#colorSelect").selectOption("2");
      await ready(page); await page.waitForTimeout(500);
      assert.equal(await markers(page), 0);
      if (["cancel", "escape"].includes(action)) assert.deepEqual(await position(page), before);
      if (["undo", "restart"].includes(action)) assert.equal(await stones(page), 0);
      if (action === "color") assert.equal(await stones(page), 1);
    }
    passed(`/${prefix}/ cancellation, Escape, undo/restart/color during recommendation discard stale output`);
    await ctx.close();
  }

  const fault = await testContext(browser);
  await fault.addInitScript(() => {
    const NativeWorker = window.Worker; let failOnce = true;
    window.Worker = class extends NativeWorker {
      postMessage(data, ...args) {
        if (data.type === "search" && data.multiPV === 2 && failOnce) {
          failOnce = false;
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "error", requestId: data.requestId, message: "injected recommendation failure" } })));
        } else super.postMessage(data, ...args);
      }
    };
  });
  const failed = await fault.newPage(); await failed.goto(`${origin}/plain/`); await ready(failed);
  await failed.locator('[data-index="112"]').click(); await ready(failed);
  const beforeFailure = await position(failed);
  await failed.locator("#recommendButton").click();
  await failed.waitForFunction(() => !document.querySelector("#retryButton").hidden);
  assert.deepEqual(await position(failed), beforeFailure);
  await failed.locator("#retryButton").click(); await ready(failed);
  await recommend(failed); assert.equal(await markers(failed), 2);
  assert.deepEqual(await position(failed), beforeFailure);
  passed("recommendation failure preserves the position and undo history; retry restores recommendations");
  await fault.close();

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  const mobile = await testContext(browser, { viewport, hasTouch: true, isMobile: true });
  const phone = await mobile.newPage(); await phone.goto(`${origin}/plain/`); await ready(phone);
  await phone.locator("#colorSelect").selectOption("2"); await ready(phone); await recommend(phone);
  const index = await phone.locator('[data-rank="1"]').getAttribute("data-recommendation");
  const box = await phone.locator(`[data-index="${index}"]`).boundingBox();
  await phone.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await stones(phone), 1); assert.equal(await markers(phone), 2);
  assert.equal(await phone.locator(".pending-stone").count(), 1);
  const layout = await phone.evaluate(() => ({ width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
    actionsBottom: document.querySelector(".game-actions").getBoundingClientRect().bottom,
    legendTop: document.querySelector("#recommendationLegend").getBoundingClientRect().top }));
  assert.ok(layout.scrollWidth <= layout.width && layout.scrollHeight <= layout.height, JSON.stringify(layout));
  assert.ok(layout.legendTop >= layout.actionsBottom, JSON.stringify(layout));
  await phone.screenshot({ path: `.cache/recommendation-qa/mobile-${viewport.width}.png`, fullPage: true });
  await phone.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await ready(phone);
  assert.equal(await stones(phone), 3); assert.equal(await markers(phone), 0);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  passed(`${viewport.width}×${viewport.height}: numbered/color hints preserve two-tap placement, fit the viewport and do not overlap controls`);
  await mobile.close();
  }
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack; process.exitCode = 1; console.error(error);
} finally {
  report.completedAt = new Date().toISOString();
  await writeFile("reports/recommendation-qa.json", JSON.stringify(report, null, 2) + "\n");
  for (const browser of browsers) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
