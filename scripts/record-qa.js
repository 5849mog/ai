import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createDevServer } from "./dev-server.js";
import { createRecord, parseRecord } from "../game-record.js";

const server = await createDevServer({ port: 0 }), origin = `http://127.0.0.1:${server.address().port}`;
const runtime = await readFile("tests/fixtures/rapfi-protocol-double.js", "utf8");
const report = { startedAt: new Date().toISOString(), runtime: "Real app, worker and protocol with deterministic Rapfi double for cancellation edge cases; real WASM and offline checks separately", browsers: [], checks: [] };
await mkdir("reports", { recursive: true }); await mkdir(".cache/record-qa", { recursive: true });
const ready = page => page.waitForFunction(() => document.querySelector("#stateText").textContent === "轮到你落子");
const count = page => page.locator("#boardSvg [data-stone]").count();
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem(`gomoku-game:${location.pathname}:v1`)));
const upload = (page, text, name = "test.gomoku.json") => page.locator("#recordFile").setInputFiles({ name, mimeType: name.endsWith("sgf") ? "application/x-go-sgf" : "application/json", buffer: Buffer.from(text) });
const record = (moves, color = 1) => JSON.stringify(createRecord(moves, color));
function passed(channel, name) { report.checks.push(`${channel}: ${name}`); console.log("PASS", channel, name); }
async function installDouble(ctx) {
  await ctx.route("**/engine/rapfi-250615/rapfi-*.js", route => route.fulfill({ contentType: "text/javascript", body: runtime }));
  await ctx.addInitScript(() => {
    if (localStorage.getItem("gomoku-thinking-ms") === null) localStorage.setItem("gomoku-thinking-ms", "1000");
    if (localStorage.getItem("gomoku-pondering") === null) localStorage.setItem("gomoku-pondering", "false");
  });
}
try {
  for (const channel of ["chrome", "msedge"]) {
    const browser = await chromium.launch({ channel, headless: true }); report.browsers.push({ channel, version: browser.version() });
    try {
      const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: 1280, height: 900 } });
      await installDouble(ctx); const page = await ctx.newPage(), errors = [], resources = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("response", response => { if (response.status() >= 400) resources.push(response.url()); });
      await page.goto(`${origin}/ai/`); await ready(page);
      await page.locator('[data-index="112"]').click(); await ready(page);
      await page.locator('[data-index="113"]').click(); await ready(page);
      const history = await saved(page); assert.equal(history.moves.length, 4);
      await page.reload(); await ready(page); assert.deepEqual(await saved(page), history); assert.equal(await count(page), 4);
      await page.locator("#undoButton").click(); await ready(page); assert.equal(await count(page), 2); assert.equal((await saved(page)).moves.length, 2);
      await page.locator("#undoButton").click(); await ready(page); assert.equal(await count(page), 0);
      passed(channel, "automatic reload restoration includes complete undo history");

      await upload(page, record([112], 1)); await page.locator("#confirmImport").click();
      assert.deepEqual((await saved(page)).moves, [112]);
      await page.reload(); await ready(page); assert.equal(await count(page), 2); assert.equal((await saved(page)).moves.length, 2);
      await page.locator("#undoButton").click(); await ready(page); assert.equal(await count(page), 0);
      passed(channel, "human-only saved turn resumes fresh AI search; undo removes both actual moves");

      await page.locator("#colorSelect").selectOption("2"); await ready(page);
      await page.locator('[data-index="200"]').click(); await ready(page);
      await page.reload(); await ready(page); assert.equal(await count(page), 3);
      await page.locator("#undoButton").click(); await ready(page); assert.equal(await count(page), 1);
      await page.reload(); await ready(page); assert.equal(await count(page), 1);
      passed(channel, "white undo survives reload and retains AI's first move");

      const before = await saved(page);
      await upload(page, "{bad"); assert.equal(await page.locator("#recordDialog").isVisible(), false); assert.deepEqual(await saved(page), before);
      await upload(page, record([0, 0])); assert.deepEqual(await saved(page), before);
      await upload(page, record([112, 113], 1)); await page.locator("#recordDialog").waitFor({ state: "visible" });
      assert.equal(await count(page), 1); assert.deepEqual(await saved(page), before);
      await page.keyboard.press("Escape"); await page.locator("#recordDialog").waitFor({ state: "hidden" });
      assert.deepEqual(await saved(page), before);
      passed(channel, "invalid imports and cancelled preview retain the current board and history");

      await page.locator("#timeSelect").selectOption("5000");
      await upload(page, "(;FF[4]GM[4]SZ[15]RE[W+R];B[hh](;W[ih])(;W[aa]))", "branches.sgf");
      assert.match(await page.locator("#importNotices").innerText(), /主线/);
      await page.locator("#importColor").selectOption("1"); await page.locator("#confirmImport").click(); await ready(page);
      assert.equal(await page.locator("#timeSelect").inputValue(), "5000"); assert.equal(await page.locator("#ponderToggle").isChecked(), false);
      assert.deepEqual((await saved(page)).moves, [112, 113]); assert.equal(await page.locator("#colorSelect").inputValue(), "1");
      passed(channel, "SGF mainline preview, informational results and chosen role preserve search settings");

      for (const [button, extension] of [["exportJson", "json"], ["exportSgf", "sgf"]]) {
        await page.locator("#recordMenu summary").click(); const download = page.waitForEvent("download"); await page.locator(`#${button}`).click();
        const file = await download; assert.ok(file.suggestedFilename().endsWith(extension));
        assert.deepEqual(parseRecord(await readFile(await file.path(), "utf8")).record, await saved(page));
      }
      passed(channel, "downloaded JSON and SGF contain only actual moves and round trip exactly");

      await page.locator('[data-index="97"]').click();
      await upload(page, record([14, 224], 1)); await page.locator("#confirmImport").click(); await ready(page); await page.waitForTimeout(450);
      assert.deepEqual((await saved(page)).moves, [14, 224]); assert.equal(await count(page), 2);
      await page.locator("#recommendButton").click();
      await upload(page, record([0, 210], 1)); await page.locator("#confirmImport").click(); await ready(page); await page.waitForTimeout(450);
      assert.deepEqual((await saved(page)).moves, [0, 210]); assert.equal(await page.locator("[data-recommendation]").count(), 0);
      await page.locator('[data-index="112"]').click(); await page.locator("#restartButton").click(); await ready(page); await page.waitForTimeout(450);
      assert.equal(await count(page), 0); assert.deepEqual((await saved(page)).moves, []);
      passed(channel, "imports, recommendation cancellation and new game discard all old search responses");

      const win = [0, 30, 1, 32, 2, 34, 3, 36, 4];
      await upload(page, record(win, 1)); await page.locator("#confirmImport").click();
      await page.waitForFunction(() => document.querySelector("#stateText").textContent === "你赢了");
      assert.equal(await page.locator("#boardSvg .winning-connector").count(), 1); assert.equal(await page.locator("#boardSvg [data-winning-stone]").count(), 5);
      await page.reload(); await page.waitForFunction(() => document.querySelector("#stateText").textContent === "你赢了");
      assert.equal(await count(page), 9); await page.locator("#undoButton").click(); await ready(page);
      assert.equal(await count(page), 8); assert.equal(await page.locator("#boardSvg .winning-ring").count(), 0);
      await page.locator('[data-index="4"]').click(); assert.equal(await page.locator("#boardSvg .winning-ring").count(), 5);
      await page.screenshot({ path: `.cache/record-qa/${channel}-win.png` });
      passed(channel, "terminal import and reload retain victory rings; undo removes them and play restores them");

      await page.goto(`${origin}/plain/`); await ready(page); assert.equal(await count(page), 0);
      await page.goto(`${origin}/ai/`); assert.equal(await count(page), 9);
      passed(channel, "automatic records are isolated by hosting subdirectory");
      assert.deepEqual(errors, []); assert.deepEqual(resources, []); await ctx.close();

      const damaged = await browser.newContext({ serviceWorkers: "block" }); await installDouble(damaged);
      await damaged.addInitScript(() => localStorage.setItem(`gomoku-game:${location.pathname}:v1`, "corrupt"));
      const damagedPage = await damaged.newPage(); await damagedPage.goto(`${origin}/ai/`); await ready(damagedPage);
      assert.equal(await count(damagedPage), 0); assert.match(await damagedPage.locator("#gameNotice").innerText(), /未能读取/);
      await damagedPage.locator('[data-index="112"]').click(); await ready(damagedPage); assert.equal(await count(damagedPage), 2); await damaged.close();
      const blocked = await browser.newContext({ serviceWorkers: "block" }); await installDouble(blocked);
      await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); }; });
      const blockedPage = await blocked.newPage(); await blockedPage.goto(`${origin}/ai/`); await ready(blockedPage);
      await blockedPage.locator('[data-index="112"]').click(); await ready(blockedPage);
      assert.equal(await count(blockedPage), 2); assert.match(await blockedPage.locator("#gameNotice").innerText(), /暂未保存/); await blocked.close();
      passed(channel, "corrupt save and storage write failure still allow continued play with clear notice");

      for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
        const mobile = await browser.newContext({ serviceWorkers: "block", hasTouch: true, isMobile: true, viewport }); await installDouble(mobile);
        const phone = await mobile.newPage(); await phone.goto(`${origin}/ai/`); await ready(phone);
        await phone.locator('[data-index="112"]').tap(); assert.equal(await count(phone), 0);
        await phone.reload(); await ready(phone); assert.equal(await phone.locator(".pending-stone").count(), 0);
        await upload(phone, record([112, 113])); await phone.locator("#recordDialog").waitFor({ state: "visible" });
        const fits = await phone.evaluate(() => {
          const rect = document.querySelector("#recordDialog").getBoundingClientRect();
          return rect.x >= 0 && rect.right <= innerWidth + 1 && rect.y >= 0 && rect.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth;
        }); assert.ok(fits); await phone.locator("#confirmImport").tap(); await ready(phone);
        await phone.locator('[data-index="97"]').tap(); assert.equal(await count(phone), 2);
        await phone.locator('[data-index="97"]').tap(); await ready(phone); assert.equal(await count(phone), 4);
        await phone.locator("#undoButton").tap(); await ready(phone); assert.equal(await count(phone), 2);
        await phone.locator("#recordMenu summary").tap(); assert.equal(await phone.locator("#exportJson").isVisible(), true);
        await phone.screenshot({ path: `.cache/record-qa/${channel}-${viewport.width}x${viewport.height}.png` }); await mobile.close();
        passed(channel, `${viewport.width}x${viewport.height}: inline preview fits, transient touch isn't saved, two-tap play and undo intact`);
      }
    } finally { await browser.close(); }
  }
  report.completedAt = new Date().toISOString(); report.passed = true;
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile("reports/record-qa.json", JSON.stringify(report, null, 2) + "\n"); await new Promise(resolve => server.close(resolve)); }
