import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validatePosition, validIndex } from "../game-rules.js";
import { TACTICS, verifyTactic } from "../tests/fixtures/tactics.js";

const report = JSON.parse(await readFile("reports/ponder-benchmark.json", "utf8"));
const fixtures = JSON.parse(await readFile("reports/ponder-fixtures.json", "utf8"));
const sha = value => createHash("sha256").update(value).digest("hex");
assert.equal(report.complete, true, "The experiment must finish before drawing conclusions");
assert.deepEqual(report.browserErrors, []);
assert.equal(report.identity.fixturesSha256, fixtures.sha256);
assert.equal(fixtures.sha256, sha(JSON.stringify({ fixtures: fixtures.fixtures, tactical: fixtures.tactical })));
assert.deepEqual(report.fixtures, fixtures.fixtures); assert.deepEqual(report.tacticalFixtures, fixtures.tactical);
assert.equal(report.references.length, 12); assert.equal(report.pairs.length, 72); assert.equal(report.tactics.length, 12);
assert.equal(new Set(report.pairs.map(row => row.id)).size, 72);
const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = value => +value.toFixed(2);
const ref = new Map(report.references.map(row => [row.id, row.result]));
function checkResult(fixture, result) {
  validatePosition(fixture.board, fixture.sideToMove);
  assert.ok(validIndex(result.index) && fixture.board[result.index] === 0);
  assert.equal(result.x, result.index % 15); assert.equal(result.y, Math.floor(result.index / 15));
  assert.equal(result.evaluator, "mix9svq"); assert.equal(result.weight, "mix9svqfreestyle_bsmix.bin.lz4");
  assert.ok(result.depth === undefined || Number.isFinite(result.depth)); assert.ok(Number.isFinite(result.elapsed));
}
for (const fixture of report.fixtures) {
  checkResult(fixture, ref.get(fixture.id));
  const pairs = report.pairs.filter(row => row.fixtureId === fixture.id); assert.equal(pairs.length, 6);
  for (const budget of [1000, 5000]) {
    const rows = pairs.filter(row => row.budgetMs === budget); assert.deepEqual(rows.map(row => row.repetition).sort(), [0, 1, 2]);
  }
  for (const row of pairs) for (const arm of [row.on, row.off]) {
    checkResult(fixture, arm.result); checkResult({ ...fixture, board: fixture.seed }, arm.seed);
    assert.ok(arm.endToEndMs >= 0 && arm.windowMs >= 4900);
    assert.equal(arm.backgroundSearchMs, arm.slices.reduce((sum, slice) => sum + slice.elapsed, 0));
    for (const slice of arm.slices) assert.ok(validIndex(slice.index) && !fixture.parent[slice.index]);
  }
}
for (const row of report.tactics) {
  const fixture = TACTICS.find(item => item.id === row.id), expected = verifyTactic(fixture).expected;
  assert.deepEqual(row.expected, expected);
  for (const key of ["on", "off"]) { checkResult(fixture, row[key].result); assert.equal(row[`${key}Correct`], expected.includes(row[key].result.index)); }
}
const coord = index => `${String.fromCharCode(65 + index % 15)}${Math.floor(index / 15) + 1}`;
const top = result => result.recommendations?.map(move => move.index) ?? [result.index];
const budgets = [1000, 5000].map(budget => {
  const rows = report.pairs.filter(row => row.budgetMs === budget);
  const on = rows.map(row => row.on), off = rows.map(row => row.off);
  const arm = values => ({ medianDepth: median(values.map(row => row.result.depth)), medianResponseMs: round(median(values.map(row => row.endToEndMs))),
    medianNodes: median(values.map(row => row.result.nodes)), medianSearchMs: median(values.map(row => row.result.elapsed)),
    mateCount: values.filter(row => row.result.mate).length,
    meanUtilization: round(mean(values.map(row => row.result.elapsed / budget))),
    medianBackgroundSearchMs: median(values.map(row => row.backgroundSearchMs)) });
  return { budgetMs: budget, independentPositions: 12, repeatedPairs: rows.length, on: arm(on), off: arm(off),
    deeper: rows.filter(row => row.on.result.depth > row.off.result.depth).length,
    equalDepth: rows.filter(row => row.on.result.depth === row.off.result.depth).length,
    shallower: rows.filter(row => row.on.result.depth < row.off.result.depth).length,
    sameMove: rows.filter(row => row.on.result.index === row.off.result.index).length,
    onReferenceFirst: rows.filter(row => row.on.result.index === ref.get(row.fixtureId).index).length,
    offReferenceFirst: rows.filter(row => row.off.result.index === ref.get(row.fixtureId).index).length,
    onReferenceTop: rows.filter(row => top(ref.get(row.fixtureId)).includes(row.on.result.index)).length,
    offReferenceTop: rows.filter(row => top(ref.get(row.fixtureId)).includes(row.off.result.index)).length,
    pairedMedianDepthChange: median(rows.map(row => row.on.result.depth - row.off.result.depth)),
    pairedMedianResponseRatio: round(median(rows.map(row => row.on.endToEndMs / row.off.endToEndMs))),
    pairedMedianResponseChangeMs: round(median(rows.map(row => row.on.endToEndMs - row.off.endToEndMs))),
    pairedMinResponseChangeMs: round(Math.min(...rows.map(row => row.on.endToEndMs - row.off.endToEndMs))),
    pairedMaxResponseChangeMs: round(Math.max(...rows.map(row => row.on.endToEndMs - row.off.endToEndMs))) };
});
const summary = { generatedAt: new Date().toISOString(), budgets,
  tactics: { count: 12, onPassed: report.tactics.filter(row => row.onCorrect).length, offPassed: report.tactics.filter(row => row.offCorrect).length },
  totalBackgroundSearchMs: report.pairs.reduce((sum, row) => sum + row.on.backgroundSearchMs, 0),
  referenceElapsedMs: report.references.reduce((sum, row) => sum + row.result.elapsed, 0),
  durationMs: Date.parse(report.completedAt) - Date.parse(report.startedAt) };
