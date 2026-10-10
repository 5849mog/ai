// Actual published WASM in Node. No browser automation or human-match win-rate claim.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRenjuNodeEngine } from "./renju-node-engine.js";
import { OpeningSession } from "../opening-session.js";
import { adviseOpening } from "../opening-advisor.js";
import { adviseOpening as legacy } from "./opening-advisor-v34.fixture.js";
import { distinctCandidates } from "../renju-rules.js";

const engine = await createRenjuNodeEngine();
const output = process.argv[2] ?? "reports/opening-strength-v35.json";
const rate = result => {
  const p = result.assessment?.winRate;
  if (!Number.isFinite(p)) throw new Error("Missing completed evaluation");
  return p;
};
const digest = data => createHash("sha256").update(data).digest("hex");
const sources = {};
for (const name of ["opening-advisor.js", "recommendations.js", "scripts/renju-node-engine.js", "scripts/opening-advisor-v34.fixture.js"])
  sources[name] = digest(await readFile(new URL("../" + name, import.meta.url)));
const report = { version: 1, started: new Date().toISOString(), runtime: process.version,
  engine: "1be1551ced57e38d53ed58f6d74bf6f8b4bdc230", sources,
  method: "Same fixed legal opening prefixes, cleared hash per policy. Search budgets 1/5 seconds. Every selected fifth independently re-evaluated for white with 5 seconds. Estimates only; no human-match or Elo measurement.", cases: [] };
function position(rule, points, stage) {
  const s = new OpeningSession({ rule, workflow: "follow" });
  for (const index of points) {
    s.apply({ type: "stone", index });
    if (s.decision && s.stage !== stage) s.apply({ type: "decision", choice: "keep" });
  }
  if (s.stage !== stage) throw new Error("Wrong fixture stage");
  return s;
}
async function record(entry) {
  report.cases.push(entry); report.finished = new Date().toISOString();
  report.casesSha256 = digest(JSON.stringify(report.cases));
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ name: entry.name, budget: entry.budget, policy: entry.policy,
    choice: entry.advice.choice, points: entry.advice.points, utility: entry.utility, depth: entry.advice.result?.depth }));
}
// Prime NNUE because its trivial one/two-stone shortcuts emit no weight message.
const warm = position("rif", [112,97,80,96], "offer");
await engine.search({ board: warm.board, sideToMove: 1, timeMs: 100, multiPV: 2, allowSetup: true,
  allowedMoves: distinctCandidates(warm.board, warm.allowedMoves({ safe: true })) });
for (const budget of [1000,5000]) for (const [policy, advise] of [["v34",legacy],["v35",adviseOpening]]) {
  const s = position("taraguchi10", [112,96,81,83], "b5"); engine.clear();
  const advice = await advise(s, options => engine.search(options), budget);
  s.apply({ type: "stone", index: advice.points[0] });
  const evaluation = await engine.search({ board: s.board, sideToMove: 2, timeMs: 5000, allowSetup: true });
  const whiteRate = rate(evaluation);
  await record({ name: "taraguchi-fifth-swap", policy, budget, advice, record: s.record(), evaluation,
    utility: Math.min(whiteRate,1-whiteRate) });
}
for (const points of [[112,97,80,96],[112,96,80,97]]) for (const [policy, advise] of [["v34",legacy],["v35",adviseOpening]]) {
  const s = position("rif", points, "offer"); engine.clear();
  const advice = await advise(s, options => engine.search(options), 1000), fifths = [];
  for (const index of advice.points) {
    const board = s.board.slice(); board[index] = 1;
    const evaluation = await engine.search({ board, sideToMove: 2, timeMs: 5000, allowSetup: true });
    fifths.push({ index, evaluation });
  }
  await record({ name: `rif-two-fifths-${points[1]}:${points[2]}`, policy, budget:1000, advice, record: s.record(), fifths,
    utility: 1 - Math.max(...fifths.map(point => rate(point.evaluation))) });
}
for (const points of [[112,97,80,96],[112,97,96,160]]) {
  const s = position("taraguchi10", points, "route4"); engine.clear();
  const advice = await adviseOpening(s, options => engine.search(options), 1000);
  s.apply({ type: "decision", choice: "ten" });
  const offered = await adviseOpening(s, options => engine.search(options), 1000);
  for (const index of offered.points) s.apply({ type: "offer", index });
  const selected = await adviseOpening(s, options => engine.search(options), 1000);
  s.apply({ type: "select", index: selected.points[0] });
  const evaluation = await engine.search({ board: s.board, sideToMove: 2, timeMs: 5000, allowSetup: true });
  await record({ name: `taraguchi-ten-${points[3]}`, policy: "v35", budget:1000, advice, offered, selected,
    record: s.record(), evaluation, utility:1-rate(evaluation) });
}
