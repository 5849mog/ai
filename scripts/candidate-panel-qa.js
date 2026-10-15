import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createDevServer } from "./dev-server.js";
import { OpeningSession } from "../opening-session.js";
import { APP_VERSION } from "../app-release.js";
import { MOVE_REVIEW_MS } from "../move-candidates.js";

const server = await createDevServer({ port: 0 }), origin = `http://127.0.0.1:${server.address().port}/plain/`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  ...(process.env.CHROME_ARGS ? { args: JSON.parse(process.env.CHROME_ARGS) } : {}) });
const report = { version: APP_VERSION, startedAt: new Date().toISOString(), browser: browser.version(),
  method: "Real single-thread Rapfi WASM; no engine doubles. Clickable candidates, explicit adoption, held AI replies, history safety, five-PV scores, cloned child-board scores and responsive layouts.", checks: [], layouts: [], native: [], sources: {} };
for (const path of ["app.js", "opening-app.js", "board-view.js", "move-candidates.js", "candidate-panel.css", "engine.js", "engine-jobs.js", "engine.worker.js", "scripts/candidate-panel-qa.js"]) report.sources[path] = createHash("sha256").update(await readFile(new URL("../" + path, import.meta.url))).digest("hex");
let activePage;
const pass = name => { report.checks.push(name); console.log("PASS", name); };
const rows = page => page.locator(".candidate-row").evaluateAll(nodes => nodes.map(node => ({ index: Number(node.dataset.index),
  score: node.querySelector(".candidate-score").textContent, rate: node.querySelector(".candidate-rate")?.textContent, selected: node.getAttribute("aria-current") === "true" })));
const waitFive = page => page.waitForFunction(() => document.querySelectorAll(".candidate-row").length === 5 &&
  [...document.querySelectorAll(".candidate-score")].every(node => node.textContent !== "待评估"), undefined, { timeout: 30000 });
