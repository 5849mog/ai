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
  toggleAttribute(name, force) {
    const present = force ?? !Object.hasOwn(this.attributes, name);
    if (present) this.setAttribute(name, ""); else delete this.attributes[name];
    return present;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  before(element) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 0, element); element.parentElement = this.parentElement; }
  after(element) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this) + 1, 0, element); element.parentElement = this.parentElement; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  get innerHTML() { return this._innerHTML ?? ""; }
  set innerHTML(html) {
    this._innerHTML = html;
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
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
  click() { if (!this.disabled) { this.onclick?.({ target: this }); this.dispatchEvent(new Event("click")); } }
  getContext() { return { clearRect() {}, fillRect() {}, drawImage() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, strokeRect(x, y, width, height) { globalThis.lastImportFrame = { left: x, top: y, right: x + width, bottom: y + height }; }, getImageData: () => globalThis.imagePixels }; }
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
  globalThis.lastImportFrame = null;
  for (let i = 0; i < imagePixels.data.length; i += 4) imagePixels.data.set([218, 183, 128, 255], i);
  globalThis.createImageBitmap = async () => ({ width: 650, height: 660, close() {} });
  const ui = createImageImport(root, { getPosition: () => ({ workflow, currentColor: 1 }), applyRecord: record => { replayRecord(record); applied = record; }, close: () => { closes++; ui.dispose(); } });
  ui.open(); const input = root.querySelector("input[type=file]"); input.onchange({ target: { files: [{ type: "image/png", size: 100 }], value: "" } });
  await new Promise(done => setImmediate(done)); const canvas = root.querySelector("canvas");
  const recognize = () => {
    root.querySelector("[data-recognize]").click();
    const svg = root.querySelector("svg");
    assert.equal(svg.getAttribute("hidden"), null); assert.equal(svg.getAttribute("width"), "580"); assert.equal(svg.getAttribute("height"), "580");
    assert.match(svg.innerHTML, /class="grid-line"/);
  };
  const point = index => { const target = doc.createElement("circle"); target.setAttribute("data-index", String(index)); root.querySelector("svg").onclick({ target }); };
  return { root, ui, canvas, point, recognize, result: () => ({ applied, closes }) };
}
test("image calibration frame can be dragged and resized with pointer input", async () => {
  const { ui, canvas } = await imageDraft(), initial = { ...lastImportFrame };
  assert.ok(initial.right - initial.left > 500);
  canvas.onpointerdown({ pointerId: 1, button: 0, clientX: 320, clientY: 330, preventDefault() {} });
  canvas.onpointermove({ pointerId: 1, clientX: 340, clientY: 345 }); canvas.onpointerup({ pointerId: 1 });
  assert.equal(lastImportFrame.left, initial.left + 20); assert.equal(lastImportFrame.top, initial.top + 15);
  const moved = { ...lastImportFrame };
  canvas.onpointerdown({ pointerId: 2, button: 0, clientX: moved.left, clientY: moved.top, preventDefault() {} });
  canvas.onpointermove({ pointerId: 2, clientX: moved.left - 20, clientY: moved.top - 25 }); canvas.onpointerup({ pointerId: 2 });
  assert.equal(lastImportFrame.left, moved.left - 20); assert.equal(lastImportFrame.top, moved.top - 25);
  assert.equal(lastImportFrame.right, moved.right); assert.equal(lastImportFrame.bottom, moved.bottom);
  ui.dispose();
});
test("image calibration/correction remains a draft until confirmation and continuation roles use selected side", async () => {
  for (const workflow of [undefined, "follow", "duel", "copilot"]) for (const side of [1, 2]) for (const actor of ["player", "ai"]) {
    const { root, point, result, recognize } = await imageDraft(workflow);
    assert.match(root.querySelector(".tool-message").textContent, /A15、右下 O1/);
    assert.match(root.querySelector(".tool-message").textContent, /不要框进木质边框/);
    recognize();
    point(112); root.querySelector("[data-color=2]").click(); point(97);
    assert.equal(result().applied, null); root.querySelector("[data-side]").value = String(side); root.querySelector("[data-actor]").value = actor;
    root.querySelector("[data-confirm]").click();
    const { applied, closes } = result(); assert.ok(applied); assert.equal(closes, 1); assert.equal(applied.setup.board[112], 1); assert.equal(applied.setup.board[97], 2); assert.equal(applied.setup.sideToMove, side);
    assert.equal(applied.playerColor, actor === "player" ? workflow === "copilot" ? 3 - side : side : workflow === "copilot" ? side : 3 - side);
  }
});
test("completed board cannot replace the current game through image import", async () => {
  const { root, point, result, ui, recognize } = await imageDraft(); recognize(); for (let i = 0; i < 5; i++) point(i);
  root.querySelector("[data-confirm]").click(); assert.equal(result().applied, null); assert.equal(result().closes, 0); assert.match(root.querySelector(".tool-message").textContent, /当前对局保持不变/); ui.dispose();
});
