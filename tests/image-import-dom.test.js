import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { createImageImport, decodeScreenshot } from "../image-import-ui.js";

const flush = () => new Promise(done => setImmediate(done));
function fixture() {
  // Real HTML/SVG DOM implementations; only bitmap pixels and canvas drawing are
  // supplied by doubles. No browser, layout engine or external service is used.
  const dom = new JSDOM('<style>[hidden]{display:none!important}</style><div id="root"></div>');
  globalThis.document = dom.window.document;
  const pixels = { width: 650, height: 660, data: new Uint8ClampedArray(650 * 660 * 4) };
  for (let i = 0; i < pixels.data.length; i += 4) pixels.data.set([218, 183, 128, 255], i);
  let frame, draws = 0, lastDraw, closed = 0, applied = 0;
  // Place one stone of each color on the default crop's grid.
  for (const [index, rgb] of [[112, [35, 38, 31]], [113, [245, 245, 239]]]) {
    const cx = 39 + index % 15 * 572 / 14, cy = 44 + Math.floor(index / 15) * 572 / 14;
    for (let y = Math.floor(cy - 18); y <= cy + 18; y++) for (let x = Math.floor(cx - 18); x <= cx + 18; x++) {
      if (Math.hypot(x - cx, y - cy) < 17) pixels.data.set([...rgb, 255], (y * pixels.width + x) * 4);
    }
  }
  const context = { clearRect() {}, fillRect() {}, drawImage(...args) { draws++; lastDraw = args; }, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    strokeRect(x, y, w, h) { frame = { left: x, top: y, right: x + w, bottom: y + h }; }, getImageData: () => pixels };
  dom.window.HTMLCanvasElement.prototype.getContext = () => context;
  dom.window.HTMLCanvasElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: this.width, height: this.height }; };
  globalThis.createImageBitmap = async () => ({ width: 650, height: 660, close() { closed++; } });
  const root = document.querySelector("#root"), $ = s => root.querySelector(s);
  const ui = createImageImport(root, { getPosition: () => ({ workflow: "copilot", currentColor: 1 }), applyRecord: () => applied++, close() { ui.dispose(); } });
  ui.open();
  const load = async (file = { type: "image/png", size: 100 }) => { $('input[type=file]').onchange({ target: { files: [file], value: "" } }); await flush(); };
  return { dom, root, $, ui, load, canvas: $('.import-image'), frame: () => ({ ...frame }), draws: () => draws, lastDraw: () => lastDraw, closed: () => closed, applied: () => applied };
}

test("the previous SVG hidden-property assignment leaves the actual CSS hiding it", () => {
  const { dom, $, ui } = fixture(), svg = $("svg");
  assert.equal("hidden" in svg, false);
  svg.hidden = false;
  assert.equal(svg.hasAttribute("hidden"), true);
  assert.equal(dom.window.getComputedStyle(svg).display, "none");
  svg.toggleAttribute("hidden", false);
  assert.notEqual(dom.window.getComputedStyle(svg).display, "none");
  ui.dispose(); dom.window.close();
});

test("recognition reveals a real SVG grid with stones and editable targets through repeated transitions", async () => {
  const { dom, $, ui, load, canvas, frame, applied } = fixture(); await load();
  for (let i = 0; i < 3; i++) {
    const savedFrame = frame(); $('[data-recognize]').click();
    const svg = $("svg");
    assert.equal(svg.hasAttribute("hidden"), false);
    assert.notEqual(dom.window.getComputedStyle(svg).display, "none");
    assert.equal(svg.querySelectorAll('.grid-line').length, 30);
    assert.equal(svg.querySelectorAll('.hit-target').length, 225);
    assert.equal(svg.querySelectorAll('[data-stone]').length, 2);
    assert.equal(svg.querySelector('[data-stone="112"]').getAttribute('data-color'), "1");
    assert.equal(svg.querySelector('[data-stone="113"]').getAttribute('data-color'), "2");
    assert.equal(canvas.hidden, true); assert.equal($('.image-correction').hidden, false);
    assert.equal($('[data-confirm]').disabled, false); assert.equal(applied(), 0);
    $('[data-recalibrate]').click();
    assert.equal(svg.hasAttribute('hidden'), true); assert.equal(canvas.hidden, false);
    assert.deepEqual(frame(), savedFrame); assert.equal($('[data-confirm]').disabled, true);
  }
  ui.dispose(); ui.open();
  assert.equal($("svg").hasAttribute("hidden"), true); assert.equal(canvas.hidden, true);
  assert.equal($('[data-confirm]').disabled, true);
  ui.dispose(); dom.window.close();
});