// Tactical shortcuts can legitimately contain fewer than five candidates.
const waitCandidates = page => page.waitForFunction(() => {
  const rows = document.querySelectorAll('.candidate-row');
  return rows.length > 0 && rows.length <= 5 && [...document.querySelectorAll('.candidate-score')].every(node => node.textContent !== '待评估');
}, undefined, { timeout: 30000 });
const tapPoint = async (page, index) => { await page.locator(`#boardSvg [data-index="${index}"]`).tap(); await page.locator(`#boardSvg [data-index="${index}"]`).tap(); };
const sizes = [[390, 844], [360, 640], [320, 568], [844, 390], [780, 360], [820, 1180], [768, 1024], [1024, 768], [1440, 900]];
async function layout(page, name, mode) {
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(180);
    const result = await page.evaluate(() => {
      const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const panel = document.querySelector("#moveCandidates"), board = document.querySelector("#boardSvg");
      return { panel: box(panel), board: box(board), rows: [...panel.querySelectorAll(".candidate-row")].map(box),
        documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
        controls: box(document.querySelector(document.body.classList.contains("simple-mode") ? "#simpleControls" : ".game-sidebar")) };
    });
    report.layouts.push({ page: name, mode, width, height, ...result });
    assert.ok(result.documentWidth <= width + 1 && result.documentHeight <= height + 1, `${name}/${mode} ${width}x${height}: page overflow ${result.documentWidth}x${result.documentHeight}`);
    for (const key of ["panel", "board", "controls"]) {
      const b = result[key]; assert.ok(b.x >= -1 && b.y >= -1 && b.right <= width + 1 && b.bottom <= height + 1 && b.width > 0 && b.height > 0,
        `${name}/${mode} ${width}x${height}: ${key} clipped ${JSON.stringify(b)}`);
    }
    for (const row of result.rows) assert.ok(row.bottom <= result.panel.bottom + 1 && row.right <= result.panel.right + 1, "candidate row clipped");
    const clipped = await page.locator('.candidate-row').evaluateAll(nodes => nodes.some(node => node.scrollWidth > node.clientWidth + 1));
    assert.equal(clipped, false, `${name}/${mode}: candidate contents overflow`);
  }
  pass(`${name}: ${mode} mode stays within one screen at ${sizes.length} phone, tablet and desktop sizes`);
}
try {
  await mkdir(".cache/candidate-panel", { recursive: true });
  for (const name of ["index.html", "renju.html"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const b = Array(225).fill(0); b[112] = 1; b[97] = 2;
    const opening = new OpeningSession({ rule: "taraguchi10", workflow: "follow", seed: { board: b, sideToMove: 1 } });
    await context.addInitScript(({ name, record }) => {
      localStorage.setItem("gomoku-thinking-ms", "1000"); localStorage.setItem("gomoku-pondering", "true");
      const base = new URL("./", location.href).pathname;
      if (name === "index.html") localStorage.setItem(`gomoku-game:${base}:v1`, JSON.stringify({ format: "gomoku-studio", version: 1, size: 15, rule: "freestyle", playerColor: 1, moves: [112, 97] }));
      else localStorage.setItem(`gomoku-opening:${base}:v1`, JSON.stringify({ record, perspective: 2 }));
      const NativeWorker = window.Worker; window.candidateMessages = []; window.candidateResults = [];
      window.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); this.addEventListener("message", ({ data }) => { if (data.type === "move") window.candidateResults.push(data); }); }
        postMessage(data, ...args) { if (["search", "ponder"].includes(data.type)) window.candidateMessages.push(data); return super.postMessage(data, ...args); }
      };
    }, { name, record: opening.record() });
    const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
    activePage = page;
    await page.goto(`${origin}${name}?view=full`); await waitFive(page);
    const first = await rows(page); assert.equal(await page.locator("#moveCandidates").getAttribute("data-color"), "1");
    const actualPonder = await page.evaluate(() => candidateMessages.find(message => message.type === "ponder"));
    assert.equal(actualPonder.multiPV, 5); assert.equal(actualPonder.sideToMove, 1);
    pass(`${name}: real WASM completes five scored candidates automatically for the actual black turn`);
    await layout(page, name, "full");
    await page.locator(`.candidate-row[data-index="${first[2].index}"]`).tap();
    assert.equal(await page.locator('[data-candidate-preview]').getAttribute('data-color'), '1');
    assert.equal(await page.locator('[data-candidate-preview]').getAttribute('data-candidate-preview'), String(first[2].index));
    assert.equal(await page.locator('#boardSvg [data-stone]').count(), 2);
    assert.equal(await page.locator('#candidateApply').isVisible(), true);
    await layout(page, name, 'full selected candidate');
    await page.locator(`.candidate-row[data-index="${first[2].index}"]`).tap();
    assert.equal(await page.locator('[data-candidate-preview]').count(), 0);
    pass(`${name}: one tap previews the correct candidate without playing; tapping again clears it`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#recordMenu summary").click(); await page.locator("#enterSimpleMode").click();
    await layout(page, name, "simple"); await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#ponderToggle").evaluate(element => { element.checked = false; element.dispatchEvent(new Event("change")); });
    const before = await rows(page), chosen = before[1].index; await tapPoint(page, chosen);
    await page.waitForFunction(() => document.querySelector("#moveCandidates").dataset.mode === "review");
    if (name === "index.html") await page.waitForFunction(() => document.querySelectorAll("#boardSvg [data-stone]").length === 4);
    await page.waitForTimeout(850);
    const frozen = await rows(page); assert.equal(frozen.find(row => row.selected).index, chosen);
    assert.equal(frozen.find(row => row.selected).score, before[1].score);
    assert.equal(await page.locator("#moveCandidates").getAttribute("data-color"), "1");
    pass(`${name}: ranked input is highlighted with its original black score and survives automatic/background changes`);
    await page.locator('.candidate-row').first().tap();
    assert.equal(await page.locator('[data-candidate-preview]').count(), 1);assert.equal(await page.locator('#candidateApply').isVisible(), false);
    pass(`${name}: historical candidates preview on the board but cannot be applied to the current position`);
    await page.screenshot({ path: `.cache/candidate-panel/${name.replace(".html", "")}-390.png` });
    await page.locator("#candidateSwitch").click(); await waitCandidates(page);
    if (name === "renju.html") assert.equal(await page.locator("#moveCandidates").getAttribute("data-color"), "2");
    const live = await rows(page), occupied = await page.locator("#boardSvg [data-stone]").evaluateAll(nodes => nodes.map(node => Number(node.dataset.stone)));
    const outside = Array.from({ length: 225 }, (_, i) => i).find(i => !occupied.includes(i) && !live.some(row => row.index === i));
    await tapPoint(page, outside);
    await page.waitForFunction(() => { const row = document.querySelector('.candidate-row[aria-current="true"]'); return row && row.querySelector(".candidate-score").textContent !== "待评估"; });
    const reviewed = (await rows(page)).find(row => row.selected); const color = name === "index.html" ? 1 : 2;
    assert.equal(await page.locator("#moveCandidates").getAttribute("data-color"), String(color)); assert.equal(reviewed.index, outside);
    assert.match(await page.locator("#candidateNote").innerText(), /榜外评分/);
    const proof = await page.evaluate(({ index, color, budget }) => {
      const job = candidateMessages.findLast(message => message.type === "search" && message.timeMs === budget && message.board[index] === color && message.sideToMove === 3 - color);
      const result = candidateResults.find(event => event.requestId === job?.requestId)?.result; return { job, result };
    }, { index: outside, color, budget: MOVE_REVIEW_MS });
    assert.equal(proof.job.sideToMove, 3 - color); assert.equal(proof.job.board[outside], color); assert.equal(proof.job.board[proof.result.assessment.bestIndex], 0);
    assert.equal(reviewed.rate, `${((1 - proof.result.assessment.winRate) * 100).toFixed(1)}%`);
    report.native.push({ page: name, first, rankedInput: chosen, outside, color, reviewed, assessment: proof.result.assessment });
    pass(`${name}: outside-list point is scored by the opponent's best-reply search on a cloned child board and converted to the original mover`);
    await layout(page, name, "simple pinned outside-list"); await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(name === "index.html" ? "#undoButton" : "#simpleUndoButton").evaluate(element => element.click());
    await page.waitForFunction(() => document.querySelector("#moveCandidates").dataset.mode === "live");
    assert.equal(await page.locator(".candidate-row.selected").count(), 0);
    pass(`${name}: undo removes the pinned review and restarts analysis of the restored position`);
    await waitCandidates(page);
    if(name === 'index.html') {
      await page.locator('#candidateReplyMode').tap();
      assert.equal(await page.locator('#candidateReplyMode').innerText(),'自选应手');
      const input=(await rows(page))[1].index;await tapPoint(page,input);
      await page.waitForFunction(()=>document.querySelector('#stateText').textContent.includes('选择候选'));
      await page.locator('#candidateSwitch').tap();await waitCandidates(page);
      const replyRows=await rows(page),reply=(replyRows[1]??replyRows[0]).index, count=await page.locator('#boardSvg [data-stone]').count();
      await page.locator(`.candidate-row[data-index="${reply}"]`).tap();
      assert.equal(await page.locator('[data-candidate-preview]').getAttribute('data-color'),'2');
      await layout(page,name,'simple selected AI reply');await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:'.cache/candidate-panel/white-reply-preview.png'});
      await page.locator('#candidateApply').tap();await page.waitForFunction(index=>Boolean(document.querySelector(`[data-answer="${index}"]`)),reply);
      await page.waitForTimeout(850);assert.equal(await page.locator('#boardSvg [data-stone]').count(),count+1);
      assert.equal(await page.locator(`[data-stone="${reply}"]`).getAttribute('data-color'),'2');
      assert.equal(await page.locator('[data-candidate-preview]').count(),0);
      pass('index.html: self-selected white reply stays on hold until explicit adoption and adds exactly one AI stone');
    } else {
      const replyRows=await rows(page),reply=(replyRows[1]??replyRows[0]).index,count=await page.locator('#boardSvg [data-stone]').count();
      await page.locator(`.candidate-row[data-index="${reply}"]`).tap();await page.locator('#candidateApply').tap();await page.waitForTimeout(850);
      assert.equal(await page.locator('#boardSvg [data-stone]').count(),count+1);assert.equal(await page.locator(`[data-stone="${reply}"]`).getAttribute('data-color'),'2');
      pass('renju.html: follow mode adopts the selected white move once without inserting another response');
    }
    assert.deepEqual(errors, []); await context.close();
  }
  {
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const board=Array(225).fill(0);board[112]=1;board[97]=2;
    const record=new OpeningSession({rule:'taraguchi10',workflow:'copilot',initialBlackSeat:0,seed:{board,sideToMove:2}}).record();
    await context.addInitScript(record=>{localStorage.setItem('gomoku-candidate-reply-mode','manual');localStorage.setItem('gomoku-thinking-ms','1000');localStorage.setItem('gomoku-opening:/plain/:v1',JSON.stringify({record,perspective:2}));},record);
    const page=await context.newPage();activePage=page;const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'renju.html?view=simple');await waitFive(page);
    assert.equal(await page.locator('#candidateReplyMode').innerText(),'自选应手');
    const input=(await rows(page))[1].index;await tapPoint(page,input);await page.waitForFunction(()=>document.querySelector('#stateText').textContent.includes('选择候选'));
    assert.equal(await page.locator('#boardSvg [data-stone]').count(),3);
    assert.equal(await page.locator('#simpleOpeningFlow h2').innerText(),'选择黑棋应手');
    await page.locator('#candidateSwitch').tap();await waitCandidates(page);const replyRows=await rows(page),reply=(replyRows[1]??replyRows[0]).index;
    await page.locator(`.candidate-row[data-index="${reply}"]`).tap();assert.equal(await page.locator('[data-candidate-preview]').getAttribute('data-color'),'1');
    await layout(page,'renju.html','simple selected copilot reply');await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'.cache/candidate-panel/black-reply-preview.png'});
    await page.locator('#candidateApply').tap();await page.waitForTimeout(850);
    assert.equal(await page.locator('#boardSvg [data-stone]').count(),4);assert.equal(await page.locator(`[data-stone="${reply}"]`).getAttribute('data-color'),'1');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('gomoku-opening:/plain/:v1')).record);
    assert.equal(saved.events.at(-1).automatic,true);assert.equal(saved.events.at(-1).index,reply);
    await page.screenshot({path:'.cache/candidate-panel/copilot-adopted.png'});assert.deepEqual(errors,[]);
    pass('renju.html: copilot holds the real black response, adopts an alternative exactly once and saves it as an automatic move');
    await context.close();
  }
  report.finishedAt = new Date().toISOString(); report.passed = true;
  await writeFile("reports/candidate-panel-v41.json", JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    const diagnostic = await activePage.evaluate(() => ({ panel: document.querySelector("#moveCandidates").outerHTML, state: document.querySelector("#stateText").textContent,
      jobs: window.candidateMessages?.slice(-6), results: window.candidateResults?.slice(-6) }));
    await writeFile(".cache/candidate-panel/failure.json", JSON.stringify({ error: String(error), diagnostic, layouts: report.layouts }, null, 2));
    await activePage.screenshot({ path: ".cache/candidate-panel/failure.png" });
  }
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
