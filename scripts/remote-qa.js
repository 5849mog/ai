import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { createDevServer } from "./dev-server.js";
import { startRemote } from "../remote/server.js";
import { availableParallelism, cpus } from "node:os";

await mkdir(".cache/remote-qa", { recursive: true });
const server = await createDevServer({ port: 0, isolated: false }), origin = `http://127.0.0.1:${server.address().port}`;
const token = "a".repeat(64), checks = [], browsers = [], threads = Math.max(1, availableParallelism() - 1);
const mark = (channel, name, result) => { checks.push({ channel, name, ...(result ? { result } : {}) }); console.log("PASS", channel, name); };
const ready = page => page.waitForFunction(() => document.querySelector("#stateText").textContent === "轮到你落子", null, { timeout: 30000 });
try {
  for (const channel of ["chrome", "msedge"]) {
    const browser = await chromium.launch({ channel, headless: true });
    browsers.push({ channel, version: browser.version() });
    let bridge = await startRemote({ port: 0, token, origins: [origin], threads }), closed = false;
    const address = `ws://127.0.0.1:${bridge.port}`;
    try {
      const ctx = await browser.newContext({ serviceWorkers: "block" }), page = await ctx.newPage();
      await page.goto(`${origin}/ai/tests/engine-harness.html`);
      const core = await page.evaluate(async ({ address, token }) => {
        const { saveRemoteSettings } = await import("../remote-engine.js"); saveRemoteSettings({ url: address, token });
        const { GomokuEngine } = await import("../engine.js"), engine = new GomokuEngine();
        const board = new Uint8Array(225); board[112] = 1;
        const before = [...board], white = await engine.search({ board, sideToMove: 2, multiPV: 3, timeMs: 500, requestId: 1 });
        if (JSON.stringify([...board]) !== JSON.stringify(before)) throw Error("Mutated board");
        const workers = engine.worker;
        const more = new Uint8Array(225); for (const [i,c] of [[112,1],[113,2],[97,1],[128,2]]) more[i] = c;
        const restricted = await engine.search({ board: more, sideToMove: 1, multiPV: 3, allowedMoves: [96,98,111], allowSetup: true, timeMs: 500, requestId: 2 });
        const balanced = await engine.search({ board: more, sideToMove: 1, balance: true, allowedMoves: [96,98,111], allowSetup: true, timeMs: 500, requestId: 3 });
        const actual = [...more];
        await engine.ponder({ board: more, sideToMove: 1, multiPV: 3, requestId: 4 });
        await new Promise(done => setTimeout(done, 500));
        const foreground = await engine.search({ board: more, sideToMove: 1, timeMs: 500, requestId: 5 });
        if (JSON.stringify([...more]) !== JSON.stringify(actual)) throw Error("Ponder mutated board");
        const reused = workers === engine.worker;
        const pending = engine.search({ board: more, sideToMove: 1, timeMs: 10000, requestId: 6 }).then(() => "resolved", error => error.name);
        await Promise.resolve(); engine.cancel(); const cancellation = await pending;
        const after = await engine.search({ board: more, sideToMove: 1, multiPV: 3, timeMs: 500, requestId: 7 });
        engine.dispose();
        const renju = new GomokuEngine({ rule: "rif" });
        const renjuResult = await renju.search({ board: more, sideToMove: 1, multiPV: 3, allowedMoves: [96,98,111], allowSetup: true, timeMs: 500, requestId: 8 });
        const setup = new Uint8Array(225); setup[0] = setup[14] = setup[112] = 2;
        const arbitrary = await renju.search({ board: setup, sideToMove: 1, allowSetup: true, timeMs: 500, requestId: 9 });
        const forbiddenBoard = Array(225).fill(0); for (const index of [109,110,111,113,114]) forbiddenBoard[index] = 1;
        const forbid = await new Promise((done, reject) => {
          const timeout = setTimeout(() => reject(Error("forbids timeout")), 3000), previous = renju.worker.onmessage;
          renju.worker.onmessage = event => { previous(event); if (event.data.type === "forbids") { clearTimeout(timeout); done(event.data.indices); } };
          renju.worker.postMessage({ type: "forbids", board: forbiddenBoard, requestId: 10 });
        }); renju.dispose();
        return { white, restricted, balanced, foreground, cancellation, after, reused, renjuResult, arbitrary, forbid };
      }, { address, token });
      assert.equal(core.white.backend, "remote-native-avx2"); assert.equal(core.white.threads, threads); assert.equal(core.white.memoryMiB, 256);
      assert.equal(core.white.recommendations.length, 3); assert.equal(core.reused, true); assert.equal(core.cancellation, "AbortError"); assert.equal(core.after.requestId, 7);
      assert.ok([96,98,111].includes(core.restricted.index)); assert.ok([96,98,111].includes(core.balanced.index));
      assert.match(core.renjuResult.weight, /renju/); assert.ok(core.forbid.includes(112));
      mark(channel, "actual native threads, three candidates, restricted and balanced opening searches, TT reuse, cancellation, Renju and forbidden points", core);
      await ctx.close();
      for (let i = 0; i < 40 && bridge.active; i++) await new Promise(done => setTimeout(done, 25)); assert.equal(bridge.active, false);

      const ui = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });
      await ui.addInitScript(() => { localStorage.setItem("gomoku-thinking-ms", "1000"); localStorage.setItem("gomoku-pondering", "false"); });
      const app = await ui.newPage(), errors = [];
      app.on("pageerror", error => errors.push(error.message)); await app.goto(`${origin}/ai/`); await ready(app);
      await app.locator("#recordMenu summary").click(); await app.locator("#openRemoteEngine").click();
      await app.locator("#remoteUrl").fill(address); await app.locator("#remoteToken").fill(token);
      await app.locator("#remoteConnect").click(); await ready(app);
      await app.waitForFunction(() => document.querySelector("#openRemoteEngine").textContent.includes("线程"));
      await app.locator('[data-index="112"]').click(); await app.waitForFunction(() => document.querySelectorAll("#boardSvg [data-stone]").length === 2); await ready(app);
      await app.reload(); await ready(app); assert.equal(await app.locator("#boardSvg [data-stone]").count(), 2);
      const emptyIndex = await app.locator("#boardSvg [data-index]").first().getAttribute("data-index");
      await app.locator(`[data-index="${emptyIndex}"]`).tap(); assert.equal(await app.locator("#boardSvg [data-stone]").count(), 2);
      await app.locator(`[data-index="${emptyIndex}"]`).tap(); await ready(app);
      assert.equal(await app.locator("#boardSvg [data-stone]").count(), 4);
      await app.locator("#undoButton").click(); await ready(app); assert.equal(await app.locator("#boardSvg [data-stone]").count(), 2);
      await app.locator(`[data-index="${emptyIndex}"]`).click(); await app.locator("#undoButton").click(); await ready(app);
      await app.waitForTimeout(300); assert.equal(await app.locator("#boardSvg [data-stone]").count(), 2);
      mark(channel, "phone UI pairing, real native reply, reload continuation and undo while searching");
      await app.locator("#recordMenu summary").click(); await app.locator("#openRemoteEngine").click();
      await app.screenshot({ path: `.cache/remote-qa/${channel}-phone.png` }); await app.locator("#remoteCancel").click();
      await app.locator(`[data-index="${emptyIndex}"]`).click(); await bridge.close(); closed = true;
      await app.waitForFunction(() => !document.querySelector("#retryButton").hidden);
      const preserved = await app.locator("#boardSvg [data-stone]").count(); assert.ok(preserved >= 3);
      await app.locator("#recordMenu summary").click(); await app.locator("#openRemoteEngine").click();
      await app.locator("#remoteBrowser").click(); await ready(app);
      assert.equal(await app.locator("#boardSvg [data-stone]").count(), preserved % 2 ? preserved + 1 : preserved);
      assert.deepEqual(errors, []);
      mark(channel, "disconnect retains game, does not silently fall back, and explicit browser switch resumes the saved turn");
      await ui.close();
    } finally { if (!closed) await bridge.close(); await browser.close(); }
  }
  await writeFile("reports/remote-native-qa.json", JSON.stringify({ completedAt: new Date().toISOString(), cpu: cpus()[0].model, browsers, threads, memoryMiB: 256,
    transport: "WebSocket loopback; real native executable, no test engine double; Internet tunnel not yet configured", checks, passed: true }, null, 2) + "\n");
} finally { await new Promise(done => server.close(done)); }
