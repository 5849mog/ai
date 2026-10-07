import test from "node:test";
import assert from "node:assert/strict";
import { setupGameEnhancements } from "../game-enhancements.js";
import { createImageImport } from "../image-import-ui.js";
import { createRecord, replayRecord } from "../game-record.js";

// Small DOM doubles exercise lifecycle/callback contracts without launching
// a browser, layout engine, screenshot runner or an external service.
class Element extends EventTarget {
  constructor(tag = "div") {
    super(); this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.hidden = false; this.disabled = false;
    this.style = { setProperty() {} }; this.value = ""; this._class = new Set();
    this.classList = { contains: x => this._class.has(x), toggle: (x, state) => state ? this._class.add(x) : this._class.delete(x) };
  }
  set className(value) { this._class = new Set(value.split(/\s+/)); }
  get className() { return [...this._class].join(" "); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = value;
    if (name === "id") this.id = value;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    if (name === "hidden" || name === "disabled") this[name] = true;
    if (name === "value") this.value = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  before(element) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 0, element); element.parentElement = this.parentElement; }
  after(element) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this) + 1, 0, element); element.parentElement = this.parentElement; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  set innerHTML(html) {
    this.children = []; const stack = [this];
    for (const match of html.matchAll(/<\/?[a-zA-Z][^>]*>/g)) {
      const token = match[0]; if (token.startsWith("</")) { stack.pop(); continue; }
      const tag = /^<(\w+)/.exec(token)[1], node = new Element(tag);
      for (const attr of token.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1], attr[2] ?? "");
      stack.at(-1).append(node); if (!["input", "img", "hr", "br"].includes(tag)) stack.push(node);
    }
  }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    const match = /^(\w+)?(?:\[([\w-]+)(?:=([^\]]+))?\])?$/.exec(selector);
    return Boolean(match && (!match[1] || this.tagName === match[1]) && (!match[2] || Object.hasOwn(this.attributes, match[2]) && (match[3] === undefined || this.attributes[match[2]] === match[3])));
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width || 650, height: this.height || 660 }; }
  focus() {}
  click() { if (!this.disabled) { this.onclick?.({ target: this }); this.dispatchEvent(new Event("click")); } }
  getContext() { return { clearRect() {}, drawImage() {}, beginPath() {}, arc() {}, stroke() {}, strokeRect() {}, getImageData: () => globalThis.imagePixels }; }
}
function environment() {
  const body = new Element("body"), doc = new Element("document"); doc.append(body); doc.body = body;
  doc.createElement = tag => new Element(tag); doc.createElementNS = (_, tag) => new Element(tag);
  globalThis.document = doc; globalThis.ResizeObserver = class { observe() {} };
  body.classList.toggle("simple-mode", true); body.innerHTML = `<div class="app-shell"><div class="record-options"></div><details id="recordMenu"></details><div class="game-actions"></div><div id="simpleWinRate"></div><select id="timeSelect"></select><input id="ponderToggle" /></div>`;
  doc.querySelector("#timeSelect").value = "10000"; doc.querySelector("#ponderToggle").checked = true;
  return { doc, body };
}
const finished = () => createRecord([0, 15, 1, 16, 2, 17, 3, 18, 4], 1);
const byText = (root, text) => root.querySelectorAll("button").find(b => b.textContent === text);

test("inline time and pondering controls reuse existing change handlers, collapse after selection, honor busy state", () => {
  const { doc } = environment(); let timeChanges = 0, ponderChanges = 0;
  doc.querySelector("#timeSelect").addEventListener("change", () => timeChanges++);
  doc.querySelector("#ponderToggle").addEventListener("change", () => ponderChanges++);
  setupGameEnhancements({ getPosition: () => ({ winner: 0 }), getRecord: () => createRecord([], 1), onWorkspace() {}, applyRecord() {}, cancelSearch() {}, newGame() {} });
  const toggle = doc.querySelector("[aria-controls=simpleQuickTools]"), panel = doc.querySelector("#simpleQuickTools");
  toggle.click(); assert.equal(panel.hidden, false); doc.querySelector("[data-time=1000]").click();
  assert.equal(doc.querySelector("#timeSelect").value, "1000"); assert.equal(timeChanges, 1); assert.equal(panel.hidden, true);
  toggle.click(); doc.querySelector("[data-ponder]").click(); assert.equal(ponderChanges, 1); assert.equal(doc.querySelector("#ponderToggle").checked, false); assert.equal(panel.hidden, true);
  doc.querySelector("#timeSelect").disabled = true; toggle.click(); doc.querySelector("[data-time=5000]").click(); assert.equal(timeChanges, 1);
});

