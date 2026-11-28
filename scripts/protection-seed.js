import { createHash } from "node:crypto";

// A build identifier, never a secret: repeatable for an identical bundle but
// different when its runtime code changes, so old hard-coded patches go stale.
export function protectionSeed(name, code) {
  const digest = createHash("sha256").update("gomoku-protection-v1\0")
    .update(name).update("\0").update(code).digest();
  return (digest.readUInt32BE(0) & 0x7fffffff) || 1;
}
