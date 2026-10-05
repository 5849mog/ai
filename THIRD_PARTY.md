# 五目与开源许可

五目使用本机 Rapfi 引擎进行五子棋对弈。没有在线模型或云端搜索服务。

本项目以 GNU GPL-3.0-or-later 发布，完整许可证见 [LICENSE](./LICENSE)。

## Rapfi

- 作者：Rapfi developers，来源：https://github.com/dhbloo/rapfi
- 固定版本：250615，提交 `1be1551ced57e38d53ed58f6d74bf6f8b4bdc230`
- 完整对应源码：https://github.com/dhbloo/rapfi/tree/1be1551ced57e38d53ed58f6d74bf6f8b4bdc230
- 许可证：GPL-3.0-or-later，随引擎附带 COPYING-Rapfi.txt。
- 本项目的源码修改保存在 scripts/patches：修复单线程构建的线程成员访问；无 SIMD 构建不编译未使用的 mix10 评估器。mix9svq 的搜索与评估逻辑保持原样。
- 完整构建步骤与数据打包修改见 scripts/build-engine.py 和 README.md。

## 神经网络权重

- 来源：https://github.com/dhbloo/rapfi-networks/tree/918b757a129258e9e765f77fe17d507c2bb1a60b
- 固定提交：`918b757a129258e9e765f77fe17d507c2bb1a60b`
- 本项目打包 `mix9svqfreestyle_bsmix.bin.lz4`、`model210901.bin`，连珠另加载同一固定提交的 `mix9svqrenju_bs15_black.bin.lz4` 与 `mix9svqrenju_bs15_white.bin.lz4`，以分片传输并核对完整 SHA-256。
- 许可证：CC0-1.0，随引擎附带 LICENSE-Networks.txt。
- 配置来源：对应提交的 config-example/gomocalc-mix9svq.toml；基础包保留 freestyle 权重，连珠配置加黑白专用权重；坐标转换设为 none。连珠权重可用 scripts/prepare-renju-models.py 重现。

## 构建与校验

Emscripten 3.1.64 编译四个浏览器版本。engine/rapfi-250615/manifest.json 记录源代码提交、补丁校验值及全部发布文件的 SHA-256。

棋盘、底纹、棋子及按钮的 SVG 材质由本项目提供，遵循本项目许可证。

## 品牌字体

- 页首“五目”使用 Noto Serif SC Medium（500），仅包含这两个汉字的本地 TrueType 子集，约 2 KB；正文继续使用系统字体。
- 来源：https://fonts.google.com/noto/specimen/Noto+Serif+SC ，源码：https://github.com/notofonts/noto-cjk/tree/main/Serif 。
- 许可证：SIL Open Font License 1.1，完整声明见 [OFL-NotoSerif.txt](./assets/OFL-NotoSerif.txt)。字体随站点缓存，页面不请求外部字体服务。

Rapfi 链接的 cpptoml、cxxopts、LZ4、xxHash、LZ4 stream 和 SIMDe，以及 Emscripten 运行时的上游许可声明，完整保存在 [NOTICE-Dependencies.txt](./engine/rapfi-250615/NOTICE-Dependencies.txt)。这些组件保留各自的 MIT、BSD、CC0 或 LLVM 等许可声明。
