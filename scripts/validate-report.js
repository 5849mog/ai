import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { OPENINGS } from "../tests/fixtures/openings.js";
import { TACTICS, verifyTactic } from "../tests/fixtures/tactics.js";
import { CELL_COUNT, SIZE, BLACK, WHITE, outcome, validatePosition } from "../game-rules.js";

const json = async path => JSON.parse(await readFile(path, "utf8"));
const sha = data => createHash("sha256").update(data).digest("hex");
const benchmark = await json("reports/benchmark.json");
const qa = await json("reports/browser-qa.json");
const manifest = await json("engine/rapfi-250615/manifest.json");
assert.equal(benchmark.games.length, 40, "Complete all 40 games before writing the final report");
assert.ok(benchmark.completedAt);
assert.equal(benchmark.identity.budgetMs, 3400);
assert.equal(benchmark.identity.threads, 1);
assert.equal(benchmark.identity.rapfiCommit, manifest.sourceCommit);
assert.equal(benchmark.identity.weightsCommit, manifest.networksCommit);
assert.equal(benchmark.identity.legacySha256, sha(await readFile("tests/fixtures/legacy-engine.js")));
assert.equal(benchmark.identity.openingsSha256, sha(JSON.stringify(OPENINGS)));
assert.deepEqual(benchmark.summary.browserErrors, []);
assert.ok(qa.passed);
assert.equal(qa.tactics.length, TACTICS.length);

for (const fixture of TACTICS) {
  const result = qa.tactics.find(entry => entry.id === fixture.id);
  const proof = verifyTactic(fixture);
  assert.ok(result?.passed && proof.expected.includes(result.result.index));
  assert.deepEqual(result.expected, proof.expected);
  assert.deepEqual(result.proofs, proof.proofs);
}
for (const channel of ["chrome", "msedge"]) {
  for (const variant of manifest.variants) {
    const result = qa.checks.find(check => check.name === `${channel}: ${variant}`);
    assert.ok(result?.passed);
    assert.equal(result.move.evaluator, "mix9svq");
    assert.ok(result.move.weight.endsWith("mix9svqfreestyle_bsmix.bin.lz4"));
  }
}
assert.ok(qa.checks.every(check => check.passed));

const ids = new Set();
for (const opening of OPENINGS) {
  for (const color of [BLACK, WHITE]) {
    const id = `${opening.id}-rapfi-${color}`;
    const game = benchmark.games.find(entry => entry.id === id);
    assert.ok(game && !ids.has(game.id)); ids.add(game.id);
    assert.equal(game.rapfiColor, color);
    assert.equal(game.opening, opening.id);
    const board = new Uint8Array(CELL_COUNT);
    let winner = 0;
    for (let ply = 0; ply < game.moves.length; ply++) {
      const move = game.moves[ply];
      const side = ply % 2 + 1;
      assert.equal(winner, 0, `${id}: move after the game ended`);
      assert.equal(move.color, side);
      validatePosition(board, side);
      assert.ok(Number.isInteger(move.index) && move.index >= 0 && move.index < CELL_COUNT && !board[move.index]);
      if (ply < opening.moves.length) {
        assert.equal(move.index, opening.moves[ply][1] * SIZE + opening.moves[ply][0]);
        assert.equal(move.engine, "opening");
      } else {
        assert.equal(move.engine, side === color ? "rapfi" : "legacy");
        assert.ok(Number.isFinite(move.elapsed) && move.elapsed >= 0);
        assert.ok(move.nodes === undefined || (Number.isFinite(move.nodes) && move.nodes >= 0));
      }
      board[move.index] = side;
      winner = outcome(board, move.index);
    }
    assert.equal(game.winner, winner);
    assert.notEqual(winner, 0);
    assert.equal(game.score, winner === 3 ? .5 : winner === color ? 1 : 0);
  }
}
const wins = benchmark.games.filter(game => game.score === 1).length;
const draws = benchmark.games.filter(game => game.score === .5).length;
const losses = 40 - wins - draws;
const scoreRate = (wins + draws * .5) / 40;
assert.equal(benchmark.summary.scoreRate, scoreRate);
assert.ok(scoreRate >= .75, "Score must reach 75%");

