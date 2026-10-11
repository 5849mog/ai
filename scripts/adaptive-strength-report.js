import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { moveVerdict } from "../renju-rules.js";
import { replaySession } from "../opening-session.js";

const input = process.argv[2] ?? "reports/adaptive-strength-match-v1.json";
const output = process.argv[3] ?? "reports/adaptive-strength-match-v1.md";
const digest = value => createHash("sha256").update(value).digest("hex");
const bytes = await readFile(input);
const report = JSON.parse(bytes);
const sourceBytes = await readFile("reports/formal-modes-v35.json");
assert.equal(report.identity.sources["reports/formal-modes-v35.json"], digest(sourceBytes), "opening source changed");
const sourceReport = JSON.parse(sourceBytes);
const sourceRecords = new Map(sourceReport.cases.map(item => [item.name, item.record]));

for (const [path, expected] of Object.entries(report.identity.sources)) {
  assert.equal(digest(await readFile(path)), expected, `source hash mismatch: ${path}`);
}
for (const [path, expected] of Object.entries(report.identity.assets)) {
  if (path.startsWith("renju-model:")) {
    const name = path.slice("renju-model:".length);
    const model = JSON.parse(await readFile("engine/renju-250615/manifest.json", "utf8")).models.find(item => item.name === name);
    assert.ok(model, `missing model manifest entry: ${name}`);
    const data = Buffer.concat(await Promise.all(model.parts.map(part => readFile(`engine/renju-250615/${part}`))));
    assert.equal(digest(data), expected, `model hash mismatch: ${name}`);
  } else assert.equal(digest(await readFile(path)), expected, `asset hash mismatch: ${path}`);
}

const seeds = new Map();
for (const seed of report.identity.seeds) {
  const record = sourceRecords.get(seed.name);
  assert.ok(record, `missing source opening: ${seed.name}`);
  assert.equal(digest(JSON.stringify(record)), seed.recordSha256, `opening record hash mismatch: ${seed.name}`);
  const session = replaySession(record);
  assert.equal(session.rule, seed.rule);
  assert.equal(session.stage, "play");
  assert.equal(session.moves.length, seed.openingMoves);
  assert.deepEqual(Array.from(session.board), seed.board, `opening board mismatch: ${seed.name}`);
  assert.equal(session.color, seed.sideToMove);
  assert.equal(digest(Buffer.from(session.board)), seed.boardSha256, `opening board hash mismatch: ${seed.name}`);
  seeds.set(seed.name, seed);
}

const outcomeFor = (game) => game.winner === 3 ? 0.5 : game.winner === game.adaptiveColor ? 1 : 0;
for (const game of report.games) {
  assert.equal(game.status, "finished", `unfinished match: ${game.id}`);
  const seed = seeds.get(game.seed);
  assert.ok(seed, `unknown seed in game: ${game.id}`);
  assert.equal(game.rule, seed.rule);
  assert.equal(game.openingMoves, seed.openingMoves);
  assert.deepEqual(game.startBoard, seed.board);
  assert.equal(game.startSide, seed.sideToMove);
  let board = Uint8Array.from(seed.board), side = seed.sideToMove, winner = 0;
  for (const move of game.moves) {
    assert.equal(move.color, side, `${game.id}: wrong side to move`);
    const verdict = moveVerdict(board, move.index, side, game.rule);
    assert.equal(verdict.forbidden, "", `${game.id}: forbidden move at ${move.ply}`);
    board[move.index] = side;
    winner = verdict.winner;
    side = 3 - side;
    assert.ok(!winner || move === game.moves.at(-1), `${game.id}: moves continue after terminal result`);
  }
  const terminalWinner = winner || (board.every(value => value !== 0) ? 3 : 0);
  assert.equal(terminalWinner, game.winner, `${game.id}: replay result mismatch`);
  assert.ok(terminalWinner, `${game.id}: game is not terminal`);
}

const summarize = games => {
  const wins = games.filter(game => outcomeFor(game) === 1).length;
  const draws = games.filter(game => outcomeFor(game) === 0.5).length;
  const losses = games.filter(game => outcomeFor(game) === 0).length;
  return { games: games.length, wins, draws, losses, points: wins + draws / 2,
    scoreRate: games.length ? (wins + draws / 2) / games.length : null };
};
const bySeed = report.identity.seeds.map(seed => ({
  seed: seed.name, rule: seed.rule,
  ...summarize(report.games.filter(game => game.seed === seed.name)),
  byAdaptiveColor: [1, 2].map(color => ({
    color: color === 1 ? "black" : "white",
    ...summarize(report.games.filter(game => game.seed === seed.name && game.adaptiveColor === color))
  }))
}));
assert.equal(new Set(report.games.map(game => game.id)).size, report.games.length, "game ids must be unique");
for (const seed of report.identity.seeds) {
  const colors = report.games.filter(game => game.seed === seed.name).map(game => game.adaptiveColor).sort();
  assert.deepEqual(colors, [1, 2], `opening pair must swap adaptive colors: ${seed.name}`);
}
const byRule = ["rif", "taraguchi10"].map(rule => ({
  rule, label: rule === "rif" ? "五手两打" : "塔拉山口-10",
  ...summarize(report.games.filter(game => game.rule === rule))
}));
const byColor = [1, 2].map(color => ({
  color: color === 1 ? "黑" : "白",
  ...summarize(report.games.filter(game => game.adaptiveColor === color))
}));
const overall = summarize(report.games);
assert.equal(report.summary.games, overall.games);
assert.equal(report.summary.adaptiveWins, overall.wins);
assert.equal(report.summary.draws, overall.draws);
assert.equal(report.summary.adaptiveLosses, overall.losses);
assert.equal(report.summary.adaptiveScoreRate, overall.scoreRate);
assert.equal(overall.games, report.identity.seeds.length * 2);
assert.ok(bySeed.every(pair => pair.games === 2), "each opening needs both color assignments");

