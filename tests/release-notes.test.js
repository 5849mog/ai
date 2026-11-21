import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { APP_VERSION } from "../app-release.js";
import { parseReleaseFeed, setupReleaseNotes } from "../release-notes.js";

const entry = version => ({ version, title: "<b>日志</b>", changes: ["内容"] });
const feed = (revision, ...versions) => JSON.stringify({ schema: 1, revision, releases: versions.map(entry) });
const newer = APP_VERSION.replace(/\d+$/, patch => String(Number(patch) + 1));

test("published feed covers the current release and rejects invalid editions", async () => {
  const published = parseReleaseFeed(await readFile(new URL("../content/feed.json", import.meta.url), "utf8"));
  assert.equal(published.releases[0].version, APP_VERSION);
  assert.throws(() => parseReleaseFeed(feed(1, APP_VERSION, APP_VERSION)));
  assert.throws(() => parseReleaseFeed(feed(0, APP_VERSION)));
  assert.throws(() => parseReleaseFeed(feed(1, "latest")));
});

test("notes share one startup request, use text rendering, and retain the latest valid saved edition", async () => {
  const dom = new JSDOM('<div data-release-notes="full"></div><div data-release-notes="simple"></div>');
  const doc = dom.window.document, saved = new Map();
  let next = feed(2, APP_VERSION, newer), calls = 0;
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const fetchFeed = async (_, { cache }) => {
    calls++; assert.equal(cache, "no-store");
    if (next === null) throw new Error("offline");
    return new Response(next);
  };
  try {
    const notes = setupReleaseNotes({ container: doc, storage, fetchFeed });
    await notes.refresh(); assert.equal(calls, 1);
    const first = doc.querySelector("[data-notes-toggle]"); first.click();
    const panel = doc.getElementById(first.getAttribute("aria-controls")); assert.equal(panel.hidden, false);
    assert.match(panel.querySelector("article").textContent, /新版改动/);
    const older = panel.querySelector("[data-notes-next]");
    older.click();
    assert.match(panel.querySelector("article").textContent, /当前版本/);
    assert.equal(panel.querySelector("h3").textContent, "<b>日志</b>"); assert.equal(panel.querySelector("h3 b"), null);
    next = feed(3, APP_VERSION, newer).replaceAll("内容", "独立发布的新文案");
    await notes.refresh(); assert.match(panel.textContent, /独立发布的新文案/);
    next = feed(1, APP_VERSION); await notes.refresh(); assert.match(panel.textContent, /较新的已保存日志/);
    next = '{'; await notes.refresh(); assert.match(panel.textContent, /上次保存/);
    next = null;
    const restarted = setupReleaseNotes({ container: doc, storage, fetchFeed }); await restarted.refresh();
    assert.match(doc.querySelector("[data-release-notes='simple']").textContent, /独立发布的新文案/);
  } finally { dom.window.close(); }
});

test("the bounded reader renders one version, browses matches and shares the selected version", async () => {
  const dom = new JSDOM('<div data-release-notes="full"></div><div data-release-notes="simple"></div>');
  const doc = dom.window.document;
  const versions = Array.from({ length: 12 }, (_, index) => `2026.10.${String(index + 1).padStart(2, "0")}.1`);
  let revision = 1, fail = false;
  const makeFeed = () => ({ schema: 1, revision, releases: versions.map((version, index) => ({
    version, title: `第 ${index + 1} 版`, changes: [index === 0 ? "最早的校正记录" : "其他改动"]
  })) });
  try {
    const ui = setupReleaseNotes({ container: doc, fetchFeed: async () => {
      if (fail) throw new Error("offline");
      return new Response(JSON.stringify(makeFeed()));
    } });
    await ui.refresh();
    const full = doc.querySelector("[data-release-notes=full]"), simple = doc.querySelector("[data-release-notes=simple]");
    const get = (key, root = full) => root.querySelector(`[data-notes-${key}]`);
    const version = get("version"), next = get("next"), prev = get("prev"), search = get("search");
    assert.equal(version.options.length, 12);
    assert.equal(version.value, versions.at(-1));
    assert.equal(full.querySelectorAll("article h3").length, 1);
    assert.equal(prev.getAttribute("aria-disabled"), "true");
    next.click();
    assert.equal(version.value, versions.at(-2));
    version.value = versions[0];
    version.dispatchEvent(new dom.window.Event("change"));
    assert.equal(get("version", simple).value, versions[0]);
    assert.equal(next.getAttribute("aria-disabled"), "true");
    next.click();
    assert.equal(version.value, versions[0]);
    revision++;
    await ui.refresh();
    fail = true;
    await ui.refresh();
    assert.equal(version.value, versions[0]);
    search.value = "最早 校正";
    search.dispatchEvent(new dom.window.Event("input"));
    assert.deepEqual([...version.options].map(option => option.value), [versions[0]]);
    const newerOnly = get("newer");
    newerOnly.checked = true;
    newerOnly.dispatchEvent(new dom.window.Event("change"));
    assert.equal(get("empty").hidden, false);
    assert.equal(full.querySelector("article").hidden, true);
    get("clear").click();
    assert.equal(version.value, versions.at(-1));
    assert.equal(get("empty").hidden, true);
    get("toggle").click();
    assert.equal(doc.activeElement, get("back"));
    doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(full.querySelector("section").hidden, true);
    assert.equal(doc.activeElement, get("toggle"));
  } finally { dom.window.close(); }
});
