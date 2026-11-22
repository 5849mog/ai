import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadWordmark, openWordmark, sealWordmark, WORDMARK_URL } from "../wordmark.js";

const envelope = await readFile(WORDMARK_URL, "utf8");

test("the published wordmark carries authenticated vector outlines instead of text", async () => {
  assert.match(envelope, /^WM1\.[A-Za-z0-9+/]+=*\n$/);
  const glyphs = await openWordmark(envelope);
  assert.equal(glyphs.width, 2200);
  assert.equal(glyphs.height, 1000);
  assert.ok(glyphs.path.split("Z").length > 4);
  assert.deepEqual(await openWordmark(await sealWordmark(glyphs)), glyphs);

  const altered = envelope.split("");
  altered[30] = altered[30] === "A" ? "B" : "A";
  await assert.rejects(openWordmark(altered.join("")));
  await assert.rejects(openWordmark(await sealWordmark({ ...glyphs, path: "<html>" })));
});

test("every load requests the live asset and broken updates leave the last known good ciphertext intact", async () => {
  let lastSaved;
  const storage = { getItem: () => lastSaved, setItem: (_key, value) => { lastSaved = value; } };
  const good = await loadWordmark({ storage, request: async (url, options) => {
    assert.equal(url.href, WORDMARK_URL.href);
    assert.equal(options.cache, "no-store");
    return new Response(envelope);
  } });
  assert.equal(lastSaved, envelope);
  assert.deepEqual(good, await openWordmark(envelope));

  for (const request of [
    async () => new Response("corrupt"),
    async () => new Response("", { status: 404 }),
    async () => { throw new Error("offline"); }
  ]) {
    assert.deepEqual(await loadWordmark({ storage, request }), good);
    assert.equal(lastSaved, envelope);
  }
  assert.equal(await loadWordmark({ request: async () => new Response("corrupt") }), null);
});