const testFiles = (await readdir(".")).filter(name => name.endsWith(".test.js"));
testFiles.push(...(await readdir("tests")).filter(name => name.endsWith(".test.js")).map(name => "tests/" + name));
const unitOutput = execFileSync(process.execPath, ["--test", "--test-reporter=tap", ...testFiles], { encoding: "utf8" });
const unitCount = Number(/# tests (\d+)/.exec(unitOutput)?.[1]);
assert.ok(unitCount > 0);
execFileSync(process.execPath, ["scripts/check.js"], { stdio: "inherit" });

benchmark.artifacts = { emscripten: manifest.emscripten, files: manifest.files, patches: manifest.patches };
await writeFile("reports/benchmark.json", JSON.stringify(benchmark, null, 2) + "\n");
const stats = name => {
  const moves = benchmark.games.flatMap(game => game.moves.filter(move => move.engine === name));
  const times = moves.map(move => move.elapsed).sort((a,b) => a-b);
  return { count: moves.length, average: times.reduce((a,b) => a+b, 0) / times.length,
    p50: times[Math.ceil(times.length * .5)-1], p95: times[Math.ceil(times.length * .95)-1],
    max: times.at(-1), withNodes: moves.filter(move => move.nodes !== undefined).length,
    nodes: moves.reduce((sum, move) => sum + (move.nodes ?? 0), 0) };
};
const seconds = ms => (ms / 1000).toFixed(3);
const minuteDuration = ((Date.parse(benchmark.completedAt) - Date.parse(benchmark.startedAt)) / 60000).toFixed(1);
const resultText = game => `${game.score === 1 ? "胜" : game.score === .5 ? "和" : "负"} / ${game.moves.length} 手`;
const rows = OPENINGS.map(opening => `| ${opening.id} | ${opening.moves.map(([x,y]) => `(${x},${y})`).join(" → ")} | ${resultText(benchmark.games.find(g => g.id === `${opening.id}-rapfi-1`))} | ${resultText(benchmark.games.find(g => g.id === `${opening.id}-rapfi-2`))} |`);
const timingRows = ["rapfi", "legacy"].map(name => {
  const s = stats(name);
  return `| ${name} | ${s.count} | ${seconds(s.average)} | ${seconds(s.p50)} | ${seconds(s.p95)} | ${seconds(s.max)} | ${s.nodes.toLocaleString("en-US")} |`;
});
const versions = ["chrome", "msedge"].map(channel => `${channel}: ${qa.checks.find(c => c.name.startsWith(channel + ":"))?.browser}`).join("；");
const report = `# 五目实施与验收报告

Rapfi 对旧引擎取得 **${wins} 胜、${draws} 和、${losses} 负，得分率 ${(scoreRate * 100).toFixed(1)}%**，达到 75% 验收门槛。12 个独立核验的战术局面全部通过，${unitCount} 项规则与接口单元测试及 ${qa.checks.length} 组浏览器检查通过。

## 实现与运行

保留木棋盘和 15×15 freestyle 规则，删除等级与娱乐技能。玩家执黑，AI 执白，提供新局、悔棋、5/10 秒设置及状态提示。时间设置持久保存，鼠标单击落子、触屏两次确认。

Rapfi ${manifest.release} 使用 mix9svq freestyle 权重，四种完整 WASM 构建随项目托管。普通静态托管自动选择单线程，跨源隔离时最多 4 线程并保留一个逻辑核心。正常回合复用 Worker；中途取消通过终止 Worker 丢弃旧响应。搜索内存参数为 256 MiB，权重和运行时另占内存。资源缓存后可断网刷新并继续对弈，支持 /ai/ 子目录。

## 棋力实测条件

- 开始：${benchmark.startedAt}；完成：${benchmark.completedAt}（UTC）；总历时约 ${minuteDuration} 分钟。
- 设备：${benchmark.device.cpu}，${benchmark.device.logicalCores} 个逻辑核心，${benchmark.device.ramGiB} GiB RAM；${benchmark.device.os}。
- Rapfi：Chrome ${benchmark.device.browser}，headless，${benchmark.identity.variant}，1 线程；旧引擎：Node ${benchmark.device.node}，1 线程，同一台电脑。
- 双方每步预算 3.4 秒，允许战术确定时提前返回。旧引擎保持原第 15 级的完整算法与 3400 ms 预算，仅在执黑时交换输入颜色。
- 20 个固定合法三手开局，各交换双方执色，40 局串行进行。每局重新初始化 Rapfi 清空跨局搜索状态，同一局的回合复用引擎。无禁手，五子和长连均胜。
- 浏览器回归曾在同一设备并行执行，未把机器视为专用基准设备；实际墙钟耗时包含首次权重准备、调度和协议处理开销。预算是搜索上限配置，不保证端到端精确到毫秒。

## 完整对战结果

坐标从 0 开始，顺序为黑、白、黑。两列均以 Rapfi 视角记录；手数含固定开局。

| 开局 | 三手坐标 | Rapfi 执黑 | Rapfi 执白 |
| --- | --- | --- | --- |
${rows.join("\n")}

## 落子耗时

单位为秒，排除固定开局。节点计数沿用各自引擎统计口径，不能直接用节点数比较棋力。Rapfi 有 ${stats("rapfi").withNodes}/${stats("rapfi").count} 步输出节点统计；旧引擎有 ${stats("legacy").withNodes}/${stats("legacy").count} 步。直接返回胜着时 Rapfi 可以不输出节点统计，表中仅累计已输出的值。

| 引擎 | 搜索步数 | 平均 | P50 | P95 | 最长 | 已记录节点 |
| --- | --- | --- | --- | --- | --- | --- |
${timingRows.join("\n")}

## 规则、战术与浏览器

规则验证覆盖四个方向成五、长连、边界、满盘和棋、非法局面、输入不变、黑白与坐标转换、唯一防守点、合法返回点及取消后的过期响应。报告生成时重新播放全部 40 局并检查每一步的行棋方、合法性和最终胜负。

战术测试使用独立穷举 VCF 验证器，枚举全部空点、直接胜点和唯一强制防守，不借用 Rapfi 或旧引擎求解结果。包含连续两次冲四的 8 个旋转/镜像局面、活四双胜点、两个冲四、先防守再进攻及直接获胜优先。每个证明和真实引擎返回值保存在 browser-qa.json；12/12 通过。

浏览器版本：${versions}。四个构建均验证实际启用了指定神经网络权重。回归检查连续对弈、Worker 复用、默认与记忆时间设置、鼠标悬停单击、键盘、触屏两次确认、思考中悔棋/新局、加载和搜索失败重试、棋盘保留、断网刷新与落子、普通静态托管及 /ai/ 子目录。手机布局在 390×844 触屏模拟中可用，无横向溢出；未声称做过实体手机测试。

## 构建与交付证据

- Rapfi 提交：\`${manifest.sourceCommit}\`；Networks：\`${manifest.networksCommit}\`。
- Emscripten：${manifest.emscripten}；emsdk：\`${manifest.emsdkCommit}\`；${manifest.cmake}；Ninja ${manifest.ninja}。
- 基线提交：\`${benchmark.identity.legacyCommit}\`；原始引擎 SHA-256：\`${benchmark.identity.legacySha256}\`。
- 开局集 SHA-256：\`${benchmark.identity.openingsSha256}\`。
- [完整棋谱、设备、每步耗时与产物校验值](./benchmark.json)、[浏览器与战术证明](./browser-qa.json)、[桌面截图](./desktop.png)、[手机截图](./mobile.png)。
- [运行与可复现构建说明](../README.md)、[引擎版本与 SHA-256 manifest](../engine/rapfi-250615/manifest.json)、[源码补丁](../scripts/patches/)、[GPL、权重与依赖许可说明](../THIRD_PARTY.md)。

本次结果证明新引擎在这 20 个固定开局中显著强于项目旧引擎，不能推导通用 Elo、对其他程序的胜率或更多开局的必然表现。实现与验证均在独立检出的 5849mog/ai 中完成，未改动原 5849mog/test 工作区。
`;
await writeFile("reports/validation.md", report);
console.log(`Verified 40 game records and wrote reports/validation.md (${(scoreRate * 100).toFixed(1)}% score).`);
