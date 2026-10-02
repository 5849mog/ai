import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createDevServer } from "./dev-server.js";

const server = await createDevServer({ port: 0 });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_ARGS ? { args: JSON.parse(process.env.CHROME_ARGS) } : {}),
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const runtime = await readFile("tests/fixtures/rapfi-protocol-double.js", "utf8");
const report = { startedAt: new Date().toISOString(), runtime: "Original Rapfi WASM + deterministic protocol double for UI edge cases; no new chess-strength benchmark",
  browser: browser.version(), checks: [] };
await mkdir(".cache/feature-qa", { recursive: true });
const ready = page => page.waitForFunction(() => document.querySelector("#stateText").textContent === "轮到你落子");
const count = (page, color) => page.locator(`[data-color="${color}"]`).count();
function passed(name) { report.checks.push(name); console.log("PASS", name); }
async function context(options = {}) {
  const result = await browser.newContext({ serviceWorkers: "block", ...options });
  await result.route("**/engine/rapfi-250615/rapfi-*.js", route => route.fulfill({ contentType: "text/javascript", body: runtime }));
  await result.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.engineCommands = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => { if (data.type === "test-command") engineCommands.push(data.command); });
      }
    };
  });
  return result;
}

try {
  const native = await browser.newContext({ serviceWorkers: "block" });
  const harness = await native.newPage();
  for (const variant of ["rapfi-single-simd128", "rapfi-single", "rapfi-multi-simd128", "rapfi-multi"]) {
    await harness.goto(`${origin}/ai/tests/engine-harness.html`);
    const first = await harness.evaluate(async variant => {
      const { GomokuEngine } = await import("../engine.js");
      globalThis.qaStats = [];
      globalThis.qaEngine = new GomokuEngine({ variant, threads: 2, onStats: event => qaStats.push(event) });
      await qaEngine.init();
      globalThis.qaBoard = new Uint8Array(225);
      const opening = await qaEngine.search({ board: qaBoard, sideToMove: 1, timeMs: 200, requestId: 1 });
      qaBoard[opening.index] = 1;
      await qaEngine.ponder({ board: qaBoard, sideToMove: 2, requestId: 2 });
      return opening;
    }, variant);
    assert.equal(first.evaluator, "mix9svq");
    await harness.waitForFunction(() => qaStats.some(event => event.phase === "ponder" && event.stats.depth), undefined, { timeout: 10_000 });
    const interrupted = await harness.evaluate(async () => {
      const white = qaBoard.findIndex(value => !value); qaBoard[white] = 2;
      const original = [...qaBoard];
      const move = await qaEngine.search({ board: qaBoard, sideToMove: 1, timeMs: 400, requestId: 3 });
      const unchanged = JSON.stringify([...qaBoard]) === JSON.stringify(original);
      qaBoard[move.index] = 1;
      await qaEngine.ponder({ board: qaBoard, sideToMove: 2, requestId: 4 });
      return { move, unchanged };
    });
    assert.ok(interrupted.unchanged);
    assert.equal(interrupted.move.evaluator, "mix9svq");
    await harness.waitForFunction(() => qaStats.some(event => event.requestId === 4), undefined, { timeout: 10_000 });
    const reset = await harness.evaluate(async () => {
      qaEngine.reset(); const boundary = qaStats.length;
      const fresh = await qaEngine.search({ board: new Uint8Array(225), sideToMove: 1, timeMs: 200, requestId: 5 });
      await new Promise(resolve => setTimeout(resolve, 350));
      const late = qaStats.slice(boundary).some(event => [2, 4].includes(event.requestId));
      qaEngine.dispose(); return { fresh, late };
    });
    assert.equal(reset.late, false);
    assert.equal(reset.fresh.evaluator, "mix9svq");
    passed(`real ${variant}: black opening, live background stats, interrupted foreground search and reset`);
  }
  await native.close();

  for (const prefix of ["plain", "ai"]) {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    await ctx.addInitScript(() => localStorage.setItem("gomoku-thinking-ms", "1000"));
    const page = await ctx.newPage();
    await page.goto(`${origin}/${prefix}/`); await ready(page);
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#retryButton").isHidden(), true);
    assert.equal(await page.locator("[data-stone]").count(), 0);
    await page.locator("#colorSelect").selectOption("2"); await ready(page);
    assert.equal(await count(page, 1), 1);
    await page.locator('[data-index="128"]').click(); await ready(page);
    assert.equal(await count(page, 1), 2); assert.equal(await count(page, 2), 1);
    await page.waitForFunction(() => document.querySelector("#searchDepth").textContent !== "—");
    await page.locator("#undoButton").click(); await ready(page);
    assert.equal(await count(page, 1), 1); assert.equal(await count(page, 2), 0);
    await page.locator('[data-index="128"]').click();
    await page.locator("#restartButton").click(); await ready(page);
    await page.waitForTimeout(450);
    assert.equal(await count(page, 1), 1); assert.equal(await count(page, 2), 0);
    passed(`real /${prefix}/ UI: empty pondering, AI-first game, stats, white undo and restart during thinking`);
    await ctx.close();
  }

  for (const prefix of ["plain", "ai"]) {
    const ctx = await context({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/${prefix}/`); await ready(page);
    await page.waitForFunction(() => document.querySelector("#searchDepth").textContent !== "—");
    await page.waitForTimeout(400);
    assert.equal(await page.locator("[data-stone]").count(), 0);
    assert.match(await page.locator("#searchScore").innerText(), /^-/);
    passed(`${prefix}: background streams stats without placing hypothetical moves`);

    await page.locator("#colorSelect").selectOption("2"); await ready(page);
    assert.equal(await count(page, 1), 1); assert.equal(await count(page, 2), 0);
    await page.locator('[data-index="200"]').hover();
    assert.equal(await page.locator(".hover-stone").getAttribute("fill"), "url(#whiteStone)");
    await page.locator('[data-index="200"]').click(); await ready(page);
    assert.equal(await count(page, 1), 2); assert.equal(await count(page, 2), 1);
    await page.locator("#undoButton").click(); await ready(page);
    assert.equal(await count(page, 1), 1); assert.equal(await count(page, 2), 0);
    passed(`${prefix}: AI black opening, white previews, alternating turns and white undo`);

    await page.locator('[data-index="200"]').click();
    await page.locator("#restartButton").click(); await ready(page);
    await page.waitForTimeout(450);
    assert.equal(await count(page, 1), 1); assert.equal(await count(page, 2), 0);
    await page.locator("#colorSelect").selectOption("1");
    await page.locator("#colorSelect").selectOption("2"); await ready(page);
    assert.equal(await count(page, 1), 1); assert.equal(await count(page, 2), 0);
    passed(`${prefix}: restart during AI search and rapid color changes discard old moves`);

    await page.locator("#ponderToggle").uncheck();
    await page.waitForTimeout(450);
    const commands = await page.evaluate(() => engineCommands.length);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => engineCommands.length), commands);
    await page.reload(); await ready(page);
    assert.equal(await page.locator("#colorSelect").inputValue(), "2");
    assert.equal(await page.locator("#ponderToggle").isChecked(), false);
    passed(`${prefix}: background stops and color/ponder preferences survive reload`);

    await page.locator("#ponderToggle").check();
    await page.waitForFunction(() => document.querySelector("#analysisState").textContent.includes("后台思考中"));
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(450);
    const hiddenCount = await page.evaluate(() => engineCommands.length);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => engineCommands.length), hiddenCount);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(() => document.querySelector("#analysisState").textContent.includes("后台思考中"));
    passed(`${prefix}: page visibility pauses/resumes background analysis`);

    await page.locator("#ponderToggle").uncheck();
    for (const index of [200, 201, 202, 203]) {
      await page.locator(`[data-index="${index}"]`).click(); await ready(page);
    }
    await page.locator('[data-index="204"]').click();
    assert.equal(await page.locator("#stateText").innerText(), "你赢了");
    await page.locator("#undoButton").click(); await ready(page);
    assert.equal(await count(page, 2), 4);
    passed(`${prefix}: a white win is attributed to the player and can be undone`);
    if (prefix === "ai") {
      await page.locator("#ponderToggle").check();
      await page.waitForFunction(() => document.querySelector("#searchDepth").textContent !== "—");
      await page.screenshot({ path: ".cache/feature-qa/desktop.png", fullPage: true });
    }
    assert.equal(await page.locator("#retryButton").isHidden(), true);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => engineCommands.some(command => command === "INFO pondering 1")), false);
    await ctx.close();
  }

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    const ctx = await context({ viewport, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(`${origin}/plain/`); await ready(page);
    await page.locator("#colorSelect").selectOption("2"); await ready(page);
    const box = await page.locator('[data-index="200"]').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await count(page, 2), 0);
    assert.equal(await page.locator(".pending-stone").getAttribute("fill"), "url(#whiteStone)");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await count(page, 2), 1);
    await ready(page);
    await page.waitForFunction(() => document.querySelector("#searchDepth").textContent !== "—");
    const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
    assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
    assert.ok(layout.scrollHeight <= layout.height, JSON.stringify(layout));
    await page.screenshot({ path: `.cache/feature-qa/mobile-${viewport.width}.png`, fullPage: true });
    passed(`${viewport.width}×${viewport.height}: white two-tap confirmation and one-screen layout`);
    await ctx.close();
  }
  report.completedAt = new Date().toISOString(); report.passed = true;
  await writeFile(".cache/feature-qa/report.json", JSON.stringify(report, null, 2));
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
