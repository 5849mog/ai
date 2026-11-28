# 五目 · Gomoku Studio

[English](README.md) · **简体中文**

[在线打开](https://5849mog.github.io/gomoku-studio/) · [简洁界面](https://5849mog.github.io/gomoku-studio/?view=simple) · [关于与开源许可](https://5849mog.github.io/gomoku-studio/about.zh-CN.html)

手机、平板和电脑共用一套棋局流程。首页和旧 `renju.html` 地址恢复同一局；完整 / 简洁只改变显示，不改变规则、执色、对局方式或存档。

## 开始与操作

| 入口 | 含义 |
| --- | --- |
| 新局 | 按当前规则和对局方式重新开局，在棋盘旁选择本局角色 |
| 对局设置（简洁界面为「对局」） | 选择规则和对局方式，点「开始新局」后生效 |
| 悔棋 | 撤回实际操作；自动应手与触发它的那一步一起撤回，换色和候选也可撤回 |
| 推荐 | 最多 1 秒搜索预算，用于查看建议。搜索中可取消，出结果后可收起 |
| 更多 | 思考预算、后台思考、截图、自定义摆局、最近对局、电脑引擎及返回完整界面 |
| 完整界面菜单 | 同一套对局设置与工具，另有棋谱导入导出和规则说明 |

「最近更新」可以从「更多」或完整界面菜单打开。日志在后台从本站获取，断网时可查看上次取得的内容。程序更新由现有「检查更新」按钮管理。

鼠标单击落子。触屏先预览，再点同一坐标确认。聚焦棋盘后，方向键选点，Home 回到 H8，回车落子，R 开关推荐。Escape 可以撤销触屏预览或返回禁手确认前的局面。墨绿数字空点依次代表实际下一方的三个候选。对方选了其它位置也直接进入下一手，不冻结榜单或额外弹提示。

声效默认关闭，可在完整界面菜单或简洁界面「更多」中开启，偏好保存在本机浏览器。开启时试听一次，之后每次实际落子播放本地合成的棋子接触声。

对局动效由真实局面差异驱动：落子有落下、接触与扩散反馈，悔棋使用撤回残影，候选按次序进入，终局绘制胜利连线。读档和批量恢复不会冒充新落子；持续效果只使用 transform / opacity，系统的「减少动态效果」设置会关闭全部 CSS 与脚本动画。

换手、十打和第五手选案等阶段操作贴在棋盘上沿或侧边，为按钮单独留白，不挡交叉点。「更多」只在展开时临时显示，不挤压棋盘；返回完整界面有明确按钮。新局不再承担隐藏的长按退出操作。

## 规则与对局方式

规则：无禁手、禁手自由开局、五手两打、塔拉山口-10。完整开局和禁手说明在菜单「规则说明」。

- **AI 替我下 · 外部对局**：录入外部对手的操作，AI 自动完成我方落子；涉及实战换色时由用户确认。自由开局可先录入已有开局，再点「AI 接手」。
- **手动记录双方**：双方棋子、换色、提案和选案都由用户录入，AI 不自动落子。切换分析视角会翻转胜率走势，并保留正在进行的后台分析。
- **与 AI 对弈**：用户操作自己的棋色，AI 自动完成对方回合。
- **同屏双人**：甲乙双方在同一台设备上轮流操作。换色、提案和选案按当前规则执行，推荐与战术图层不显示。

简洁界面和完整界面共用这些选择。「新局」保留当前方式，不会把手动记录自动改为 AI 附身。

自动落子可选 0.1 / 0.5 / 1 / 5 / 10 秒或自适应深思 0～6 秒，思考中可暂停或继续。自适应比较有限候选与后续攻防，胜率是引擎对当前局面的估计。后台思考可关闭，关闭后仍可主动点推荐。切后台会暂停后台思考，悔棋与新局废弃旧答案。算法和验证范围见 [自适应攻防报告](reports/adaptive-defense-v39.md)。

「预计剩余」随局面和引擎分析更新。一手是黑棋或白棋实际落下一子。找到一步终局或引擎给出明确杀棋路线时会显示手数，其他局面显示「暂无明确终局」。简洁界面只在有手数时显示。

与 AI 对弈时可开启「AI 接管我方」观看自战。黑白可分别设置思考时间，棋盘旁可以暂停、继续或在暂停时点「下一步」。切到后台会暂停观战。

## 棋局与文件

实际操作自动保存；刷新恢复局面和轮到谁，最近对局最多保留 50 局，可按收藏、状态和规则筛选，按名称或备注搜索，并切换排序。每局可填写名称与备注。删除记录后可在当前列表撤销最近一次删除。可导出全部对局备份（含名称、备注、收藏与规则记录），也可预览后合并导入；重复记录会跳过，超过容量时不会导入。数据在本设备浏览器，不跨设备同步；保存失败会提示导出。旧无禁手和连珠棋局升级时按最近的有效归档恢复，原记录保留，另一局仍可从最近对局找到。

通过「分享棋局」复制当前对局的链接。打开链接后可先看盘面，再决定是否载入。分享保留已落棋子和开局选择。

导入先校验并预览，确认后才替换；取消或无效文件不改变棋局。五目 JSON 保留角色、换色与候选。旧无禁手 JSON v1 / v2 与 Freestyle SGF 仍可导入。SGF 仅包含实子，不足以恢复正式连珠的换色和提案，因此正式开局请用 JSON。文件上限 1 MiB。

自定义摆局和截图导入均使用独立草稿，明确确认才开始续下。自定义摆局可开启「交替摆子」，成功摆子后自动切换黑白，下一手棋色仍单独选择。菜单可将当前棋盘保存为 PNG 图片。截图只在本机处理；选择图片后会尝试自动定位正视的 15×15 棋盘，未找到时仍可手动框选。请检查红色网格与最外层网格交点是否对齐；识别后可点「定位疑点」逐个查找橙框，或点「查看原图」在相同位置对照，再返回逐点校正，切换不会丢失修改。重置选框会恢复最初的定位。手动记录方式不显示「AI 来走」选择。截图无法还原手序或正式开局，按指定规则作为中盘继续。

聚焦摆局或截图校正棋盘后，可用方向键选点、Home 回天元、回车编辑，`1` 选黑棋、`2` 选白棋、`0` 选擦除。聚焦截图选框后，方向键移动，按住 Shift 加快，Home 恢复初始选框。

终局后显示复盘入口；最近对局可继续未结束棋局或复盘已结束棋局，复盘不会写入当前对局。复盘中的未结束局面可以另开一局，原棋谱保留。复盘可自动播放、倒放和调整速度，也可一键跳到开头或末尾；手动调整进度或切到后台时自动暂停。聚焦棋盘后可用方向键、Home 和 End 导航。

## 电脑引擎与离线

默认在本机浏览器计算，不需要服务器。可选「电脑引擎」把计算交给自己电脑上的原生多线程 Rapfi。手机扫码使用免费临时通道，电脑须开机联网；通道约 60 分钟更新地址后需重新扫码。配置与访问边界见 [电脑服务说明](remote/README.md)。

静态托管支持 GitHub Pages 的 `/gomoku-studio/` 子目录；Service Worker 需要 HTTPS 或 localhost。页面显示「已缓存 · 可离线使用」后，可断网刷新并对弈。打开时和回到前台会检查更新；若本次启动后尚未操作、没有未确认工作且棋局保存成功，新版本准备好后自动刷新。已经操作时保留页面，可在「更多 → 检查更新」手动应用，或下次打开时更新；`update.html` 是独立恢复入口。首次从旧版升级可能仍需手动刷新一次。

浏览器优先使用 SIMD；无跨源隔离时使用完整单线程 NNUE，有共享内存及隔离条件时最多 4 线程。开发服务器提供 COOP / COEP 响应头。WASM MIME 类型应为 `application/wasm`，权重和材质均在本站。搜索哈希预算为 256 MiB，完整进程还需容纳模型和 Worker。

## 从旧网址迁移

请在同一浏览器、同一用户配置下打开 `/gomoku-studio/`，旧 `/ai/` 的棋局和设置会自动恢复。若新网址已下过棋，保留新网址的当前对局，旧棋局会合并至「最近对局」，上限仍为 50 局。更多旧棋局可从[旧网址备份页](https://5849mog.github.io/ai/backup.html)下载。旧书签与分享链接会经兼容页转到新网址。

## 开发与验证

建议使用 Node.js 24 LTS。

```sh
npm ci
npm run dev
```

默认开发地址 http://127.0.0.1:4187/ 。

| 要改什么 | 从哪里开始 |
| --- | --- |
| 对局页面和状态 | `index.html`、`opening-app.js` |
| 棋盘绘制、布局和设置 | `board-view.js`、`board-layout.js`、`board-preferences.js` |
| 规则、开局和换色 | `opening-session.js`、`opening-flow.js`、`renju-rules.js`、`game-rules.js` |
| 搜索与引擎 | `engine.js`、`engine.worker.js`、`engine/`，电脑服务位于 `remote/` |
| 缓存、版本和更新日志 | `sw.js`、`app-release.js`、`content/feed.json` |
| 验证与证据 | `tests/` 放自动测试，`scripts/` 放浏览器验证和基准工具，`reports/` 放历史报告 |

修改首页后运行 `npm run sync:pages` 并提交生成的 `renju.html`。`npm run check` 会检查两页是否同步。GitHub Pages 直接使用仓库中的静态文件。

网页加载仓库中生成的 `*.protected.js`。修改浏览器端 JavaScript 后，运行 `npm run build:protected`，把源码和生成文件一起提交；`npm run check:protected` 可检查生成文件是否与源码一致。发布时同步更新 `APP_VERSION`、Service Worker 的 `RELEASE` 和缓存代号，以及更新日志，确保已安装用户能收到新版。`npm run test:protected` 使用真实引擎和离线缓存验证发布文件（必要时设置 `CHROME_PATH`）。主程序和引擎工作线程包含反调试，打开开发者工具可能暂停页面。混淆会增加分析运行代码的难度，但本仓库的源码仍然公开，浏览器收到的代码也无法彻底隐藏。

构建时还会生成 `_config.yml`，阻止 GitHub Pages 发布根目录下未混淆的 JavaScript 以及开发、测试目录。可以用 `node scripts/verify-published.js _site` 验证发布目录和所需引擎文件。这个配置只影响网站发布，GitHub 公开仓库仍可查看源码。

混淆种子由打包内容生成：相同代码可重复构建，运行代码变化时标识符通常也会变化。种子是公开构建参数，不是密钥，不能阻止自动化分析。浏览器的使用者可以跳过或移除反调试断点，因此断点测试只能证明功能存在，不能证明无法破解。不要把凭据、私有签名密钥或需要信任的授权判断放进发给浏览器的代码。字标的公开派生材料只能提高查看轮廓的门槛；校验代码和公钥可信时，签名可验证取得的文件是否完整。

### 运行验证

```sh
npm test
npm run check
npm run test:navigation
npm run test:opening-dock
npm run test:opening-flow
npm run test:upgrade
```

浏览器验证可用 `CHROME_PATH` 指定 Chromium，或运行 `npx playwright install chromium` 安装测试浏览器。`CHROME_ARGS` 接收 JSON 字符串数组。`test:navigation` 使用确定性引擎检查真实页面、按钮和存档。`test:opening-flow` 默认使用真实 Rapfi WASM。`test:upgrade` 默认从 Git 中的 v47 页面验证升级、迁移和离线对弈，可用 `GOMOKU_UPGRADE_FROM` 指定其他起始提交。

### 发布版本

站内「关于」有 `about.html`（英文）和 `about.zh-CN.html`（简体中文）两个静态入口。修改正文、章节链接或交互说明时请同步两种语言。

发布程序时同步更新 `app-release.js` 和 `sw.js` 的程序版本，并递增 `sw.js` 的页面缓存代数。新增或修改前端静态资源时，在 `sw.js` 的 `CORE` 中登记浏览器实际请求的地址，包括版本参数。页面缓存与固定模型缓存分开，界面更新可复用已下载的权重。

发布日志时更新 `content/feed.json` 并递增 `revision`。`schema` 为 `1`，`releases` 保留最近 1–12 个版本，每条包含 `version`、`title` 和 `changes`。仅补充日志时可以保持程序版本和缓存代数。

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
  timeMs: 10000,   // 单次搜索预算，1–30000 ms
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

[实战棋力报告](report.html) 以完整对局为主：1 秒、5 秒、10 秒三个固定档位两两配对；同一三手开局交换黑白，逐盘记录每手落子、时间预算、实际耗时和终局。页面把胜率与对手和样本数一起展示，并支持回放。胜率是胜局 / 总局数，得分率按胜 1、和 0.5、负 0 计算。

这是同一 Rapfi 单线程 WASM 与 mix9svq 权重之间的自对弈；三组批次分别绑定不同逻辑 CPU 并行运行，每手清空搜索缓存并关闭后台思考。使用无禁手规则；预设三手开局不检验完整开局决策，也不能推导对真人、其他软件或某个对手的胜率。有限开局和样本不足以确定统计优势或 Elo。每盘均可以通过 [实战原始记录](reports/real-games-latest.json) 核验。

复测命令（每组可指定独立 CPU 核心，避免相互争用）：

```sh
GIT_COMMIT=$(git rev-parse HEAD) node scripts/real-game-benchmark.js --pair=1000-5000 --openings=2 --output=reports/real-games-1v5.json
GIT_COMMIT=$(git rev-parse HEAD) node scripts/real-game-benchmark.js --pair=1000-10000 --openings=2 --output=reports/real-games-1v10.json
GIT_COMMIT=$(git rev-parse HEAD) node scripts/real-game-benchmark.js --pair=5000-10000 --openings=2 --output=reports/real-games-5v10.json
node scripts/real-game-report.js reports/real-games-1v5.json reports/real-games-1v10.json reports/real-games-5v10.json
```

每手写入检查点，中断后用相同参数附加 `--resume`；报告生成器检查源码与引擎哈希、执色配对、时间预算与每手合法性。页面在打开、手动刷新和重新可见时读取同源 JSON，报告数据不会被 Service Worker 缓存。早期的 [固定局面与配对基线](reports/strength-baseline-v1.md)、[自适应配对赛](reports/adaptive-strength-match-v1.md) 和 [后台思考报告](reports/ponder-benchmark.md) 保留为历史资料。

浏览器取回 `content/wordmark.wm` 后，先用 `wordmark-trust.js` 中固定的公钥验证 ECDSA P-256 签名，再用 AES-GCM 解密并绘制。已有更新的已签名字标时，会拒绝较旧的响应。密文解密材料公开。防篡改依赖页面本身的验签代码和公钥可信。

发布新字标时，安装 Python 的 FontTools，在本机运行 `node scripts/build-wordmark.js <private-key.pem> <revision>`，版本号需递增。私钥应保存在仓库外。首个生产签名使用的临时私钥已销毁。下一次更新请生成自己保管的 EC P-256 私钥，在上述命令的私钥路径前加入 `--rotate`，将新公钥和字形文件一并提交，并更新页面缓存版本。以后用同一把私钥签名时，只需更新字形文件。

## 开源许可

本项目及 Rapfi：GPL-3.0-or-later。权重：CC0-1.0。完整来源、固定对应源码和修改说明见 [THIRD_PARTY.md](./THIRD_PARTY.md)，许可证随仓库和引擎发布文件提供。