assert.equal(summary.tactics.onPassed, 12); assert.equal(summary.tactics.offPassed, 12);
await writeFile("reports/ponder-summary.json", JSON.stringify(summary, null, 2) + "\n");
const interpretation = budgets.every(row => row.onReferenceTop === row.repeatedPairs && row.offReferenceTop === row.repeatedPairs
  && row.pairedMedianResponseRatio >= 0.95 && row.pairedMedianResponseRatio <= 1.05)
  ? "因此它有实际缓存作用，但本样本没有显示稳定的着手质量或速度收益；保持可选开关，不作为‘显著增强棋力’的卖点。"
  : "实际收益需结合下面每个局面的配对变化判断；参考一致性与深度不能直接证明胜率增强。";
const perPosition = report.fixtures.flatMap(fixture => [1000, 5000].map(budget => {
  const rows = report.pairs.filter(row => row.fixtureId === fixture.id && row.budgetMs === budget);
  return `| ${fixture.id} | ${budget / 1000} s | ${coord(ref.get(fixture.id).index)} / ${ref.get(fixture.id).depth} / ${ref.get(fixture.id).mate ?? "—"} | ${median(rows.map(row => row.on.result.depth))} / ${median(rows.map(row => row.off.result.depth))} | ${Math.round(median(rows.map(row => row.on.endToEndMs)))} / ${Math.round(median(rows.map(row => row.off.endToEndMs)))} | ${[...new Set(rows.map(row => coord(row.on.result.index)))].join(",")} / ${[...new Set(rows.map(row => coord(row.off.result.index)))].join(",")} |`;
}));
const lines = ["# 云端后台思考：固定局面对照", "", `执行：${report.startedAt} 至 ${report.completedAt}；${(summary.durationMs / 60000).toFixed(1)} 分钟。`, "",
  "## 结论的边界", "",
  "这是对当前网页协作式后台搜索的实测。后台会计算并保留缓存，但缓存是否改善下一手，需要看相同局面的前台搜索。这次不改默认开关，也不根据这些局面宣称胜率或 Elo 提升。", "",
  `本次 ${budgets.reduce((sum, row) => sum + row.deeper, 0)}/72 对搜索在开启时深度提高；1/5 秒配对深度变化中位数分别为 ${budgets[0].pairedMedianDepthChange}/${budgets[1].pairedMedianDepthChange}，落点相同的对数为 ${budgets[0].sameMove}/36、${budgets[1].sameMove}/36。1/5 秒配对响应变化中位数分别为 ${budgets[0].pairedMedianResponseChangeMs} ms / ${budgets[1].pairedMedianResponseChangeMs} ms。每个 5 秒等待窗口额外花费约 ${((budgets[0].on.medianBackgroundSearchMs + budgets[1].on.medianBackgroundSearchMs) / 2000).toFixed(1)} 秒后台搜索段耗时。${interpretation}`, "",
  ...budgets.map(row => `- ${row.budgetMs / 1000} 秒：开启/关闭的参考首选一致 ${row.onReferenceFirst}/${row.offReferenceFirst}（各 36 次）；参考候选一致 ${row.onReferenceTop}/${row.offReferenceTop}。深度提升/相同/下降为 ${row.deeper}/${row.equalDepth}/${row.shallower}；配对深度变化中位数 ${row.pairedMedianDepthChange}。开启/关闭响应时间中位数 ${row.on.medianResponseMs}/${row.off.medianResponseMs} ms，配对响应比中位数 ${row.pairedMedianResponseRatio}。`),
  `- 独立验证战术：开启 ${summary.tactics.onPassed}/12、关闭 ${summary.tactics.offPassed}/12。`, "",
  "搜索深度是引擎内部指标，更多节点也不能直接代表棋力更强。参考搜索仍是同一引擎，30 秒双候选并非真值；只作着手一致性对照。每档 36 对是 12 个局面各重复 3 次，不是 36 个独立局面。", "",
  "## 设备与复现", "",
  `- ${report.device.cpu}；${report.device.logicalCores} 逻辑核心；内存 ${report.device.ramGiB} GiB。`,
  `- ${report.device.os}；Chrome ${report.device.browser}（headless）；Node ${report.device.node}。`,
  `- Rapfi ${report.identity.engine}；Networks ${report.identity.networks}；mix9svq freestyle。`,
  "- 发布版 rapfi-single-simd128，单线程，max_memory 256 MiB；非跨源隔离服务器。没有修改搜索算法或重建 WASM。",
  `- 固定局面 SHA-256：\`${report.identity.fixturesSha256}\`。`,
  `- 执行时四个引擎适配文件字节的 SHA-256 合成值：\`${report.identity.implementationSha256}\`。`, "",
  "```powershell", "npm run benchmark:ponder", "# 中断时，相同脚本、局面与适配文件可继续", "npm run benchmark:ponder -- --resume", "npm run report:ponder", "```", "",
  "## 配对方法", "",
  "从已有 40 局报告前 6 个开局的两种执色抽取 12 个合法中盘：AI 执黑取前 12 手，执白取前 13 手。完整局面、前一手父局面、前两手预热局面和相同的人类落点都冻结在 ponder-fixtures.json。", "",
  "每个实验臂新建同一引擎，用前两手局面搜索 1 秒预热。父局面开启后台 5 秒，或关闭并等待同样 5 秒；然后提交固定的人类落子后的局面，用 1/5 秒前台预算搜索。每档重复 3 次，开关顺序按固定种子交替。12 个局面各另跑独立的 30 秒 MultiPV=2 参考。战术集 12 个局面按同样方式、1 秒前台预算各测开关一次。", "",
  "实验臂严格顺序执行，前一个 Worker 销毁后才开始下一个，没有同时运行两个对照引擎。期间进行了轻量代码编辑与单元验证，没有并行运行其它棋力或 WASM 测试；这是用户电脑实测，未隔绝操作系统其它任务，耗时存在噪声。", "",
  "端到端响应从提交前台 search 到 Promise 返回，包含结束当前后台短段的等待。后台诊断单独收集全部完成短段，包括被前台替换后返回的最后一段；不把实时重复统计叠加成节点数。后台 elapsed 是搜索段墙钟耗时，不是独立测量的 CPU 时间。", "",
  "引擎允许确定杀棋时提前返回；不能把名义预算当作实际用时。保留 mate 与每次实际耗时，不强制消除提前返回。", "",
  "## 汇总", "",
  "| 前台预算 | 开/关响应 ms 中位数 | 配对变化 ms 中位数（范围） | 开/关深度中位数 | 开/关节点中位数 | 开/关杀棋输出次数 | 开/关平均预算利用率 | 开启的后台段耗时中位数 |",
  "|---|---|---|---|---|---|---|---|",
  ...budgets.map(row => `| ${row.budgetMs / 1000} s | ${row.on.medianResponseMs} / ${row.off.medianResponseMs} | ${row.pairedMedianResponseChangeMs}（${row.pairedMinResponseChangeMs}…${row.pairedMaxResponseChangeMs}） | ${row.on.medianDepth} / ${row.off.medianDepth} | ${row.on.medianNodes} / ${row.off.medianNodes} | ${row.on.mateCount} / ${row.off.mateCount} | ${Math.round(row.on.meanUtilization * 100)}% / ${Math.round(row.off.meanUtilization * 100)}% | ${row.on.medianBackgroundSearchMs} ms |`), "",
  "## 各局面三次中位数", "",
  "坐标 A–O 对应左至右，1–15 对应上至下。开/关顺序固定；落点栏列出三次出现的不同点。", "",
  "| 局面 | 预算 | 30s 参考落点 / 深度 / mate | 开/关深度 | 开/关响应 ms | 开/关落点 |", "|---|---|---|---|---|---|", ...perPosition, "",
  "## 独立战术", "",
  "预期着手由仓库中的穷举 VCF 验证器重新证明，涵盖成五、唯一防守、连续冲四、双威胁和攻防转换。报告生成时检查每一落点合法及统计对应同一固定局面。", "",
  "| 局面 | 独立证明着手 | 开 / 关着手 | 开 / 关通过 |", "|---|---|---|---|",
  ...report.tactics.map(row => `| ${row.id} | ${row.expected.map(coord).join(", ")} | ${coord(row.on.result.index)} / ${coord(row.off.result.index)} | ${row.onCorrect ? "通过" : "失败"} / ${row.offCorrect ? "通过" : "失败"} |`), "",
  "原始完整数据：[ponder-benchmark.json](./ponder-benchmark.json)；冻结局面：[ponder-fixtures.json](./ponder-fixtures.json)；汇总：[ponder-summary.json](./ponder-summary.json)。", ""];
await writeFile("reports/ponder-benchmark.md", lines.join("\n"));
console.log(JSON.stringify(summary, null, 2));
