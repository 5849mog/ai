import test from "node:test";
import assert from "node:assert/strict";
import { createScheduledTask } from "../ui-scheduler.js";

function clock() {
  let time = 0, id = 0; const timers = new Map();
  return {
    setTimer: (run, delay) => { const key = ++id; timers.set(key, { run, at: time + delay }); return key; },
    clearTimer: key => timers.delete(key),
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]); time = next[1].at; next[1].run();
      }
      time = end;
    }
  };
}
test("bursts paint the latest state once and cancel discards old-position callbacks", () => {
  const c = clock(), values = []; let value = 0;
  const task = createScheduledTask(() => values.push(value), 100, c);
  for (let i = 0; i < 30; i++) { value = i; task.schedule(); }
  c.advance(99); assert.deepEqual(values, []); c.advance(1); assert.deepEqual(values, [29]);
  task.schedule(); task.cancel(); c.advance(100); assert.deepEqual(values, [29]);
});
test("continuous updates cannot postpone saving beyond the original deadline; flush saves exactly once", () => {
  const c = clock(); let saves = 0; const task = createScheduledTask(() => saves++, 500, c);
  for (let i = 0; i < 5; i++) { task.schedule(); c.advance(100); }
  assert.equal(saves, 1); task.schedule(); task.flush(); assert.equal(saves, 2);
  task.flush(); c.advance(500); assert.equal(saves, 2);
});
