import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { publicAddress, phoneLink, tunnelArguments, startPhone } from "../remote/phone.js";

test("phone links use a verified free endpoint and keep the engine key in a fragment", () => {
  const url = "https://abc-123.run.pinggy-free.link", token = "f".repeat(64);
  assert.equal(publicAddress("banner\n" + url + "\n"), url);
  const link = new URL(phoneLink(url, token));
  assert.equal(link.origin, "https://5849mog.github.io"); assert.ok(!link.search.includes(token));
  assert.deepEqual(JSON.parse(decodeURIComponent(link.hash.slice(10))), { url, token });
  for (const address of [url + "/extra", "http://abc.run.pinggy-free.link", "https://bad.example"]) assert.throws(() => phoneLink(address, token));
});
test("tunnel launch uses only a dedicated key and fixed free hosts without a shell", () => {
  const args = tunnelArguments("C:/test/gomoku", 4189, "ap.free.pinggy.io");
  assert.ok(args.includes("IdentityAgent=none")); assert.ok(args.includes("StrictHostKeyChecking=accept-new"));
  assert.ok(args.includes("0:127.0.0.1:4189")); assert.ok(args.includes("qr@ap.free.pinggy.io"));
  assert.throws(() => tunnelArguments("C:/test", 4189, "paid.example"));
});
test("local phone panel protects its pairing link and controls from other origins and unauthenticated requests", async () => {
  const data = await mkdtemp(join(tmpdir(), "gomoku-phone-test-"));
  const app = await startPhone({ data, port: 0, token: "f".repeat(64), launch: false });
  const address = new URL(app.controlUrl), base = address.origin;
  const headers = { Authorization: "Bearer " + address.hash.slice(1) };
  try {
    const shell = await fetch(base); assert.equal(shell.status, 200); assert.ok((await shell.text()).includes("手机"));
    assert.equal((await fetch(base + "/api/status")).status, 403);
    assert.equal((await fetch(base + "/api/status", { headers: { Authorization: "Bearer " + "é".repeat(48) } })).status, 403);
    assert.equal((await fetch(base + "/api/status", { headers: { ...headers, Origin: "https://bad.example" } })).status, 403);
    assert.equal((await fetch(base + "/api/status", { headers })).status, 200);
    assert.equal((await fetch(base + "/api/stop", { method: "POST", headers })).status, 200);
    const status = await (await fetch(base + "/api/status", { headers })).json(); assert.equal(status.state, "stopped"); assert.equal(status.link, "");
  } finally { await app.close(); await rmdir(data); }
});
