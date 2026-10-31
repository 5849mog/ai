// Validate every source hash, tactical answer and game move before rendering.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { TACTICS, verifyTactic } from "../tests/fixtures/tactics.js";
import { outcome } from "../game-rules.js";
import { summarizeGames, summarizePositions, summarizeSearches } from "./strength-metrics.js";

const input = process.argv[2] ?? "reports/strength-baseline-v1.json";
const output = process.argv[3] ?? input.replace(/\.json$/, ".md");
const digest = value => createHash("sha256").update(value).digest("hex");
const report = JSON.parse(await readFile(input, "utf8"));
assert.equal(report.complete, true, "benchmark is incomplete");
for (const [path, expected] of Object.entries({ ...report.identity.sources, ...report.identity.assets })) {
  assert.equal(digest(await readFile(path)), expected, `source or asset hash mismatch: ${path}`);
}
const fixtures = new Map(TACTICS.map(fixture => [fixture.id, { ...fixture, ...verifyTactic(fixture) }]));
assert.equal(report.identity.fixturesSha256, digest(JSON.stringify([...fixtures.values()].map(fixture => ({
  ...fixture, proofs: fixture.proofs
})))), "fixture set changed");
for (const run of report.positionRuns) {
  const fixture = fixtures.get(run.fixtureId);
  assert.ok(fixture, `unknown fixture: ${run.fixtureId}`);
  assert.equal(digest(Buffer.from(fixture.board)), report.identity.fixtures.find(item => item.id === fixture.id).boardSha256);
  assert.equal(run.correct, fixture.expected.includes(run.index), `answer mismatch: ${run.id}`);
  assert.ok(fixture.board[run.index] === 0, `occupied answer: ${run.id}`);
}
for (const budget of report.identity.positionBudgets) {
  const runs = report.positionRuns.filter(run => run.budgetMs === budget);
  assert.equal(runs.length, fixtures.size, `missing position runs at ${budget}ms`);
  assert.deepEqual(report.summary.positions[budget], summarizePositions(runs));
}

const openings = new Map(report.identity.openings.map(opening => [opening.id, opening]));
for (const game of report.games) {
  assert.equal(game.status, "finished", `unfinished game: ${game.id}`);
  const opening = openings.get(game.openingId);
  assert.ok(opening, `unknown opening: ${game.openingId}`);
  const board = Uint8Array.from(opening.board);
  let side = opening.sideToMove;
  let winner = 0;
  for (const move of game.moves) {
    assert.equal(move.color, side, `${game.id}: wrong side to move`);
    assert.ok(Number.isInteger(move.index) && board[move.index] === 0, `${game.id}: illegal move`);
    assert.equal(move.method, side === game.longColor ? "long" : "short");
    assert.equal(move.budgetMs, report.identity.matchBudgets[`${move.method}Ms`]);
    board[move.index] = side;
    winner = outcome(board, move.index);
    side = 3 - side;
    assert.ok(!winner || move === game.moves.at(-1), `${game.id}: moves after terminal result`);
  }
  assert.equal(winner, game.winner, `${game.id}: result mismatch`);
  assert.ok(winner, `${game.id}: nonterminal game`);
}
assert.equal(report.games.length, openings.size * 2, "each opening must swap colors");
assert.equal(new Set(report.games.map(game => game.id)).size, report.games.length, "game ids must be unique");
const finished = report.games;
const overall = summarizeGames(finished);
assert.deepEqual(report.summary.matches, overall);
const shortMoves = finished.flatMap(game => game.moves).filter(move => move.method === "short");
const longMoves = finished.flatMap(game => game.moves).filter(move => move.method === "long");
assert.deepEqual(report.summary.search.short, summarizeSearches(shortMoves));
assert.deepEqual(report.summary.search.long, summarizeSearches(longMoves));

