# M5：隔离 Windows 交叉工具链与实际依赖库验收

2026-10-27。Git 基线仍为 `main / 9678689`；保留现有未提交修改。本批只改构建准备脚本、测试和阶段记录，没有改应用播放代码、当前运行库、默认引擎或原媒体。M5 仍未完成。

## 从缺少工具推进到实际 Windows 构建

新增 `prepare-native-cross-tools.py`：通过已有 Ubuntu APT 元数据锁定版本、大小、SHA-256 和源码包名称，显式 `--download` 下载后逐一复核，只用 `dpkg-deb --extract` 解压到 `build/native-cross-tools/root`，不执行维护脚本、不调用系统安装、不改 dpkg 数据库。固定输入和校验记录为 `inputs.json`、`report.json`。

实际校验、解压 **13 个包**：MinGW GCC/G++ 与运行库、binutils、Windows 头文件/库、Meson、Ninja、pkgconf 及 NASM。摘要的信任来源是本机既有 Ubuntu 软件包索引，不能冒称重新完成了上游源码签名审核。主机 glibc、Python、CMake、Make 等仍使用既有环境；不是完整 hermetic 环境或工具链再分发物。

`probe-native-cross-tools.py` 实际运行这些工具，并用隔离 G++ 编译 C++20 `std::span`、D3D11/DXGI 头文件及 D3D11 设备创建程序。该程序已在真实 Windows 上运行成功，创建 hardware D3D11 设备，feature level 为 45056（11.0），直接 DLL 导入仅为 d3d11、KERNEL32、msvcrt。证据 `build/native-cross-tools/execution-probe.json`。这证明编译/链接/Windows 加载的基础链路，不等于 MPV 或实际播放验收。

## Opus 的真实 Windows DLL 与官方测试

`build-opus-windows-harness.py` 使用固定官方提交 `a8b2545eec71e0f53ecead2d583e7b6baa42684d` 的 `git archive`，另建源目录，保存源归档、工具链文件、编译输入清单、版本元数据及各自哈希。明确使用已审核的免模型 profile，保留标准 Opus codec。版本元数据 `1.6.1-85-ga8b2545` 为对应已记录上游日志的构建输入，不制造新的 Git 标签。

上游 CMake 只在静态配置下构建五个官方测试，因此分别构建 shared DLL 和 static tests，不能用 shared 构建成功冒充测试成功。实际普通库编译单元 **154**、DNN 编译单元 **0**。

首次 Windows 加载发现新 DLL 导入 `libssp-0.dll`，而验收目录未包含它；失败记录保留在 `build/opus-windows-cross-4vrstk96/windows-tests-first-missing-libssp.json`。核对 PE 导入及固定工具包来源后，脚本自动将该运行库带到独立 DLL/测试目录，保留栈保护，没有通过关闭编译防护绕过缺件。该组件也必须进入后续新 DLL 的实际依赖及许可材料审查，不能假定目标电脑已有。

最终完整自动构建证据：`build/opus-windows-cross-m3x_xl_c/report.json`。源码 SHA-256 为 `50b20b88b63ffeee2403fa906cd9c3b7001faa49c865e92cafb690a215468dfe`，编译输入清单 SHA-256 为 `c868c293566e65f7f27dd7a8e3a9a48aec7e23a585ea293177273791d1bda6a5`。产物逐项哈希与日志保存在同目录；固定输入可追溯不等于已证明二进制逐位可复现。

`verify-opus-windows-harness.py` 用 Windows Python 的 cdecl API 真实加载新 DLL，执行双声道 48 kHz、960 samples/channel 的合成正弦编解码调用，再直接执行五个 Windows 官方测试程序。自然媒体和应用音频均未修改；合成 codec 测试也不代表无损编解码或主观听感验收。

## 测试与边界

- 元数据边界、引用解析、免模型配方、源码归档校验和源树捕获回归：Windows 共 19 项，18 通过、1 项链接权限跳过；Ubuntu 同样 19 项全部通过。
- C++20/D3D11 实际 Windows 探针：通过。
- 前一次 Windows DLL API 及五项官方测试全部通过：`build/opus-windows-cross-4vrstk96/windows-tests.json`。
- 最终自动构建后的 Windows DLL API 和五项官方测试也全部通过：`build/opus-windows-cross-m3x_xl_c/windows-tests.json`；五项官方测试耗时合计 43.95 秒。

没有应用代码变更，未把库单测写成真实 Electron 播放成绩，未重用旧播放器长时成绩作为新库验收。实体 HDR、多屏仍保留待办；原画、位深、色彩、默认引擎和现有 libmpv 均不变。未打包、升级版本、推送或发布。

## 仍需推进

工具链基础已验证，但完整 MPV 依赖构建环境尚未闭合。`remaining-host-tools.json` 记录实际还缺 autoconf/automake/autoreconf/libtoolize、bison/flex、Rust/cargo、clang；其中哪些必须使用，要按最终依赖配置展开，不能照上游下载列表一概判定必需。

下一步固定并获取实际构建配置所需的 FFmpeg、libplacebo、字幕/字体和音视频依赖源码及补丁，补齐必要主机工具、完成传递依赖与许可材料；然后实际构建 Windows libmpv。新库必须重新通过 Render API、尺寸/位深/色彩、真实 Electron、音轨、跳播和长时验收后才能评估替换。完整源码、发行义务和未配置开发环境的成品验收仍未完成，M5 不放行。