const quantile = (values, q) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};
const turnStats = method => {
  const values = report.games.flatMap(game => game.moves).filter(move => move.method === method).map(move => move.elapsedMs);
  return { turns: values.length, meanMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    medianMs: quantile(values, 0.5), p90Ms: quantile(values, 0.9), maxMs: Math.max(...values) };
};
const adaptiveTime = turnStats("adaptive"), fixedTime = turnStats("fixed");
const durationMinutes = Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 60000);
const fmt = rate => `${(rate * 100).toFixed(1)}%`;
const budgetSeconds = report.identity.budgetMs / 1000;
const budgetLabel = `${budgetSeconds}秒`;
const rawReportLink = `./${basename(input)}`;
const lines = [
  "# 自适应深思棋力配对实测", "",
  `日期：${report.startedAt.slice(0, 10)}。基线提交：\`${report.identity.sourceCommit}\`。完整逐手数据见 [原始比赛记录](${rawReportLink})。`, "",
  "## 测试方法", "",
  `使用 Rapfi \`${report.identity.rapfiCommit}\` 的单线程 SIMD WASM 和固定连珠权重，在同一设备上比较自适应搜索（每步总预算最多 ${report.identity.budgetMs / 1000} 秒）与固定 ${report.identity.budgetMs / 1000} 秒单线搜索。每次实际落子前清空哈希；规则、引擎、权重、设备和每步预算上限相同。`, "",
  `选取 ${report.identity.seeds.length} 个已完成正式开局流程的固定局面，每个局面交换两种搜索执黑 / 执白，合计 ${overall.games} 盘完整对局、${durationMinutes} 分钟。固定开局棋谱不由本次两种搜索重新选择，因此本测试只测正式开局后的普通行棋搜索，不测开局建议质量。`, "",
  "## 结果", "",
  "| 规则 | 自适应胜 | 和 | 负 | 得分率 |",
  "|---|---:|---:|---:|---:|",
  ...byRule.map(row => `| ${row.label} | ${row.wins} | ${row.draws} | ${row.losses} | ${fmt(row.scoreRate)} |`),
  `| **合计** | **${overall.wins}** | **${overall.draws}** | **${overall.losses}** | **${fmt(overall.scoreRate)}** |`, "",
  "按自适应执色分组：", "",
  ...byColor.map(row => `- 自适应执${row.color}：${row.wins} 胜、${row.draws} 和、${row.losses} 负，得分率 ${fmt(row.scoreRate)}。`), "",
  "按固定开局配对：", "",
  "| 起局 | 规则 | 自适应胜-和-负 | 得分率 |",
  "|---|---|---:|---:|",
  ...bySeed.map(row => `| \`${row.seed}\` | ${row.rule === "rif" ? "五手两打" : "塔拉山口-10"} | ${row.wins}-${row.draws}-${row.losses} | ${fmt(row.scoreRate)} |`), "",
  "## 搜索耗时", "",
  "| 搜索方式 | 落子数 | 平均 | 中位数 | P90 | 最长 |",
  "|---|---:|---:|---:|---:|---:|",
  `| 自适应 0～${budgetSeconds} 秒 | ${adaptiveTime.turns} | ${(adaptiveTime.meanMs / 1000).toFixed(2)} 秒 | ${(adaptiveTime.medianMs / 1000).toFixed(2)} 秒 | ${(adaptiveTime.p90Ms / 1000).toFixed(2)} 秒 | ${(adaptiveTime.maxMs / 1000).toFixed(2)} 秒 |`,
  `| 固定 ${budgetLabel} | ${fixedTime.turns} | ${(fixedTime.meanMs / 1000).toFixed(2)} 秒 | ${(fixedTime.medianMs / 1000).toFixed(2)} 秒 | ${(fixedTime.p90Ms / 1000).toFixed(2)} 秒 | ${(fixedTime.maxMs / 1000).toFixed(2)} 秒 |`, "",
  "## 结论边界", "",
  `这 ${overall.games} 盘中，自适应搜索取得 ${overall.wins} 胜、${overall.draws} 和、${overall.losses} 负，得分率 ${fmt(overall.scoreRate)}；本样本没有显示自适应搜索稳定胜过固定 ${budgetLabel} 搜索。只有 ${bySeed.length} 个开局配对，且两种方法使用同一引擎和权重，因此不能推导统计显著的棋力提升、Elo、真人胜率或对特定对手的胜率。不同开局配对的结果差异也说明样本还不足以作稳定判断。`, "",
  `此处的 0～${budgetSeconds} 秒是上限预算；唯一胜点、唯一合法点或必须防守等局面可能快速返回。自适应的过程统计也不是每次搜索节点总和，不能拿最后一段的深度 / 节点数直接与固定搜索比较。`, "",
  `设备：${report.device.cpu}，Node ${report.device.node}，${report.device.os} / ${report.device.arch}。验证脚本会逐手重放所有棋谱、核对禁手、起局哈希及引擎 / 权重 SHA-256。`
];
await writeFile(output, lines.join("\n") + "\n");
console.log(JSON.stringify({ output, overall, byRule, bySeed, byColor, adaptiveTime, fixedTime, durationMinutes }, null, 2));
