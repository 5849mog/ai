import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadWordmark, openWordmark, sealWordmark, WORDMARK_URL } from "../wordmark.js";
import { WORDMARK_TRUST } from "../wordmark-trust.js";

const published = await readFile(WORDMARK_URL, "utf8");

async function signer(minimumRevision = 1) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey)).toString("base64");
  return { privateKey: keys.privateKey, trust: { publicKey, minimumRevision } };
}

function memory(initial) {
  let saved = initial;
  return { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
}

test("production outlines verify with the pinned public key and reject tampering or a different key", async () => {
  assert.match(published, /^WM2\.[1-9][0-9]{0,8}\.[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]{86}==\n$/);
  const { outline, revision } = await openWordmark(published);
  assert.ok(revision >= WORDMARK_TRUST.minimumRevision);
  assert.equal(outline.width, 2200);
  assert.equal(outline.height, 1000);
  assert.ok(outline.path.split("Z").length > 4);
  const [magic, edition, sealed, signature] = published.trim().split(".");
  const change = text => (text.startsWith("A") ? "B" : "A") + text.slice(1);
  await assert.rejects(openWordmark([magic, edition, change(sealed), signature].join(".")), /Invalid wordmark signature/);
  await assert.rejects(openWordmark([magic, String(revision + 1), sealed, signature].join(".")), /Invalid wordmark signature/);
  await assert.rejects(openWordmark([magic, edition, sealed, change(signature)].join(".")), /Invalid wordmark signature/);
  const forged = await signer();
  await assert.rejects(openWordmark(await sealWordmark(outline, 500, forged.privateKey)), /Invalid wordmark signature/);
  await assert.rejects(openWordmark("WM1." + sealed), /Invalid signed wordmark envelope/);
});

test("only an increasing signed revision replaces an authenticated offline copy", async () => {
  const { outline } = await openWordmark(published);
  const { privateKey, trust } = await signer(2);
  const old = await sealWordmark(outline, 1, privateKey);
  const first = await sealWordmark(outline, 2, privateKey);
  const updated = { ...outline, path: "M0 0H2200V1000H0Z" };
  const next = await sealWordmark(updated, 3, privateKey);
  const conflicting = await sealWordmark(outline, 3, privateKey);
  const differentSigner = await signer();
  const forged = await sealWordmark(outline, 4, differentSigner.privateKey);
  const storage = memory();
  const load = (request, target = storage) => loadWordmark({ trust, storage: target, request });
  const fetches = async (url, options) => {
    assert.equal(url.href, WORDMARK_URL.href);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    return new Response(first);
  };
  assert.equal(await load(async () => new Response(old)), null);
  assert.deepEqual(await load(fetches), outline);
  assert.deepEqual(await load(async () => new Response(next)), updated);
  const badResponses = [
    async () => new Response(first),
    async () => new Response(conflicting),
    async () => new Response(forged),
    async () => new Response("A".repeat(10000)),
    async () => new Response("", { status: 404 }),
    async () => { throw new Error("offline"); }
  ];
  for (const request of badResponses) {
    assert.deepEqual(await load(request), updated);
    assert.equal(storage.getItem(), next);
  }
  assert.equal(await load(badResponses.at(-1), memory(forged)), null);
  await assert.rejects(openWordmark(await sealWordmark({ ...outline, path: "<html>" }, 4, privateKey), trust), /Invalid wordmark contours/);
});
