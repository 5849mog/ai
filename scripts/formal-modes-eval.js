// Run the shipped Renju WASM directly in Node. This is a finite flow and
// legality check with synthetic opponents, not a human win-rate benchmark.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRenjuNodeEngine } from "./renju-node-engine.js";
import { OpeningSession, replaySession, isAutomaticTurn, canManualTurn } from "../opening-session.js";
import { adviseOpening } from "../opening-advisor.js";
import { createOpeningBook } from "../opening-book.js";
import { RIF_OPENINGS } from "../rif-opening-pool.js";
import { distinctCandidates, moveVerdict } from "../renju-rules.js";

const output = process.argv[2] ?? "reports/formal-modes-v35.json";
const timeMs = 1000, playPlies = 8;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const sources = {};
for (const name of ["opening-session.js", "opening-advisor.js", "opening-book.js", "rif-opening-pool.js", "renju-rules.js", "recommendations.js", "scripts/renju-node-engine.js", "scripts/formal-modes-eval.js"])
  sources[name] = digest(await readFile(new URL("../" + name, import.meta.url)));
const engineAssets = {};
for (const name of ["engine/rapfi-250615/rapfi-single-simd128.js", "engine/rapfi-250615/rapfi-single-simd128.wasm", "engine/rapfi-250615/rapfi.data", "engine/renju-250615/config.toml"])
  engineAssets[name] = digest(await readFile(new URL("../" + name, import.meta.url)));
const models = JSON.parse(await readFile(new URL("../engine/renju-250615/manifest.json", import.meta.url), "utf8")).models.map(({name,bytes,sha256}) => ({name,bytes,sha256}));
const report = { version: 1, appVersion: "2026.10.10.2", started: new Date().toISOString(), runtime: process.version,
  engine: "1be1551ced57e38d53ed58f6d74bf6f8b4bdc230", engineAssets, models, timeMs, playPlies, sources,
  method: "Shipped single-thread SIMD WASM and verified black/white Renju models; 1-second phase budgets; cleared hash before each case. Both seats use the current advisor, external decisions are scripted. Replay checked after every action. Eight normal-play plies or terminal result. Includes a deliberately unfavorable forced-ten control. No browser, human matches, Elo or exhaustive opening-strength claim.", cases: [] };
const save = async () => { report.finished = new Date().toISOString(); report.casesSha256 = digest(JSON.stringify(report.cases)); await writeFile(output, JSON.stringify(report, null, 2) + "\n"); };
function same(a, b) {
  assert.deepEqual(a.board, b.board); assert.deepEqual(a.candidates, b.candidates);
  assert.deepEqual(a.moves, b.moves); assert.deepEqual(a.colors, b.colors); assert.deepEqual(a.actors, b.actors);
  for (const key of ["stage", "color", "actor", "blackSeat", "playerColor", "winner", "forbidden"]) assert.equal(a[key], b[key], key);
}
const cases = [
  ...[0, 1].flatMap(opener => ["keep", "swap"].map(exchange => ({ name: `rif-seat${opener}-${exchange}`, rule: "rif", opener, exchange }))),
  ...[0, 1].map(opener => ({ name: `taraguchi-seat${opener}-normal-mixed`, rule: "taraguchi10", opener, mask: opener ? 21 : 10 })),
  { name: "taraguchi-normal-all-keep", rule: "taraguchi10", opener: 0, mask: 0 },
  ...[0, 1].map(opener => ({ name: `taraguchi-seat${opener}-ten-far-fourth`, rule: "taraguchi10", opener, mask: opener ? 2 : 5, prefix: [112,97,96,160] })),
  { name: "taraguchi-forced-ten-negative-control", rule: "taraguchi10", opener: 1, mask: 0, prefix: [112,97,80,96], negativeControl: true }
];
const engine = await createRenjuNodeEngine();
const warm = new OpeningSession({ rule: "rif", workflow: "follow" });
for (const index of [112,97,80,96]) { warm.apply({ type: "stone", index }); if (warm.decision) warm.apply({ type: "decision", choice: "keep" }); }
await engine.search({ board: warm.board, sideToMove: 1, timeMs: 100, multiPV: 2, allowSetup: true, allowedMoves: distinctCandidates(warm.board, warm.allowedMoves({ safe: true })) });

