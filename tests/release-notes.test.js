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
    assert.match(panel.textContent, /新版改动/); assert.match(panel.textContent, /当前版本/);
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