test("original comparison aligns the grid and preserves corrections, undo history and the current game", async () => {
  const { dom, $, ui, load, canvas, frame, lastDraw, applied } = fixture();
  await load(); const rect = frame(); $('[data-recognize]').click();
  $('svg [data-index="100"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const counts = $('.image-counts').textContent;
  assert.match(counts, /黑 2 · 白 1/); assert.equal($('[data-undo]').disabled, false);
  $('[data-compare]').click();
  assert.equal($('.import-reference').hidden, false); assert.equal($('svg').hasAttribute('hidden'), true);
  assert.equal($('[data-compare]').getAttribute('aria-pressed'), 'true');
  assert.equal($('[data-confirm]').disabled, true); assert.equal($('[data-undo]').disabled, true);
  const [, x, y, width, height] = lastDraw();
  const sx = 528 / (rect.right - rect.left), sy = 528 / (rect.bottom - rect.top);
  assert.ok(Math.abs(x + rect.left * sx - 26) < 1e-8); assert.ok(Math.abs(y + rect.top * sy - 26) < 1e-8);
  assert.ok(Math.abs(width - canvas.width * sx) < 1e-8); assert.ok(Math.abs(height - canvas.height * sy) < 1e-8);
  await load({ type: 'image/gif', size: 100 });
  assert.equal($('.import-reference').hidden, false); assert.equal(applied(), 0);
  $('[data-compare]').click();
  assert.equal($('.import-reference').hidden, true); assert.equal($('svg').hasAttribute('hidden'), false);
  assert.equal($('.image-counts').textContent, counts); assert.equal($('[data-undo]').disabled, false);
  assert.equal($('[data-confirm]').disabled, false); $('[data-undo]').click();
  assert.match($('.image-counts').textContent, /黑 1 · 白 1/);
  $('[data-compare]').click(); $('[data-recalibrate]').click();
  assert.equal($('.import-reference').hidden, true); assert.equal(canvas.hidden, false);
  assert.equal($('[data-compare]').getAttribute('aria-pressed'), 'false'); assert.equal(applied(), 0);
  ui.dispose(); dom.window.close();
});

test("a real phone screenshot opens with a proposed grid, remains editable and resets to the proposed grid", async () => {
  const { dom, $, ui, frame, applied } = fixture();
  const pixels = PNG.sync.read(await readFile(new URL('../reports/mobile.png', import.meta.url)));
  const getContext = dom.window.HTMLCanvasElement.prototype.getContext;
  dom.window.HTMLCanvasElement.prototype.getContext = function (...args) {
    return { ...getContext.call(this, ...args), getImageData: () => pixels };
  };
  // Recreate the UI so its existing canvas context also receives real pixels.
  ui.dispose();
  const root = $(".tool-header").parentElement;
  const replacement = createImageImport(root, { getPosition: () => ({ workflow: "follow", currentColor: 1 }), applyRecord: () => assert.fail("must not apply without confirmation"), close() {} });
  replacement.open();
  globalThis.createImageBitmap = async () => ({ width: pixels.width, height: pixels.height, close() {} });
  root.querySelector('input[type=file]').onchange({ target: { files: [{ type: "image/png", size: 100 }], value: "" } });
  await flush();
  assert.match(root.querySelector('.tool-message').textContent, /自动定位/);
  const proposed = frame();
  for (const [key, value] of Object.entries({ left: 43, top: 274, right: 346, bottom: 577 })) assert.ok(Math.abs(proposed[key] - value) < 2, key);
  const boardCanvas = root.querySelector('.import-image');
  boardCanvas.onpointerdown({ pointerId: 1, button: 0, clientX: proposed.left, clientY: proposed.top });
  boardCanvas.onpointermove({ pointerId: 1, clientX: proposed.left + 12, clientY: proposed.top + 10 });
  boardCanvas.onpointerup({ pointerId: 1 });
  assert.notDeepEqual(frame(), proposed);
  root.querySelector('[data-reset-frame]').click(); assert.deepEqual(frame(), proposed);
  root.querySelector('[data-recognize]').click();
  assert.equal(root.querySelector('svg').hasAttribute('hidden'), false);
  assert.equal(root.querySelector('[data-stone="112"]').getAttribute('data-color'), '1');
  assert.equal(applied(), 0);
  replacement.dispose(); dom.window.close();
});

test("touch resize shows a loupe, ignores a second finger, clamps bounds, and retains the crop on return", async () => {
  const { dom, $, ui, load, canvas, frame } = fixture(); await load(); const before = frame();
  canvas.onpointerdown({ pointerId: 1, isPrimary: true, button: 0, clientX: before.left, clientY: before.top });
  assert.equal($('.import-loupe').hidden, false);
  canvas.onpointerdown({ pointerId: 2, isPrimary: false, button: 0, clientX: before.right, clientY: before.bottom });
  canvas.onpointermove({ pointerId: 2, clientX: 620, clientY: 630 }); assert.deepEqual(frame(), before);
  canvas.onpointermove({ pointerId: 1, clientX: -100, clientY: -100 });
  assert.equal(frame().left, 0); assert.equal(frame().top, 0);
  canvas.onpointercancel({ pointerId: 1 }); assert.equal($('.import-loupe').hidden, true);
  const resized = frame(); $('[data-recognize]').click(); $('[data-recalibrate]').click(); assert.deepEqual(frame(), resized);
  $('[data-reset-frame]').click(); assert.deepEqual(frame(), before);
  canvas.onpointerdown({ pointerId: 3, button: 0, clientX: 320, clientY: 330 });
  canvas.onpointermove({ pointerId: 3, clientX: 3000, clientY: 3000 }); canvas.onlostpointercapture({ pointerId: 3 });
  assert.equal(frame().right, canvas.width - 1); assert.equal(frame().bottom, canvas.height - 1);
  ui.dispose(); dom.window.close();
});

test("racing image loads and disposal reject stale bitmaps; failures preserve the draft and original game", async () => {
  const { dom, $, ui, load, closed, applied } = fixture(); await load(); $('[data-recognize]').click();
  await load({ type: 'image/gif', size: 100 });
  assert.equal($("svg").hasAttribute("hidden"), false); assert.equal($('[data-confirm]').disabled, false);
  assert.equal($("svg").querySelectorAll('[data-stone]').length, 2); assert.equal(applied(), 0);
  let pending; globalThis.createImageBitmap = () => new Promise(done => { pending = done; });
  const first = load(); assert.equal($('[data-confirm]').disabled, true); assert.equal($('[data-recognize]').disabled, true);
  globalThis.createImageBitmap = async () => ({ width: 800, height: 800, close() {} }); await load();
  pending({ width: 650, height: 660, close() { globalThis.staleClosed = true; } }); await first; await flush();
  assert.equal(globalThis.staleClosed, true); assert.equal($('.import-image').width, 800);
  assert.equal($('[data-confirm]').disabled, true); assert.equal($('[data-recognize]').disabled, false);
  await load({ type: 'image/gif', size: 100 }); assert.match($('.tool-message').textContent, /PNG、JPEG/);
  assert.equal($('.import-image').hidden, false); assert.equal(applied(), 0); assert.equal(closed(), 1);
  globalThis.createImageBitmap = () => new Promise(done => { pending = done; }); const last = load(); ui.dispose();
  let discarded = false; pending({ width: 650, height: 660, close() { discarded = true; } }); await last; await flush(); assert.equal(discarded, true);
  dom.window.close();
});

test("image decoder falls back for mobile ImageBitmap failures and always revokes its object URL", async () => {
  const bitmap = globalThis.createImageBitmap, ImageClass = globalThis.Image, objectURL = URL.createObjectURL, revoke = URL.revokeObjectURL;
  let revoked = false;
  try {
    globalThis.createImageBitmap = async () => { throw new Error('unsupported'); };
    URL.createObjectURL = () => 'blob:fixture'; URL.revokeObjectURL = url => { assert.equal(url, 'blob:fixture'); revoked = true; };
    globalThis.Image = class { naturalWidth = 600; naturalHeight = 700; set src(_) { this.onload(); } };
    const result = await decodeScreenshot({}); assert.equal(result.width, 600); assert.equal(result.height, 700); assert.ok(result.source); assert.equal(revoked, true);
    revoked = false; globalThis.Image = class { set src(_) { this.onerror(); } };
    await assert.rejects(decodeScreenshot({}), /无法读取/); assert.equal(revoked, true);
  } finally { globalThis.createImageBitmap = bitmap; globalThis.Image = ImageClass; URL.createObjectURL = objectURL; URL.revokeObjectURL = revoke; }
});

test("mobile styles retain visible intrinsic-sized boards and hidden overlays", async () => {
  const css = await readFile(new URL('../enhancements.css', import.meta.url), 'utf8');
  assert.match(css, /\.enhancement-workspace \[hidden\]/);
  assert.match(css, /\.tool-board-area > svg \{[^}]*width:[^}]*height:[^}]*flex: 0 0 auto/s);
});
