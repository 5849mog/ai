import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createDevServer } from "./dev-server.js";

// Exercise the actual published bundles with a real WASM engine and SW.
const server = await createDevServer({ port: 0, isolated: false });
const origin = "http://127.0.0.1:" + server.address().port + "/plain/";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
});
const errors = [], workers = [], requests = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
page.on("worker", worker => workers.push(worker.url()));
page.on("request", request => requests.push(request.url()));
const ready = () => page.waitForFunction(() => {
  const board = document.querySelector("#boardSvg");
  return board?.dataset.stage === "play" && board.getAttribute("aria-disabled") === "false";
}, null, { timeout: 60000 });
try {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await ready();
  console.log("PASS protected app startup");
  await page.locator("#timeSelect").selectOption("100");
  await page.locator('[data-index="112"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-stone][data-color="2"]').length === 1, null, { timeout: 45000 });
  await ready();
  console.log("PASS first AI response");
  assert.ok(workers.some(url => url.includes("engine.worker.protected.js")), "game must use the protected worker");
  assert.ok(requests.some(url => url.includes("opening-app.protected.js")));
  assert.equal(requests.some(url => /\/opening-app\.js(?:\?|$)/.test(url)), false);
  assert.ok(await page.evaluate(() => localStorage.getItem("gomoku-opening:/plain/:v1")));
  await page.reload(); await ready();
  assert.equal(await page.locator('[data-stone][data-color="1"]').count(), 1);
  assert.equal(await page.locator('[data-stone][data-color="2"]').count(), 1);
  await page.waitForFunction(async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("gomoku-rapfi:") && await (await caches.open(name)).match(new URL("__engine_offline_ready__", location.href))) return true;
    }
    return false;
  }, null, { timeout: 90000 });
  console.log("PASS offline engine cache ready");
  await context.setOffline(true);
  await page.reload(); await ready();
  assert.equal(await page.locator('[data-stone][data-color="1"]').count(), 1);
  const empty = await page.evaluate(() => {
    const occupied = new Set([...document.querySelectorAll("[data-stone]")].map(node => Number(node.dataset.stone)));
    return [...document.querySelectorAll("[data-index]")].map(node => Number(node.dataset.index)).find(index => !occupied.has(index));
  });
  await page.locator('[data-index="' + empty + '"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-stone][data-color="2"]').length === 2, null, { timeout: 45000 });
  await ready();
  await context.setOffline(false);
  await page.goto(new URL("about.html", origin).href);
  assert.equal(await page.title(), "About Gomoku Studio");
  await page.goto(new URL("report.html", origin).href);
  assert.ok((await page.title()).length);
  await page.goto(new URL("update.html", origin).href);
  await page.waitForFunction(() => !document.querySelector("[data-app-update]")?.disabled, null, { timeout: 20000 });
  assert.deepEqual(errors, []);
  console.log("PASS protected bundles, real engine, saved game, offline engine, About, reports and update page");
  const tablet = await browser.newContext({ viewport: { width: 834, height: 1194 }, hasTouch: true });
  const mobile = await tablet.newPage();
  const tabletErrors = [];
  mobile.on("pageerror", error => tabletErrors.push(error.message));
  await mobile.goto(origin);
  await mobile.waitForFunction(() => {
    const board = document.querySelector("#boardSvg");
    return board?.dataset.stage === "play" && board.getAttribute("aria-disabled") === "false";
  }, null, { timeout: 60000 });
  assert.ok(await mobile.locator("#boardSvg").isVisible());
  assert.deepEqual(tabletErrors, []);
  await tablet.close();
  console.log("PASS iPad portrait startup");
} catch (error) {
  if (errors.length) console.error("Page errors:", errors);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
