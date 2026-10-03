# 五目 · Gomoku Studio

一个在浏览器本机运行的五子棋对弈工具。玩家可选执黑先手或执白后手，执白时由 AI 开局；15×15、无禁手，五子或长连均获胜。更换执色会开始新局，执色设置会保存在本机。

[在线试玩](https://5849mog.github.io/ai/)。GitHub Pages 托管网页和权重，AI 计算仍在访问者的电脑上完成。

只有一个 AI：Rapfi 250615，使用 mix9svq 神经网络评估。每步默认最多思考 10 秒，可切换为 1 秒或 5 秒；找到确定胜着时允许提前落子。没有等级称号、娱乐技能或在线模型。

## 运行

需要 Node.js 20.19+。引擎发布文件已经随仓库提供，游玩无需 Python、编译器或安装五子棋程序。

```powershell
npm ci
npm run dev
```

打开 http://127.0.0.1:4187/ 。端口可通过 `PORT` 环境变量修改。鼠标悬停预览、单击落子；触屏点击两次确认；棋盘获得焦点后可用方向键选点、回车落子。

悔棋恢复到你上次落子前。思考中也可悔棋或重开，取消的搜索不会把棋子放进新局。引擎失败会保留棋盘，重试可继续原来的 AI 回合。

玩家回合点击「推荐」，引擎在最多 2 秒内同时搜索首选和次选着手：棋盘上的绿色实线圆环「1」是首选，金色虚线圆环「2」是次选。推荐不会落子，也不会改变悔棋记录；仍需由你选择落点，触屏仍须两次点击确认。再次点击「推荐」或按 Esc 可收起或取消。悔棋、新局和换色会废弃旧推荐；推荐期间暂停后台思考。空盘及只有一个可用候选时只显示一个点，不凑数。

棋盘下方显示实时深度、引擎评分、节点数与搜索速度。评分统一以 AI 为视角，正数有利于 AI；它是引擎原始评分，不是实测胜率。后台分析时会显示「AI 后台思考中」，缺失的数据用破折号表示。

后台思考默认开启，可在顶部关闭，偏好会保存在本机。玩家回合继续分析当前局面并复用 Rapfi 搜索缓存；玩家落子时优先执行实际 AI 回合，后台分析得到的假想落点不会落到棋盘。页面隐藏时暂停，恢复可见时继续；悔棋、重开与切色会销毁旧 Worker，清除旧任务和缓存。

普通静态托管使用的单线程 WASM 会同步运行搜索。Rapfi 原生 `INFO pondering 1` 在这类构建中持续占用 Worker，无法及时处理后续命令，因此本站保持原生自动 pondering 关闭，使用每段 250 ms 搜索预算、段间 100 ms 的协作式后台分析。每段重新同步完整 BOARD（空盘为 `BOARD\nDONE`），不清除跨段搜索缓存；多线程构建也使用同一调度方式。单线程收到暂停或落子请求后，会在当前短段返回时处理。搜索预算包含引擎调度误差，后台思考的棋力收益尚未做对战量化。

## 静态托管与离线

将仓库中的网页、assets、engine 及许可文件一起托管即可。兼容 GitHub Pages 的 `/ai/` 子目录，不需要后端。

- 普通 HTTPS 静态托管自动使用完整 NNUE 单线程引擎，支持 SIMD 时选择 SIMD 版本。
- 支持共享内存并具有跨源隔离条件时自动启用多线程，线程数为 `max(1, min(4, hardwareConcurrency - 1))`。
- 本地开发服务器提供 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`。自定义静态服务器可设置相同响应头启用多线程；未设置时仍可正常对弈。
- WASM 文件应使用 `application/wasm` MIME 类型。所有引擎、权重和材质请求均指向本站。
- 首次打开后 Service Worker 缓存网页和四种引擎构建。页面显示「已缓存 · 可离线使用」后支持断网刷新和对弈。Service Worker 需要 HTTPS 或 localhost；直接打开 `file://` 不受支持。

共享的权重数据约 10 MB，四种构建共用同一份 `rapfi.data`。搜索的 `max_memory` 参数设为 256 MiB；评估器、权重和 Worker 也会占用内存。引擎在持久 Worker 中运行，每步复用实例；中途取消时终止该 Worker，下次从本地缓存重新初始化。

部署新版本时需要更新 `sw.js` 的缓存版本。旧缓存只在该项目的 Service Worker scope 内清理。

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
  sideToMove: 2,   // 黑先白后，棋子数量须与行棋方一致
  timeMs: 10000,   // 1–30000 ms，界面提供 1000/5000/10000
  requestId: 1,    // 调用方递增的安全整数
  multiPV: 1      // 普通落子为 1；推荐使用 2，返回 recommendations 数组
});
// result: index, x, y, elapsed, requestId, evaluator, weight；以及实际输出的 depth/nodes/nps 等
engine.cancel();  // 取消未完成搜索，Promise 以 AbortError 拒绝
engine.dispose();
```

玩家回合可调用 `await engine.ponder({ board, sideToMove, requestId })` 开始后台分析，`engine.stopPonder()` 暂停。`onStats` 的 `phase` 为 `search` 或 `ponder`，原始 `evaluation` 对应 `sideToMove` 的视角。实际 `search()` 自动暂停后台分析并优先执行；`reset()` / `cancel()` / `dispose()` 会丢弃旧 Worker 的输出。

初始化状态为 loading/ready/error，搜索时为 thinking。一次只接受一个搜索；超时、非法落点和引擎错误均明确失败，不使用旧引擎兜底。每次搜索都会确认指定的 mix9svq freestyle 权重已启用。

协议适配层使用完整 BOARD 数据同步局面，以黑白交替顺序发送棋子，并把实际颜色转换为协议的己方/对方编号。配置禁用坐标翻转，界面、规则和搜索的坐标一致。

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

## 验证

```powershell
npm test
npm run check
npm run test:browser
npm run test:features
npm run test:recommendations
npm run benchmark
npm run report
```

浏览器验证需要安装 Chrome 和 Edge。测试覆盖四种引擎构建、`/ai/` 子目录、无隔离头的托管、Worker 复用、鼠标/键盘/触屏、思考中悔棋与重开、错误重试、离线刷新，以及 12 个用独立穷举 VCF 验证器证明的战术局面。浏览器结果、证明与截图保存在 reports 中。

本次选色、搜索信息与后台思考的专项验证见 [功能验证报告](./reports/turn-features.md)。`npm run test:features` 使用 Playwright Chromium：首次运行可执行 `npx playwright install chromium`，或用 `CHROME_PATH` 指定已有 Chromium；需要额外启动参数时，`CHROME_ARGS` 接受 JSON 字符串数组。专项测试先运行四种原版 Rapfi WASM 及真实页面，再用确定性的协议测试替身覆盖快速切色、白方胜负、触屏和暂停等边界情况；输出到 `.cache/feature-qa/`。它不替代原有跨浏览器、离线和棋力验收。

棋力测试保留原项目 `0184240a0f3b84b56faba14c86e38697e9c828ce` 的完整引擎作为基线，只用于测试。使用 20 个固定合法三手开局，各交换双方执色，共 40 局；双方均单线程、每步 3.4 秒，和棋计半分，验收得分率为 75%。旧引擎执黑时交换输入棋盘颜色，不修改旧算法。

结果保存在 `reports/benchmark.json`，包含设备、浏览器版本、开局与基线校验值，以及每局完整落子、耗时和胜负。中断后可运行 `npm run benchmark -- --resume`，已完成棋局不会重复。此测试衡量相对本项目旧引擎的棋力，不用于声称通用 Elo 或绝对棋力等级。

完成全部对战后，`npm run report` 重新播放检查 40 局棋谱、独立战术证明和构建校验，并生成 [完整验收报告](./reports/validation.md)。

## 开源许可

本项目及 Rapfi：GPL-3.0-or-later。权重：CC0-1.0。完整来源、固定对应源码和修改说明见 [THIRD_PARTY.md](./THIRD_PARTY.md)，许可证随仓库和引擎发布文件提供。
