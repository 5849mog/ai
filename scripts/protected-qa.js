import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createDevServer } from "./dev-server.js";

// Exercise the actual published bundles with a real WASM engine and SW.
const server = await createDevServer({ port: 0, isolated: false, root: process.env.GOMOKU_SITE_ROOT });
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
  await page.locator("#recommendButton").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-recommendation]").length > 0, null, { timeout: 30000 });
  await ready();
  assert.equal(await page.locator("#boardSvg [data-stone]").count(), 2);
  await page.locator("#undoButton").click(); await ready();
  assert.equal(await page.locator("#boardSvg [data-stone]").count(), 0);
  await page.locator('[data-index="112"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-stone][data-color="2"]').length === 1, null, { timeout: 45000 });
  await ready();
  console.log("PASS recommendations and undo");
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

  for (const rule of ["renju", "rif", "taraguchi10"]) {
    const modes = await browser.newContext({ viewport: { width: 1024, height: 900 }, serviceWorkers: "block" });
    const game = await modes.newPage(), modeErrors = [];
    game.on("pageerror", error => modeErrors.push(error.message));
    await game.goto(origin + "?view=simple");
    await game.waitForFunction(() => document.querySelector("#boardSvg")?.dataset.stage === "play", null, { timeout: 60000 });
    await game.locator("#simpleColor").click();
    await game.locator("#ruleMode").selectOption(rule);
    await game.locator("#workflowMode").selectOption("follow");
    await game.locator("#startMode").click();
    await game.waitForFunction(rule => document.querySelector("#boardSvg")?.dataset.rule === rule
      && document.querySelector("#boardSvg")?.dataset.stage === "setup", rule, { timeout: 30000 });
    await game.locator('#simpleOpeningFlow [data-flow-action="start"][data-value="0"]').click();
    if (rule === "taraguchi10") {
      await game.locator('#simpleOpeningFlow [data-flow-action="decision"][data-value="keep"]').click();
    }
    const index = rule === "renju" ? 112 : 97, count = rule === "renju" ? 1 : 2;
    await game.locator('#boardSvg [data-index="' + index + '"]').click();
    await game.waitForFunction(count => document.querySelectorAll("#boardSvg [data-stone]").length === count, count, { timeout: 30000 });
    assert.deepEqual(modeErrors, []);
    await modes.close();
    console.log("PASS " + rule + " opening interaction");
  }

  // Attach a debugger to the actual AI worker and resume each deliberate
  // breakpoint. Without this check a rebuilt worker could lose its protection.
  const debugContext = await browser.newContext();
  const debugPage = await debugContext.newPage();
  const cdp = await browser.newBrowserCDPSession();
  await debugPage.goto(origin);
  await debugPage.waitForFunction(() => document.querySelector("#boardSvg")?.dataset.stage === "play", null, { timeout: 60000 });
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    target = targetInfos.find(item => item.type === "worker" && item.url.includes("engine.worker.protected.js"));
    if (!target) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(target, "protected engine worker did not start");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false });
  let pauses = 0, commandId = 1;
  const workerCommand = method => cdp.send("Target.sendMessageToTarget", {
    sessionId, message: JSON.stringify({ id: commandId++, method })
  });
  cdp.on("Target.receivedMessageFromTarget", event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method === "Debugger.paused") { pauses++; void workerCommand("Debugger.resume").catch(() => {}); }
  });
  await workerCommand("Debugger.enable");
  await new Promise(resolve => setTimeout(resolve, 7000));
  await workerCommand("Debugger.disable");
  await cdp.send("Target.detachFromTarget", { sessionId });
  await debugContext.close();
  assert.ok(pauses > 0, "engine worker did not trigger its debugger protection");
  // This only checks that the configured breakpoint runs. A user controlling
  // the browser can skip or remove it; it is not an authorization boundary.
  console.log("PASS engine worker debugger hook (not a security boundary)");

  // Change only response bytes, leaving the HTML and SRI hash untouched. The
  // browser should refuse the entry and preserve existing client data.
  const tamperContext = await browser.newContext({ serviceWorkers: "block" });
  await tamperContext.addInitScript(() => localStorage.setItem("gomoku-integrity-test", "keep"));
  const tamperPage = await tamperContext.newPage();
  const modify = async route => {
    const response = await route.fetch(), bytes = await response.body();
    const headers = { ...response.headers() };
    delete headers["content-length"]; delete headers["content-encoding"];
    await route.fulfill({ response, headers, body: Buffer.concat([bytes, Buffer.from("\n/* altered */\n")]) });
  };
  await tamperPage.route("**/opening-app.protected.js", modify);
  await tamperPage.goto(origin);
  await tamperPage.waitForFunction(() => document.querySelector("#stateText")?.textContent === "页面资源校验失败，请联网刷新", null, { timeout: 20000 });
  assert.equal(await tamperPage.locator("#boardSvg").getAttribute("data-stage"), null);
  assert.equal(await tamperPage.evaluate(() => localStorage.getItem("gomoku-integrity-test")), "keep");
  await tamperPage.route("**/update-page.protected.js", modify);
  await tamperPage.goto(new URL("update.html", origin).href);
  await tamperPage.waitForFunction(() => document.querySelector("[data-app-version]")?.textContent === "更新组件校验失败，请联网刷新此页。", null, { timeout: 20000 });
  assert.equal(await tamperPage.evaluate(() => localStorage.getItem("gomoku-integrity-test")), "keep");
  await tamperContext.close();
  console.log("PASS altered entry scripts rejected without deleting saved data");
} catch (error) {
  if (errors.length) console.error("Page errors:", errors);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