for (const config of cases) {
  engine.clear();
  const s = new OpeningSession({ rule: config.rule, workflow: "copilot", initialBlackSeat: null });
  const entry = { ...config, actions: [], searches: [], checks: { replay: 0, proposals: 0, automaticOwnership: 0 }, record: null };
  const book = createOpeningBook({ pool: RIF_OPENINGS, random: () => config.opener ? .75 : 0 });
  // The external RIF opener is also a known legal pool fixture. Only our
  // own initial three are selected through the automatic opening book.
  const externalThree = RIF_OPENINGS[1].points;
  let phase = "setup", normalPlies = 0;
  const search = async options => {
    const result = await engine.search(options);
    assert.match(result.weight, /mix9svqrenju_bs15_(black|white)\.bin\.lz4$/);
    const p = result.assessment?.winRate;
    if (p != null) assert.ok(Number.isFinite(p) && p >= 0 && p <= 1);
    entry.searches.push({ phase, sideToMove: options.sideToMove, timeMs: options.timeMs, multiPV: options.multiPV ?? 1,
      balance: Boolean(options.balance), allowedCount: options.allowedMoves?.length ?? null, boardSha256: digest(options.board), result });
    return result;
  };
  const apply = event => {
    const stage = s.stage, actor = s.actor, color = s.color, before = s.board.slice(), count = s.moves.length;
    const automatic = isAutomaticTurn(s);
    if (stage !== "setup") { assert.equal(automatic, !s.decision && actor === 0); assert.equal(canManualTurn(s), !automatic); }
    if (automatic) { assert.equal(actor, 0); entry.checks.automaticOwnership++; }
    if (["stone", "offer", "select"].includes(event.type)) {
      assert.ok(s.canPoint(event.index)); assert.equal(moveVerdict(before, event.index, color, s.rule).forbidden, "");
    }
    s.apply(event, { automatic });
    if (event.type === "decision") assert.deepEqual(s.board, before);
    if (event.type === "offer") { assert.deepEqual(s.board, before); assert.equal(s.moves.length, count); entry.checks.proposals++; }
    if (event.type === "select") { assert.equal(s.board.filter(Boolean).length, 5); assert.equal(s.board[event.index], 1); }
    same(replaySession(s.record()), s); entry.checks.replay++;
    entry.actions.push({ stage, actor, color, ...event, automatic, nextStage: s.stage, nextActor: s.actor, playerColor: s.playerColor });
  };
  try {
    apply({ type: "start", initialBlackSeat: config.opener });
    while (!s.winner && (s.stage !== "play" || normalPlies < playPlies)) {
      assert.ok(s.events.length < 80, "Flow must make progress"); phase = s.stage;
      let advice = null;
      if (s.decision) {
        const snapshot = JSON.stringify(s.record()); advice = await adviseOpening(s, search, timeMs, { includeAlternative: false });
        assert.equal(JSON.stringify(s.record()), snapshot, "Advice must not mutate the actual game");
        const turn = { swap1: 0, swap2: 1, swap3: 2, route4: 3, swap5: 4 }[s.stage];
        const choice = config.rule === "rif" ? config.exchange : s.stage === "route4" && config.prefix ? "ten" : config.mask & (1 << turn) ? "swap" : "keep";
        entry.actions.push({ stage: s.stage, adviceChoice: advice.choice, externalChoice: choice }); apply({ type: "decision", choice });
      } else if (config.prefix && s.moves.length < 4) apply({ type: "stone", index: config.prefix[s.moves.length] });
      else if (config.rule === "rif" && s.moves.length < 3) {
        const plan = isAutomaticTurn(s) ? book.plan(s)?.points : externalThree;
        assert.ok(plan); apply({ type: "stone", index: plan[s.moves.length] }); book.remember(s);
      } else {
        const snapshot = JSON.stringify(s.record()); advice = await adviseOpening(s, search, timeMs, { includeAlternative: false });
        assert.equal(JSON.stringify(s.record()), snapshot);
        if (s.offerCount) {
          assert.equal(advice.points.length, s.offerCount - s.candidates.length);
          assert.equal(distinctCandidates(s.board, [...s.candidates, ...advice.points]).length, s.candidates.length + advice.points.length);
          for (const index of advice.points) apply({ type: "offer", index });
        } else {
          if (s.stage === "play") { normalPlies++; entry.normalPlies = normalPlies; if (!entry.firstPlayAssessment) entry.firstPlayAssessment = { sideToMove: s.color, playerColor: s.playerColor, result: advice.result }; }
          apply({ type: s.stage === "choose" ? "select" : "stone", index: advice.points[0] });
        }
      }
    }
    const undoCount = (() => { let n = s.events.length - 1; while (n > 0 && s.events[n].automatic) n--; return n; })();
    same(s.undo(), replaySession({ ...s.record(), events: s.events.slice(0, undoCount) }));
    entry.checks.undo = true; entry.record = s.record(); entry.final = { stage: s.stage, moves: s.moves.length, winner: s.winner, forbidden: s.forbidden, playerColor: s.playerColor };
    entry.status = "passed";
  } catch (error) {
    entry.status = "failed"; entry.error = error.stack; entry.record = s.record(); report.cases.push(entry); await save(); throw error;
  }
  report.cases.push(entry); await save();
  console.log(JSON.stringify({ name: entry.name, status: entry.status, final: entry.final, firstPlay: entry.firstPlayAssessment?.result?.assessment, searches: entry.searches.length }));
}
report.status = "passed"; await save();
