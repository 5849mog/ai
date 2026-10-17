import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupRemoteUi } from "../remote-engine-ui.js";
import { readRemoteSettings } from "../remote-engine.js";
const token = "a".repeat(64);
function fixture(options = {}) {
  const dom = new JSDOM('<details id="recordMenu"><button id="openRemoteEngine">电脑引擎</button></details><button data-remote-menu>电脑引擎</button>', { url: options.url ?? "https://example.com/ai/" });
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new dom.window.Event("close")); };
  let reloads = 0;
  const ui = setupRemoteUi({ doc: dom.window.document, storage: dom.window.sessionStorage, reload: () => reloads++,
    probe: options.probe ?? (async () => ({ threads: 15, memoryMiB: 256, rules: ["freestyle", "renju", "rif", "taraguchi10"] })) });
  return { dom, ui, doc: dom.window.document, reloads: () => reloads };
}
const tick = () => new Promise(done => setImmediate(done));
test("a launcher link only prefills pairing, removes the key from history, and waits for the user's connection", async () => {
  const f = fixture({ url: "https://example.com/ai/#computer=" + encodeURIComponent(JSON.stringify({ url: "https://engine.example", token })) });
  assert.equal(f.ui.dialog.open, true); assert.equal(f.dom.window.location.hash, ""); assert.equal(readRemoteSettings(f.dom.window.sessionStorage), null);
  f.doc.querySelector("#remoteConnect").click(); await tick(); assert.equal(f.reloads(), 1);
  assert.equal(readRemoteSettings(f.dom.window.sessionStorage).url, "wss://engine.example/gomoku"); f.dom.window.close();
});
test("cancelling an unfinished connection does not save it; failed probes keep the old selection", async () => {
  let resolve; const f = fixture({ probe: () => new Promise(done => { resolve = done; }) }); f.ui.open();
  f.doc.querySelector("#remoteUrl").value = "https://engine.example"; f.doc.querySelector("#remoteToken").value = token;
  f.doc.querySelector("#remoteConnect").click(); f.ui.dialog.close(); resolve({ rules: ["freestyle", "rif", "taraguchi10"] }); await tick();
  assert.equal(f.reloads(), 0); assert.equal(readRemoteSettings(f.dom.window.sessionStorage), null); f.dom.window.close();
});
test("simple-mode entry opens the same pairing controls without restarting a game", () => {
  const f = fixture(); f.doc.querySelector("[data-remote-menu]").click(); assert.equal(f.ui.dialog.open, true); assert.equal(f.reloads(), 0); f.dom.window.close();
});