test("review entry only exists in terminal window; New cancels a pending analysis and no late response reopens it", async () => {
  const { doc } = environment(); let winner = 0, record = createRecord([], 1), resolve, calls = 0, cancellations = 0, newCount = 0;
  const lifecycle = [], ui = setupGameEnhancements({ getPosition: () => ({ winner }), getRecord: () => record,
    onWorkspace: value => lifecycle.push(value), applyRecord() {}, cancelSearch: () => cancellations++, search: () => { calls++; return new Promise(done => { resolve = done; }); },
    newGame: () => { newCount++; winner = 0; record = createRecord([], 1); ui.render(); }
  });
  const entry = byText(doc.querySelector("#simpleStatusRow"), "复盘本局");
  assert.equal(entry.hidden, true); entry.click(); assert.equal(ui.active, null);
  winner = 1; record = finished(); const copy = JSON.stringify(record); ui.render(); assert.equal(entry.hidden, false); entry.click();
  assert.equal(ui.active, "review"); assert.equal(doc.querySelector(".app-shell").hidden, true); assert.equal(calls, 1); assert.equal(JSON.stringify(record), copy);
  doc.querySelector("[data-new]").click(); assert.equal(newCount, 1); assert.equal(ui.active, null); assert.equal(entry.hidden, true);
  assert.equal(doc.querySelector(".enhancement-workspace").hidden, true); assert.deepEqual(lifecycle, [true, false]); assert.ok(cancellations > 0);
  resolve({ index: 112 }); await new Promise(done => setImmediate(done)); assert.equal(calls, 1); assert.equal(ui.active, null);
});

test("undo or record replacement closes a terminal review; image workspace returns without applying a draft", () => {
  const { doc } = environment(); let winner = 1, record = finished(), applied = 0;
  const ui = setupGameEnhancements({ getPosition: () => ({ winner }), getRecord: () => record, onWorkspace() {}, applyRecord: () => applied++, cancelSearch() {}, search: () => new Promise(() => {}), newGame() {} });
  byText(doc.querySelector("#simpleStatusRow"), "复盘本局").click(); winner = 0; record = createRecord([112], 1); ui.render(); assert.equal(ui.active, null);
  byText(doc.querySelector(".record-options"), "截图导入").click(); assert.equal(ui.active, "image");
  doc.querySelector("[data-close]").click(); assert.equal(applied, 0); assert.equal(ui.active, null); assert.equal(doc.querySelector(".app-shell").hidden, false);
});

async function imageDraft(workflow) {
  const { doc, body } = environment(), root = new Element(); body.append(root); let applied = null, closes = 0;
  globalThis.imagePixels = { width: 650, height: 660, data: new Uint8ClampedArray(650 * 660 * 4) };
  for (let i = 0; i < imagePixels.data.length; i += 4) imagePixels.data.set([218, 183, 128, 255], i);
  globalThis.createImageBitmap = async () => ({ width: 650, height: 660, close() {} });
  const ui = createImageImport(root, { getPosition: () => ({ workflow, currentColor: 1 }), applyRecord: record => { replayRecord(record); applied = record; }, close: () => { closes++; ui.dispose(); } });
  ui.open(); const input = root.querySelector("input[type=file]"); input.onchange({ target: { files: [{ type: "image/png", size: 100 }], value: "" } });
  await new Promise(done => setImmediate(done)); const canvas = root.querySelector("canvas");
  for (const [clientX, clientY] of [[40, 40], [600, 600]]) canvas.onclick({ clientX, clientY });
  root.querySelector("[data-recognize]").click(); assert.equal(root.querySelector("svg").hidden, false);
  const point = index => { const target = doc.createElement("circle"); target.setAttribute("data-index", String(index)); root.querySelector("svg").onclick({ target }); };
  return { root, ui, point, result: () => ({ applied, closes }) };
}
test("image calibration/correction remains a draft until confirmation and continuation roles use selected side", async () => {
  for (const workflow of [undefined, "follow", "duel", "copilot"]) for (const side of [1, 2]) for (const actor of ["player", "ai"]) {
    const { root, point, result } = await imageDraft(workflow);
    point(112); root.querySelector("[data-color=2]").click(); point(97);
    assert.equal(result().applied, null); root.querySelector("[data-side]").value = String(side); root.querySelector("[data-actor]").value = actor;
    root.querySelector("[data-confirm]").click();
    const { applied, closes } = result(); assert.ok(applied); assert.equal(closes, 1); assert.equal(applied.setup.board[112], 1); assert.equal(applied.setup.board[97], 2); assert.equal(applied.setup.sideToMove, side);
    assert.equal(applied.playerColor, actor === "player" ? workflow === "copilot" ? 3 - side : side : workflow === "copilot" ? side : 3 - side);
  }
});
test("completed board cannot replace the current game through image import", async () => {
  const { root, point, result, ui } = await imageDraft(); for (let i = 0; i < 5; i++) point(i);
  root.querySelector("[data-confirm]").click(); assert.equal(result().applied, null); assert.equal(result().closes, 0); assert.match(root.querySelector(".tool-message").textContent, /当前对局保持不变/); ui.dispose();
});
