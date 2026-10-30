# M5：精确源码输入与可交付材料核查

2026-10-28。继续报告 36。版本仍为 0.2.16，未改变播放代码、宿主或 DLL，未打包、推送或发布。此处的“源码材料目录”不含应用成品，也不等于 M5 完整放行。

## 补齐的实际缺口

此前 4 个 GCC/MinGW DLL 已能对应到准确的 Ubuntu 二进制包，但仅有版权文本和 gcc-mingw-w64 构建规则，缺少实际 GCC 源码。

读取实际 gcc-mingw-w64_26.1.tar.xz 的 debian/rules 后确认：它依赖 gcc-13-source，用 `$(source_version)+$(DEB_VERSION)` 组成二进制版本。此次收集的版本链为：

- gcc-13：13.2.0-6ubuntu1；
- gcc-mingw-w64：26.1；
- 已用 GCC 运行库包：13.2.0-6ubuntu1+26.1；
- 已用 MinGW 包及源码：11.0.1-3build1。

当前 Ubuntu archive 镜像中的旧 gcc-13 DSC 返回 404，后从 Ubuntu 官方 Launchpad 历史归档取得**同一个精确版本**，没有以新版本替代。原始归档、发行版补丁归档、DSC 共 9 个文件均已缓存并按大小和 SHA256 验证。下载约 105 MB。

精确 URL、文件大小与哈希记录在 `ci/native-support-sources.json`。DSC 自身的 SHA256 来自本轮官方 HTTPS 观察；归档哈希同时与该固定 DSC 的 Checksums-Sha256 段一致。**尚未验证 DSC／上游签名，不把这些观察宣称为签名认证或二进制可复现证明。**

## 源码材料目录

最终目录 `build/native-source-materials-8cvvyusu`，入口 `inventory.json`、`README.txt`；指针为 `build/native-source-materials-latest.json`。共 576,593,161 字节，约 550 MiB。

实际复制并逐项核对：

- 21 个这次媒体／渲染构建所用 Git 源码归档及其 revision、SHA256 记录；
- 3 个 GCC/MinGW 精确源码包的 9 个文件；
- 本项目构建／验证脚本、配置、原生宿主 C# 源码；
- 实际构建报告、配置参数、日志及编译器包装脚本；
- 原候选已收集的许可文本，以及项目 GPLv3 LICENSE。

保留项目相对路径，便于审核输入和构建规则。没有收集用户媒体、数据库、Git 配置或应用运行库二进制；没有执行下载的源码，也未安装任何软件包。完整 AVHub 应用源码及依赖仍需在授权发行时与正式 revision 一起提供，该目录只覆盖原生链材料。

## 子模块范围

没有把原记录中的 `submodulesVerified: false` 改成笼统的 true。

- libplacebo 的 fast_float、Vulkan-Headers 在本次构建中用到，已按构建记录收集独立固定 revision 归档。
- 实际配置为 `-Ddemos=false`、`-Dopengl=disabled`、`-Dvulkan=disabled`；演示程序、OpenGL glad 及其生成依赖不是该 D3D11 构建的启用输入。Vulkan 头文件仍单独保留，因为构建用到其类型定义。
- FreeType 实际生成的 freetype2-build/ftoption.h 中 `FT_DEBUG_LOGGING` 未定义；src/dlg/dlgwrap.c 仅在该宏开启时引入 dlg.c。当前没有构建这个可选调试实现，未因此引入或冒充核验 dlg 子模块。原始上游源码与配置日志均保留。

这些结论只适用于本次精确配置；启用其他功能必须重新评估源码闭包。

## 新增工具与结果

- `prepare-native-support-sources.py`：默认仅离线验证；显式 `--download` 才下载固定来源，限制文件大小、下载时长及空间，不覆盖已存在但哈希不符的输入，不执行归档内容。
- `stage-native-source-materials.py`：构建独立审核目录，逐项验证输入与复制后哈希；限制来源为项目内常规文件，排除链接及超过容量的输入，不更改已冻结的 Electron 候选。
- 相关 Python 回归总计 24 项，通过 23 项、跳过 1 项（宿主不允许创建测试目录链接）。包括包／版本链、实际包装脚本哈希、源码清单篡改拒绝、未知来源／路径／容量拒绝、整目录内容身份及不误授予发行状态。

本轮只改源码材料工具及文档，因此没有重复桌面播放验收；此前报告 36 的真实 Electron 结果仍对应同一宿主和 DLL。

## 还不能宣称完成的内容

1. 未从该材料目录在独立干净环境重放整个构建，不宣称字节级可复现；Ubuntu 工具链包补丁、许可证义务与完整对应源码交付仍需最终审核。
2. 尚未产生与正式发行 revision 匹配的完整应用源码快照，未做新库成品与干净机器验收。
3. 报告 36 的原始资源波动观察继续保留；实体 HDR、多屏不同 DPI 按已有约定延后。

`distributionReady`、`productionDistributionReady` 继续为 false。下一步先在独立构建前缀重放关键构建及验证源码材料的可用性，再按用户明确授权进行成品验收；不自动切换默认运行库或推送远程。
