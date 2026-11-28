import test from "node:test";
import assert from "node:assert/strict";
import { protectionSeed } from "../scripts/protection-seed.js";

test("bundle seeds are reproducible and vary with the bundle and runtime code", () => {
  const first = protectionSeed("opening-app.protected.js", "const version=1");
  assert.equal(first, protectionSeed("opening-app.protected.js", "const version=1"));
  assert.notEqual(first, protectionSeed("opening-app.protected.js", "const version=2"));
  assert.notEqual(first, protectionSeed("engine.worker.protected.js", "const version=1"));
  assert.ok(Number.isInteger(first) && first > 0 && first <= 0x7fffffff);
});
