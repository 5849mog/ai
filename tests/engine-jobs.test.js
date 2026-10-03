import test from "node:test";
import assert from "node:assert/strict";
import { EngineJobs } from "../engine-jobs.js";
import { searchCommands } from "../engine-protocol.js";
import { parseOutput } from "../engine-protocol.js";

function setup(options = {}) {
  const commands = [], messages = [], timers = new Map();
  let next = 0;
  const jobs = new EngineJobs({ searchCommands, send: command => commands.push(command),
    emit: message => messages.push(message), now: () => 100,
    setTimer: callback => { const id = ++next; timers.set(id, callback); return id; },
    clearTimer: id => timers.delete(id), ...options });
  const flush = () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); };
  return { jobs, commands, messages, timers, flush };
}
const empty = () => Array(225).fill(0);
const move = index => ({ type: "move", index, x: index % 15, y: Math.floor(index / 15) });

test("background slices resynchronize empty positions and never emit application moves", () => {
  const { jobs, commands, messages, timers, flush } = setup();
  jobs.ponder({ board: empty(), sideToMove: 1, requestId: 1 }); flush();
  assert.equal(commands.at(-1), "BOARD\nDONE");
  jobs.output({ type: "stats", stats: { depth: 7, evaluation: 50 } });
  jobs.output(move(112));
  assert.equal(messages[0].phase, "ponder");
  assert.equal(messages.some(message => message.type === "move"), false);
  assert.equal(timers.size, 1); flush();
  assert.equal(commands.at(-1), "BOARD\nDONE");
  jobs.stopPonder(); jobs.output(move(112));
  assert.equal(timers.size, 0);
});

test("diagnostics include the final interrupted background slice without leaking an application move", () => {
  const slices = [], { jobs, messages, flush } = setup({ onPonderSlice: slice => slices.push(slice) });
  jobs.ponder({ board: empty(), sideToMove: 1, requestId: 12 }); flush();
  jobs.output({ type: "stats", stats: { nodes: 42, depth: 7 } });
  jobs.stopPonder(); const boundary = messages.length;
  jobs.output(move(112));
  assert.equal(messages.length, boundary);
  assert.equal(slices.length, 1); assert.equal(slices[0].requestId, 12);
  assert.equal(slices[0].nodes, 42); assert.equal(slices[0].index, 112);
});

test("a real move interrupts background analysis, rejects its late stats and gets the next search", () => {
  const { jobs, commands, messages, flush } = setup();
  jobs.ponder({ board: empty(), sideToMove: 1, requestId: 1 }); flush();
  const board = empty(); board[112] = 1;
  jobs.search({ board, sideToMove: 2, timeMs: 1000, requestId: 2 });
  assert.equal(commands.at(-1), "STOP");
  jobs.output({ type: "stats", stats: { nodes: 999 } });
  jobs.output(move(112));
  assert.equal(messages.length, 0); flush();
  assert.equal(jobs.active.phase, "search");
  assert.match(commands.at(-1), /^BOARD\n7,7,2\nDONE$/);
  jobs.output({ type: "stats", stats: { nodes: 42 } }); jobs.output(move(113));
  assert.equal(messages[0].requestId, 2);
  assert.equal(messages.at(-1).result.index, 113);
  assert.equal(messages.at(-1).result.nodes, 42);
});

test("turning background analysis off cancels scheduled slices and replacement jobs ignore old output", () => {
  const { jobs, messages, timers, flush } = setup();
  jobs.ponder({ board: empty(), sideToMove: 1, requestId: 1 });
  jobs.stopPonder(); assert.equal(timers.size, 0);
  jobs.ponder({ board: empty(), sideToMove: 1, requestId: 2 }); flush();
  const board = empty(); board[112] = 1;
  jobs.ponder({ board, sideToMove: 2, requestId: 3 });
  jobs.output({ type: "stats", stats: { depth: 8 } }); jobs.output(move(112));
  assert.equal(messages.length, 0); flush();
  assert.equal(jobs.active.requestId, 3);
  jobs.output({ type: "stats", stats: { depth: 9 } });
  assert.equal(messages.at(-1).sideToMove, 2);
});

test("background analysis cannot replace an active real search or accept occupied results", () => {
  const { jobs, flush } = setup();
  const board = empty(); board[112] = 1;
  jobs.search({ board, sideToMove: 2, timeMs: 1000, requestId: 1 }); flush();
  assert.throws(() => jobs.ponder({ board, sideToMove: 2, requestId: 2 }), /落子搜索/);
  assert.throws(() => jobs.output(move(112)), /无效/);
});

test("MultiPV jobs collect two root alternatives and normal searches reset the mode on the same engine", () => {
  const { jobs, commands, messages, flush } = setup();
  const board = empty(); board[112] = 1;
  const original = board.slice();
  jobs.search({ board, sideToMove: 2, timeMs: 2000, requestId: 1, multiPV: 2 }); flush();
  assert.equal(commands.at(-1), "YXNBEST 2");
  for (const line of ["INFO PV 0", "INFO NUMPV 2", "INFO DEPTH 8", "INFO EVAL 300", "INFO BESTLINE 8,7 1,1", "INFO PV DONE",
    "INFO PV 1", "INFO NUMPV 2", "INFO DEPTH 8", "INFO EVAL 250", "INFO BESTLINE 7,8 2,2", "INFO PV DONE", "8,7"]) {
    jobs.output(parseOutput(line), line);
  }
  assert.deepEqual(messages.at(-1).result.recommendations.map(move => move.index), [113, 127]);
  assert.deepEqual(board, original);
  jobs.search({ board, sideToMove: 2, timeMs: 1000, requestId: 2 }); flush();
  assert.equal(commands.at(-1), "BOARD\n7,7,2\nDONE");
  jobs.output(move(114));
  assert.equal(messages.at(-1).result.recommendations, undefined);
});
