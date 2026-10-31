# 五目 · Gomoku Studio

[在线打开](https://5849mog.github.io/ai/) · [简洁界面](https://5849mog.github.io/ai/?view=simple)

手机、平板和电脑共用一套棋局流程。首页和旧 `renju.html` 地址恢复同一局；完整 / 简洁只改变显示，不改变规则、执色、对局方式或存档。

## 开始与操作

| 入口 | 含义 |
| --- | --- |
| 新局 | 按当前规则和对局方式重新开局，在棋盘旁选择本局角色 |
| 对局设置（简洁界面为「对局」） | 选择规则及 AI 负责哪一方；点「开始新局」才生效，返回不改当前棋局 |
| 悔棋 | 撤回实际操作；自动应手与触发它的那一步一起撤回，换色和候选也可撤回 |
| 推荐 | 最多 1 秒搜索预算，显示建议，不执行落子；自动应手不需要点推荐 |
| 更多 | 思考预算、后台思考、截图、自定义摆局、最近对局、电脑引擎及返回完整界面 |
| 完整界面菜单 | 同一套对局设置与工具，另有棋谱导入导出和规则说明 |

鼠标单击落子，触屏先预览、再点同一处确认；键盘可用方向键选点、回车落子。墨绿数字空点依次代表实际下一方的三个候选。对方选了其它位置也直接进入下一手，不冻结榜单或额外弹提示。

声效默认关闭，可在完整界面菜单或简洁界面「更多」中开启；偏好保存在本机浏览器。仅真实落子播放短促的本地合成音效，预览、推荐和后台思考不发声，也不需要下载音频文件。

换手、十打和第五手选案等阶段操作贴在棋盘上沿或侧边，为按钮单独留白，不挡交叉点。「更多」只在展开时临时显示，不挤压棋盘；返回完整界面有明确按钮。新局不再承担隐藏的长按退出操作。

## 规则与对局方式

规则：无禁手、禁手自由开局、五手两打、塔拉山口-10。完整开局和禁手说明在菜单「规则说明」。

- **AI 替我下 · 外部对局**：录入外部对手的操作，AI 自动完成我方落子；涉及实战换色时由用户确认。自由开局可先录入已有开局，再点「AI 接手」。
- **手动记录双方**：双方棋子、换色、提案和选案都由用户录入，AI 不自动落子。改变分析视角不会改变实际执色。
- **与 AI 对弈**：用户操作自己的棋色，AI 自动完成对方回合。

简洁界面和完整界面共用这些选择。「新局」保留当前方式，不会把手动记录自动改为 AI 附身。

自动落子可选 1 / 5 / 10 秒或自适应深思 0～6 秒。自适应比较有限候选与后续攻防，不是完备求解；估算胜率不是对特定真人的实战胜率。后台思考可关闭，切后台会暂停，悔棋与新局废弃旧答案。算法和验证范围见 [自适应攻防报告](reports/adaptive-defense-v39.md)。

## 棋局与文件

实际操作自动保存；刷新恢复局面和轮到谁，最近对局最多保留 50 局。数据在本设备浏览器，不跨设备同步；保存失败会提示导出。旧无禁手和连珠棋局升级时按最近的有效归档恢复，原记录保留，另一局仍可从最近对局找到。

导入先校验并预览，确认后才替换；取消或无效文件不改变棋局。五目 JSON 保留角色、换色与候选。旧无禁手 JSON v1 / v2 与 Freestyle SGF 仍可导入。SGF 仅包含实子，不足以恢复正式连珠的换色和提案，因此正式开局请用 JSON。文件上限 1 MiB。

自定义摆局和截图导入均使用独立草稿，明确确认才开始续下。截图只在本机处理；校准框应贴合最外层网格交点，识别后可校正。手动记录方式不显示「AI 来走」选择。截图无法还原手序或正式开局，按指定规则作为中盘继续。

终局后显示复盘入口；最近对局可继续未结束棋局或复盘已结束棋局，复盘不会写入当前对局。

## 电脑引擎与离线

默认在本机浏览器计算，不需要服务器。可选「电脑引擎」把计算交给自己电脑上的原生多线程 Rapfi。手机扫码使用免费临时通道，电脑须开机联网；通道约 60 分钟更新地址后需重新扫码。配置与访问边界见 [电脑服务说明](remote/README.md)。

静态托管支持 GitHub Pages 的 `/ai/` 子目录；Service Worker 需要 HTTPS 或 localhost。页面显示「已缓存 · 可离线使用」后，可断网刷新并对弈。更新在「更多 → 检查更新」完成后由用户刷新，保留当前棋局；`update.html` 是独立恢复入口。

浏览器优先使用 SIMD；无跨源隔离时使用完整单线程 NNUE，有共享内存及隔离条件时最多 4 线程。开发服务器提供 COOP / COEP 响应头。WASM MIME 类型应为 `application/wasm`，权重和材质均在本站。搜索哈希预算为 256 MiB，完整进程还需容纳模型和 Worker。

## 开发与验证

需要 Node.js 20.19+：

```sh
npm ci
npm run dev
npm test
npm run check
npm run test:navigation
npm run test:opening-dock
npm run test:opening-flow
npm run test:upgrade
```

默认开发地址 http://127.0.0.1:4187/ 。浏览器验证可用 `CHROME_PATH` 指定 Chromium、`CHROME_ARGS` 传 JSON 启动参数。`test:navigation` 使用确定性引擎检查真实页面、按钮和存档；`test:opening-flow` 默认使用真实 Rapfi WASM；`test:upgrade` 使用 Git 中的 v47 页面验证缓存升级、迁移和断网对弈。布局证据和本轮整理结论见 [交互审查报告](reports/unified-navigation-v48.md)。

发布须同时更新 `app-release.js` 和 `sw.js` 缓存版本。页面缓存与固定模型缓存分开；无需为界面更新重复下载权重。历史专项报告保留原版本和验证边界，不能当作当前版本已重新运行的结果。

## 引擎接口

```js
import { GomokuEngine } from './engine.js';
const engine = new GomokuEngine({
  onState: event => console.log(event.state, event.pondering),
  onStats: event => console.log(event.phase, event.sideToMove, event.stats)
});
await engine.init();
const result = await engine.search({
  board,           // 225 个交点，0 空、1 黑、2 白；调用方数组不会被修改
  sideToMove: 2,   // 实际下一手棋色；普通局面须符合黑先白后的数量
  timeMs: 10000,   // 1–30000 ms，界面提供 1000/5000/10000
  requestId: 1,    // 调用方递增的安全整数
  multiPV: 1,      // 普通落子为 1；推荐使用 2，返回 recommendations 数组
  allowSetup: false // 自定义局面为 true，允许任意黑白数量与明确的下一手
});
// result: index, x, y, elapsed, requestId, evaluator, weight；以及实际输出的 depth/nodes/nps 等
engine.cancel();  // 取消未完成搜索，Promise 以 AbortError 拒绝
engine.dispose();
```

玩家回合可调用 `await engine.ponder({ board, sideToMove, requestId, allowSetup })` 开始后台分析，`engine.stopPonder()` 暂停；普通对局可省略 `allowSetup`。`onStats` 的 `phase` 为 `search` 或 `ponder`，原始 `evaluation` 对应 `sideToMove` 的视角。实际 `search()` 自动暂停后台分析并优先执行；`reset()` / `cancel()` / `dispose()` 会丢弃旧 Worker 的输出。

`mate` 保留引擎的 `+M…` / `-M…` 杀棋输出，杀棋与数值评分相互清除过期值。诊断时可给构造函数传 `onPonderSlice(result)`：每个完整后台短段仅回调一次，包括切到前台前返回的最后一段；普通页面不启用此诊断通道。

初始化状态为 loading/ready/error，搜索时为 thinking。一次只接受一个搜索；超时、非法落点和引擎错误均明确失败，不使用旧引擎兜底。每次搜索都会确认指定的 mix9svq freestyle 权重已启用。

协议适配层使用完整 BOARD 数据同步局面，以黑白交替顺序发送棋子，并把实际颜色转换为协议的己方/对方编号。自定义局面利用固定版本 Rapfi 的 BOARD 停着支持校正实际棋色和下一手；同步用的停着不进入应用落子、存档或走势图。配置禁用坐标翻转，界面、规则和搜索的坐标一致。

推荐使用 `YXBOARD` 只同步局面，再以 `YXNBEST 2` 发起一次双候选搜索。只接受同一深度已完整输出的 MultiPV 组，不把主变化里的对方应手当作第二推荐。普通落子和后台搜索仍用 BOARD，恢复单候选模式；直接胜着未输出 PV 时按共享规则核验真实胜点。

## 重新构建引擎

固定源码为 Rapfi `250615`（`1be1551ced57e38d53ed58f6d74bf6f8b4bdc230`）、Networks `918b757a129258e9e765f77fe17d507c2bb1a60b`。工具链为 Emscripten 3.1.64，构建本次发布文件所用 emsdk 提交、CMake 和 Ninja 版本记录在发布 manifest 中。

Windows PowerShell 下，先准备 Python 3、Git 和构建工具：

```powershell
git clone https://github.com/emscripten-core/emsdk.git .cache/emsdk
git -C .cache/emsdk checkout e566f7bdcc7735f44037911c24b87a58a3c93145
.\.cache\emsdk\emsdk.bat install 3.1.64
.\.cache\emsdk\emsdk.bat activate 3.1.64
python -m pip install --target .cache/build-tools cmake==4.4.3 ninja==1.13.2
npm run build:engine
```

构建脚本自动检出固定引擎源码和权重，校验版本并应用两个公开补丁：修复单线程构建的线程成员访问；在无 SIMD 的 WASM 构建中排除未使用且不支持标量构建的 mix10 评估器。mix9svq 的搜索与评估逻辑未修改。

从上游 Gomocalc 配置派生本站配置：仅打包 freestyle 权重及经典棋形文件，将 `coord_conversion_mode` 设为 `none`。所有派生修改都包含在构建脚本和 scripts/patches 中。`.cache` 内的源码、SDK 和中间文件不提交。

脚本输出四个 `.js/.wasm` 构建、共享数据、许可和 `manifest.json`。manifest 记录源码、工具链、补丁及每个发布文件的 SHA-256。`.gitattributes` 保留校验文件的原始字节，避免 Git 换行转换破坏校验。

## 棋力与历史验证

统一棋力基线使用真实单线程 SIMD WASM，先运行独立穷举校验的固定战术题，再对固定三手开局交换执色进行不同时间预算的自动配对赛。输出包括解题／杀棋成功率、胜负和、得分率、深度、节点数及墙钟耗时；源码、引擎和局面均记录 SHA-256，报告生成时逐题、逐手复核。

```sh
npm run benchmark:strength
npm run report:strength
# 中断后沿用同一输出文件续跑；配置或源码身份不同会拒绝续跑
npm run benchmark:strength -- --resume
```

可用 `--position-budgets=100,500,1000`、`--match-budgets=100,500`、`--openings=4` 和 `--output=...` 调整规模。默认结果见 [固定局面与配对棋力基线](reports/strength-baseline-v1.md)。

关于页的「查看测试报告」打开 `report.html`。页面在打开、手动刷新、重新可见及前台每 60 秒读取同源 `reports/strength-baseline-v1-summary.json`，以 `no-store` 请求最新发布数据；Service Worker 不缓存报告 JSON。加载失败会显示错误，已有数据时保留上一次成功结果。界面数据校验、缓存策略和真实触屏／刷新流程可用 `npm run test:report` 与 `npm test` 验证。

后台思考对照及自适应配对赛仍由 `package.json` 中的其它 benchmark / report 命令运行，长测试支持 `--resume`。它们检验有限样本下相对表现，不能推导真人胜率或通用 Elo。原始记录与源码 / 权重哈希保存在 `reports/`；参考 [后台思考报告](reports/ponder-benchmark.md)、[自适应配对赛](reports/adaptive-strength-match-v1.md) 和 [旧版完整验收](reports/validation.md)。界面调整不需要重跑全部棋力对战。

## 开源许可

本项目及 Rapfi：GPL-3.0-or-later。权重：CC0-1.0。完整来源、固定对应源码和修改说明见 [THIRD_PARTY.md](./THIRD_PARTY.md)，许可证随仓库和引擎发布文件提供。
