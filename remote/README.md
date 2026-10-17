# 五目电脑计算服务

这不是另一套棋盘界面。继续使用当前云端网页，由电脑上的 Rapfi 原生 AVX2 引擎计算，网页保留连珠开局、三候选、自适应深思、截图摆局、归档与复盘逻辑。原生计算不会受浏览器的 4 线程上限限制；服务默认用本机可用逻辑核心数减一，本次电脑为 15 线程，搜索哈希预算默认 256 MiB。更多线程不保证按比例提速，本次没有重新测定棋力或加速比。

## 在同一台电脑先使用

已准备好 `remote/engine/manifest.json` 后，双击 `remote/start.cmd`。它会在后台启动计算服务，并打开云端网页的配对窗口。启动入口避开旧首页缓存，配对时等待正在安装的新页面缓存生效，再恢复当前棋局。密钥从启动链接预填，确认「连接并使用」后才保存。片段中的密钥与启动参数立即从地址栏移除；不会把密钥发送到 GitHub。密钥仅进入标签页会话，不写入棋谱、归档或 Service Worker 缓存。

电脑网页使用 `http://127.0.0.1:4188`；新版 Chrome 如询问本地网络访问，请允许。若曾拒绝，在该网站的权限设置中允许后重试。浏览器安全检查保持开启；无权限时明确报错，保留棋盘。网页菜单以及简洁模式「更多」均有「电脑引擎」入口，可以手动连接或明确切回网页计算。

关闭对弈页面会释放原生进程；小型连接服务保留，方便再次打开。停止服务（会先关闭连接并结束其原生进程）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File remote/start.ps1 -Stop
```

## 手机通过互联网连接

手机的 `127.0.0.1` 指手机自己，不能使用上述电脑本机地址。需要一条可用的 HTTPS/WSS 通道，将你的远程地址反向代理到电脑受控对弈入口 `127.0.0.1:4189`，并支持 WebSocket 升级与长连接。不要把通道直接指向计算服务的 `4188` 端口。

默认受控入口与计算服务由同一启动器管理，均只监听本机。入口只提供 `/health` 与 `/gomoku`，拒绝文件、管理、额外路径与查询参数；只允许本项目网页来源，客户端先通过随机密钥认证，才建立到计算服务的连接。停止本地服务也会关闭该入口。`GOMOKU_REMOTE_GATEWAY_PORT` 可调整入口端口，电脑本机配对仍使用原来的 `4188`。若显式配置服务自身的 TLS 证书，则保留原 TLS 服务、不启动这个明文上游入口，访问限制由自有 TLS 代理负责。

零费用候选是 [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)：不要求账号或域名，临时 HTTPS 地址每次重启都会变化，也没有可用性保证。不需要购买方案。本机已经下载并验证官方 cloudflared `2026.10.1`（Windows amd64 SHA-256 `4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6`）。当前自动审批拒绝启动外网通道，受控入口方案也未获放行，因此**尚无可用的手机外网连接地址**，不能把入口测试通过当作外网已连通。完整记录见 [免费通道验证记录](../reports/remote-free-channel.md)。

- 现有组网/穿透可以沿用，不绑定某一个网络供应商；服务支持 Tailscale Serve 等私网 HTTPS 反向代理，也可接已有受控公网 TLS 代理。
- 网页填 `https://你的远程域名`，协议连接到 `/gomoku`，连接检测使用 `/health`。两条路径均应转发到本机服务。配对密钥取自 `%LOCALAPPDATA%\GomokuRemote\pairing-key.txt`，不要使用报告里的测试密钥。
- 默认只接受 `https://5849mog.github.io` 的网页来源。认证前不启动引擎；通过认证后仍限制为同一时刻一个实际页面拥有引擎。另一页会得到占用提示，不会重置正在对弈的页面。
- 连接中断时保留当前棋盘和存档，不自动改用另一引擎。可以重试，或者明确选择「网页计算」后续下。计算预算之外还有网络延迟。
- 电脑须保持开机且服务、通道均运行。电脑关机时，手机仍可单独使用原网页引擎；若希望关机也有原生算力，需要额外的常开服务器。

截至此次交付，未在本机常见服务、进程和已安装程序中发现可复用的组网工具，未配置跨互联网通道，也未在真实手机外网测量延迟。不能把本机协议联调当作外网已经连通。

参考：[Tailscale Serve 官方说明](https://tailscale.com/docs/features/tailscale-serve)。如果已有该网络，目标应为受控入口 `http://127.0.0.1:4189`；首次启用涉及账号及 HTTPS 设置。此次没有修改路由器、防火墙、开机启动。

## 准备原生资源

Windows x64、支持 AVX2/FMA/BMI2，Node 20.19+。先 `npm ci`。已有本项目原生引擎包时可直接复用：

```powershell
npm run remote:prepare -- --from D:\测试\ai\desktop\engine
npm run remote:serve
```

准备脚本校验固定 Rapfi / Networks 提交和每个原生文件，按清单拼合并校验连珠黑白权重，生成独立的 `remote/engine/`，不会改原桌面文件。原生启动最初构建自由规则评估器，所以连珠资源目录也保留同版本 freestyle 权重。新服务启动前重新验证所有生成资源的 SHA-256。

没有原生包时，可重建相同固定源码和对齐修复补丁，再准备运行目录：

```powershell
python -m pip install --target .cache/build-tools cmake==4.4.3 ninja==1.13.2
python scripts/build-remote-native.py
npm run remote:prepare -- --from .cache/remote-native-source
```

构建使用 Rapfi `250615` / `1be1551ced57e38d53ed58f6d74bf6f8b4bdc230`、Networks `918b757a129258e9e765f77fe17d507c2bb1a60b`、LLVM-MinGW `20260616`。构建脚本记录编译器、源码、补丁与产物校验值；原生 AVX2 对齐补丁见 `scripts/native-patches/rapfi-avx2-policy-load.patch`。依赖来自固定上游，许可证随准备目录分发。生成的可执行文件、权重与本地配对密钥不提交到仓库。

## 资源配置

```powershell
$env:GOMOKU_REMOTE_THREADS='15'
$env:GOMOKU_REMOTE_MEMORY_MIB='256'
$env:GOMOKU_REMOTE_PORT='4188'
npm run remote:serve
```

线程数最多为可用核心数减一；内存可设 32 MiB 至本机总内存一半、最高 4096 MiB。这是搜索哈希预算，不是完整进程内存。地址只监听回环接口。需要服务自身提供 TLS 时，可设置 `GOMOKU_REMOTE_TLS_CERT`、`GOMOKU_REMOTE_TLS_KEY`；一般由已有加密代理负责 TLS。自托管网页可用 `GOMOKU_REMOTE_ORIGINS` 设置逗号分隔的明确来源列表，不支持通配符。

## 验证

```powershell
npm test
npm run check
npm run test:remote
npm run test:remote-gateway
```

真实原生联调覆盖 Chrome、Edge、15 线程 / 256 MiB、三候选、限定候选、平衡搜索、自定义摆局、连珠权重、禁手查询、后台抢占、Worker 复用、取消、刷新、触屏确认、思考中悔棋、断线和显式切回网页计算。测试报告 [remote-native-qa.json](../reports/remote-native-qa.json) 明确记录使用的是本机 WebSocket 链路，不代表外网可用性。另有单元验证配对、来源、会话隔离、跨页占用、取消代际与健康检查的权限边界。
