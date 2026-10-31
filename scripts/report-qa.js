import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, devices } from "playwright";
import { createDevServer } from "./dev-server.js";

const server = await createDevServer({ port: 0, isolated: false });
const origin = `http://127.0.0.1:${server.address().port}`;
const reportPattern = "**/reports/strength-baseline-v1-summary.json*";
const original = JSON.parse(await readFile(new URL("../reports/strength-baseline-v1-summary.json", import.meta.url), "utf8"));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: JSON.parse(process.env.CHROME_ARGS || "[]")
});
const checks = [];

async function swipe(page) {
  await page.evaluate(() => scrollTo(0, 0));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 190, y: 560 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 190, y: 560 - i * 40 }] });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(450);
  return page.evaluate(() => scrollY);
}

try {
  const mobile = await browser.newContext({ ...devices["iPhone 15"], serviceWorkers: "block" });
  const phone = await mobile.newPage();
  const phoneErrors = [];
  phone.on("pageerror", error => phoneErrors.push(error.message));
  await phone.goto(`${origin}/about.html`);
  const aboutBefore = await phone.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth
  }));
  const aboutScrollY = await swipe(phone);
  assert.ok(aboutScrollY > 100, "About page must move under a real touch gesture");
  assert.equal(aboutBefore.bodyOverflowX, "clip");
  assert.equal(aboutBefore.bodyOverflowY, "visible");
  assert.equal(aboutBefore.horizontalOverflow, false);
  checks.push({ name: "about mobile touch scroll", aboutScrollY, ...aboutBefore });
  await phone.evaluate(() => scrollTo(0, 0));
  await phone.screenshot({ path: "/mnt/agents/.tmp/about-mobile-fixed.png" });
  await phone.locator(".report-link").click();
  await phone.waitForURL("**/report.html");
  await phone.waitForFunction(() => !document.getElementById("reportContent").hidden);
  assert.equal(await phone.locator("#positionRows tr").count(), original.positionRuns.length);
  assert.equal(await phone.locator("#gameRows tr").count(), original.games.length);
  const reportScrollY = await swipe(phone);
  assert.ok(reportScrollY > 100, "Report page must scroll with touch");
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await phone.evaluate(() => scrollTo(0, 0));
  await phone.screenshot({ path: "/mnt/agents/.tmp/report-mobile.png" });
  assert.deepEqual(phoneErrors, []);
  checks.push({ name: "mobile report entry, cloud render and touch scroll", reportScrollY, rows: original.positionRuns.length, games: original.games.length });
  await mobile.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const page = await desktop.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`${origin}/report.html`);
  await page.waitForFunction(() => !document.getElementById("reportContent").hidden);
  assert.equal(await page.locator("#heroSolved").textContent(), "36 / 36");
  assert.equal(await page.locator("#ledgerVersion").textContent(), original.appVersion);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  const updated = { ...original, appVersion: "cloud-update-proof" };
  await page.route(reportPattern, route => route.fulfill({ contentType: "application/json", json: updated }));
  await page.locator("#refreshReport").click();
  await page.waitForFunction(() => document.getElementById("ledgerVersion").textContent === "cloud-update-proof");
  checks.push({ name: "manual refresh renders newly returned cloud data", version: await page.locator("#ledgerVersion").textContent() });

  await page.route(reportPattern, route => route.fulfill({ status: 503, contentType: "text/plain", body: "expected QA outage" }));
  await page.locator("#refreshReport").click();
  await page.waitForFunction(() => !document.getElementById("reportError").hidden);
  assert.equal(await page.locator("#reportContent").isVisible(), true);
  assert.equal(await page.locator("#ledgerVersion").textContent(), "cloud-update-proof");
  checks.push({ name: "failed refresh retains last good data and exposes error", status: await page.locator("#cloudStatusText").textContent() });

  await page.unroute(reportPattern);
  await page.locator("#retryReport").click();
  await page.waitForFunction(version => document.getElementById("reportError").hidden && document.getElementById("ledgerVersion").textContent === version, original.appVersion);
  const beforeVisibility = await page.evaluate(() => performance.getEntriesByType("resource").filter(entry => entry.name.includes("strength-baseline-v1-summary.json")).length);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForFunction(before => performance.getEntriesByType("resource").filter(entry => entry.name.includes("strength-baseline-v1-summary.json")).length > before, beforeVisibility);
  checks.push({ name: "visible-page event fetches cloud data again", beforeVisibility, afterVisibility: beforeVisibility + 1 });

  await page.screenshot({ path: "/mnt/agents/.tmp/report-desktop-full.png", fullPage: true });
  assert.deepEqual(pageErrors, []);
  const fresh = await desktop.newPage();
  const coldErrors = [];
  fresh.on("pageerror", error => coldErrors.push(error.message));
  fresh.on("console", message => { if (message.type() === "error") coldErrors.push(message.text()); });
  await fresh.goto(`${origin}/report.html`);
  await fresh.waitForFunction(() => !document.getElementById("reportContent").hidden);
  assert.deepEqual(coldErrors, []);
  checks.push({ name: "cold start renders without browser errors" });
  await desktop.close();
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