const pct = value => `${(value * 100).toFixed(1)}%`;
const ms = value => value == null ? "—" : `${(value / 1000).toFixed(2)} 秒`;
const nodes = value => value == null ? "—" : Math.round(value).toLocaleString("en-US");
const budgetOrder = report.identity.positionBudgets;
const byOpening = [...openings.keys()].map(id => ({
  id, ...summarizeGames(finished.filter(game => game.openingId === id))
}));
const byColor = [1, 2].map(color => ({
  label: color === 1 ? "黑" : "白",
  ...summarizeGames(finished.filter(game => game.longColor === color))
}));
const lines = [
  "# Rapfi 固定局面与配对棋力基线", "",
  `日期：${report.startedAt.slice(0, 10)}。应用版本：\`${report.identity.appVersion}\`。完整逐题、逐手记录见 [原始 JSON](${`./${basename(input)}`})。`, "",
  "## 测量方法", "",
  `使用固定 Rapfi \`${report.identity.engineCommit}\`、mix9svq 权重和单线程 SIMD WASM。所有搜索清空哈希；规则、引擎、权重与设备保持一致。`, "",
  `- 固定局面：${fixtures.size} 个由独立穷举校验器证明答案的直接胜着、连续冲四胜与必防题，每题分别运行 ${budgetOrder.map(value => `${value} ms`).join(" / ")}。其中八个连续冲四题是同一局面的旋转与镜像变体，不能视为八个独立战术样本。`,
  `- 配对对局：${openings.size} 个固定三手开局，每局交换长预算执色，共 ${overall.games} 盘。短预算 ${report.identity.matchBudgets.shortMs} ms，长预算 ${report.identity.matchBudgets.longMs} ms。`,
  "- 固定局面成功率按是否落在独立证明的正确答案集合中计算；对局得分率按胜 1、和 0.5、负 0 计算。", "",
  "## 固定局面结果", "",
  "| 预算 | 解对 / 总题数 | 总成功率 | 杀棋题解对 | 平均墙钟耗时 | P90 | 平均节点 | 平均深度 |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...budgetOrder.map(budget => {
    const row = report.summary.positions[budget];
    return `| ${budget} ms | ${row.solved} / ${row.cases} | ${pct(row.successRate)} | ${row.mateSolved} / ${row.mateCases} | ${ms(row.search.meanWallMs)} | ${ms(row.search.p90WallMs)} | ${nodes(row.search.meanNodes)} | ${row.search.meanDepth?.toFixed(1) ?? "—"} |`;
  }), "",
  "| 局面 | 类型 | " + budgetOrder.map(value => `${value} ms`).join(" | ") + " |",
  "|---|---|" + budgetOrder.map(() => "---:").join("|") + "|",
  ...[...fixtures.values()].map(fixture => `| \`${fixture.id}\` | ${fixture.kind} | ${budgetOrder.map(budget => report.positionRuns.find(run => run.fixtureId === fixture.id && run.budgetMs === budget)?.correct ? "✓" : "—").join(" | ")} |`), "",
  "## 交换执色配对赛", "",
  `长预算取得 ${overall.wins} 胜、${overall.draws} 和、${overall.losses} 负，胜率 ${pct(overall.winRate)}，得分率 ${pct(overall.scoreRate)}。`, "",
  "| 分组 | 胜 | 和 | 负 | 胜率 | 得分率 |",
  "|---|---:|---:|---:|---:|---:|",
  ...byOpening.map(row => `| \`${row.id}\` | ${row.wins} | ${row.draws} | ${row.losses} | ${pct(row.winRate)} | ${pct(row.scoreRate)} |`),
  ...byColor.map(row => `| 长预算执${row.label} | ${row.wins} | ${row.draws} | ${row.losses} | ${pct(row.winRate)} | ${pct(row.scoreRate)} |`), "",
  `本轮黑方 ${finished.filter(game => game.winner === 1).length} 胜，白方 ${finished.filter(game => game.winner === 2).length} 胜，和棋 ${overall.draws} 盘；配对结果必须结合执色分布阅读。`, "",
  "| 搜索预算 | 落子数 | 平均墙钟耗时 | P90 | 总节点 | 平均节点 | 平均深度 |",
  "|---|---:|---:|---:|---:|---:|---:|",
  ...[["short", shortMoves], ["long", longMoves]].map(([method, moves]) => {
    const row = summarizeSearches(moves);
    return `| ${method === "short" ? report.identity.matchBudgets.shortMs : report.identity.matchBudgets.longMs} ms | ${row.searches} | ${ms(row.meanWallMs)} | ${ms(row.p90WallMs)} | ${nodes(row.totalNodes)} | ${nodes(row.meanNodes)} | ${row.meanDepth?.toFixed(1) ?? "—"} |`;
  }), "",
  "## 结论边界", "",
  "这份报告是当前设备、当前引擎与固定样本的描述性基线，用来比较后续改动，不是通用棋力评级。样本量小、开局固定且双方共享引擎与权重，因此不能推导真人胜率、Elo、统计显著提升或完备求解能力。节点数受搜索实现和哈希状态影响，不能脱离耗时与答案质量单独解释为棋力。", "",
  `设备：${report.device.cpu}；Node ${report.device.node}；${report.device.os} / ${report.device.arch}。报告生成器已核对源码与引擎资产 SHA-256，并逐题、逐手重放校验。`
];
await writeFile(output, lines.join("\n") + "\n");
console.log(JSON.stringify({ output, positions: report.summary.positions, matches: overall }, null, 2));
