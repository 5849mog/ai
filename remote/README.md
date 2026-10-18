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

已准备好桌面「五目 · 手机远程连接」快捷方式。双击后，在本机窗口扫描二维码，或把窗口里的私用链接发送到自己的手机，打开后点「连接并使用」。手机不用安装组网软件，不用注册通道账号或付款。

也可运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File remote/phone.ps1
```

窗口支持复制链接、刷新连接和关闭远程连接。再次打开快捷方式复用现有服务，不重复启动；关闭连接窗口不停止后台服务。彻底停止手机通道窗口可运行同一脚本加 `-Stop`；原电脑计算服务可继续本机使用。

使用 Windows 自带 OpenSSH 和 Pinggy 免费 443 端口通道。免费单次最多 60 分钟、地址会变化；到期自动重建并更新二维码，手机需重新扫码，原棋盘保留。电脑需保持开机和联网。这是无账号、零费用的临时地址模式，不是永久域名。[免费限制](https://pinggy.io/help/)

启动参数必须保留 `x:passpreflight`，让浏览器不带密钥的 OPTIONS 预检到达受控入口，再由入口返回精确的来源许可；实际搜索请求仍须完整密钥认证。普通浏览器与手机会发送这类预检，缺少此配置时可能只显示 `Failed to fetch`。实际请求同时保留 `X-Pinggy-No-Screen`。[官方预检配置](https://pinggy.io/docs/advanced/advanced_options/)

远程计算预算与网络等待分开：原生搜索仍使用所选的 1/5/10 秒预算，网页额外保留最多 15 秒网络余量，涵盖停止后台思考与请求传输；不会把这段余量交给引擎增加计算时间。网页本机引擎仍使用原有 3 秒余量。

通道只转发到受控入口 `127.0.0.1:4189`，不直接开放计算服务 `4188`。入口只提供健康检查和认证对弈协议，拒绝文件、目录和管理接口。默认只允许本项目网页来源。免费域名自动走经认证的 HTTP 长轮询，避开免费服务的浏览器确认页对跨站 WebSocket 的阻断；其他地址保留 WebSocket。两种方式复用同一原生引擎、取消和棋盘验证，不会自动改回网页计算。

专用 SSH 密钥、主机记录、二维码和控制窗口令牌位于 `%LOCALAPPDATA%\GomokuRemote`，不上传到仓库。二维码由本机库生成。不要分享私用配对链接。原有组网或 HTTPS/WSS 代理仍可使用，目标也应为受控入口；自定义 TLS 证书模式继续由自有代理配置限制。

实际公网验证、免费通道的限制及尚未进行的真实手机验收，见 [验证记录](../reports/remote-free-channel.md)。电脑端为适配现有网络出口使用了已有代理，没有修改系统网络设置。

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
