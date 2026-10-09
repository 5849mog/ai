// Coalesce bursts without postponing work forever during continuous pondering.
export function createScheduledTask(run, delay, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  function cancel() { if (timer !== null) clearTimer(timer); timer = null; }
  function flush() { if (timer === null) return; cancel(); run(); }
  return {
    schedule() { if (timer === null) timer = setTimer(() => { timer = null; run(); }, delay); },
    cancel, flush
  };
}
