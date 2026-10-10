import { writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRenjuNodeEngine } from "./renju-node-engine.js";
import { OpeningSession } from "../opening-session.js";
import { adviseOpening } from "../opening-advisor.js";
import { transform, inCentral, moveVerdict } from "../renju-rules.js";

const output = process.argv[2] ?? "reports/opening-pool-evaluation.json";
const budgets = (process.argv[3] ?? "1000,3000").split(",").map(Number);
if (!budgets.length || budgets.some(value => !Number.isInteger(value) || value < 1 || value > 30000)) throw new Error("Invalid search budget");
const selectedKeys = process.argv[4] ? new Set(process.argv[4].split(",")) : null;
const candidates = new Map();
for (let second = 0; second < 225; second++) if (second !== 112 && inCentral(second, 3)) {
  for (let third = 0; third < 225; third++) if (![112, second].includes(third) && inCentral(third, 5)) {
    const variants = Array.from({ length: 8 }, (_, symmetry) => [transform(second, symmetry), transform(third, symmetry)]);
    variants.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [a, b] = variants[0], key = `${a}:${b}`;
    candidates.set(key, { key, points: [112, a, b] });
  }
}
if (candidates.size !== 26) throw new Error("Expected 26 RIF opening classes");
if (selectedKeys && [...selectedKeys].some(key => !candidates.has(key))) throw new Error("Unknown opening class");
const engine = await createRenjuNodeEngine();
const rate = result => {
  const value = result.assessment?.winRate ?? result.winRate;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Missing evaluation");
  return value;
};
let report;
try { report = JSON.parse(await readFile(output, "utf8")); } catch {}
const implementation = createHash("sha256").update(await readFile(new URL("./renju-node-engine.js", import.meta.url))).digest("hex");
const advisorImplementation = createHash("sha256").update(await readFile(new URL("../opening-advisor.js", import.meta.url))).digest("hex");
const recommendationsImplementation = createHash("sha256").update(await readFile(new URL("../recommendations.js", import.meta.url))).digest("hex");
if (report && report.implementation !== implementation) throw new Error("Evaluation implementation changed; use a new output file");
if (report && (report.advisorImplementation !== advisorImplementation || report.recommendationsImplementation !== recommendationsImplementation)) throw new Error("Opening strategy changed; use a new output file");
const models = JSON.parse(await readFile(new URL("../engine/renju-250615/manifest.json", import.meta.url)));
report ??= { version: 1, implementation, advisorImplementation, recommendationsImplementation, started: new Date().toISOString(), runtime: process.version, platform: process.platform,
  engine: "1be1551ced57e38d53ed58f6d74bf6f8b4bdc230", models: models.models.map(m => ({ name: m.name, sha256: m.sha256 })),
  method: "Each budget clears the hash. Current advisor compares up to three white fourths with two-fifth proposal floors, proposes two legal non-equivalent fifths, then evaluates both for white at the full budget. Opener utility is min(blackRate,1-blackRate). Finite search estimates, not a proof of balance.", cases: [] };
for (const candidate of candidates.values()) for (const budget of budgets) {
  if (selectedKeys && !selectedKeys.has(candidate.key)) continue;
  if (report.cases.some(c => c.key === candidate.key && c.budget === budget)) continue;
  engine.clear();
  const session = new OpeningSession({ rule: "rif", workflow: "follow" });
  for (const index of candidate.points) session.apply({ type: "stone", index });
  session.apply({ type: "decision", choice: "keep" });
  const fourth = await adviseOpening(session, options => engine.search(options), budget);
  session.apply({ type: "stone", index: fourth.points[0] });
  const offer = await adviseOpening(session, options => engine.search(options), budget);
  for (const index of offer.points) session.apply({ type: "offer", index });
  const evaluations = [];
  for (const index of session.candidates) {
    const board = session.board.slice(); board[index] = 1;
    if (moveVerdict(session.board, index, 1, "rif").forbidden) throw new Error("Forbidden fifth");
    const result = await engine.search({ board, sideToMove: 2, timeMs: budget, allowSetup: true });
    evaluations.push({ index, whiteRate: rate(result), depth: result.depth, nodes: result.nodes, elapsed: result.elapsed, mate: result.mate ?? null });
  }
  const whiteRate = Math.max(...evaluations.map(c => c.whiteRate));
  const entry = { ...candidate, budget, fourth: fourth.points[0], fifths: evaluations, blackRate: 1 - whiteRate, openerUtility: Math.min(whiteRate, 1 - whiteRate) };
  report.cases.push(entry);
  report.finished = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ key: entry.key, budget, fourth: entry.fourth, blackRate: +entry.blackRate.toFixed(4), openerUtility: +entry.openerUtility.toFixed(4), depth: evaluations.map(e => e.depth) }));
}
report.casesSha256 = createHash("sha256").update(JSON.stringify(report.cases)).digest("hex");
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
