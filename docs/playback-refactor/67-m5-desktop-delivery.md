# M5 双运行库桌面交付

2026-10-30。保留现有播放器、MPV 独立窗口与原生 Render API；不改变默认引擎，不升级版本，不自动提交、推送或发布。本文记录当前源码构建成品；此前 63–66 的包和验收是历史证据，不能替代本轮结果。

## 当前实现

- 常规桌面配置 `electron/desktop-release.builder.cjs` 在 ASAR 外交付两个 MPV 运行库。用户完整解压后直接运行 AVHub.exe，不再依赖验收 CMD。独立窗口使用 MPV 自有窗口和原有 ASS 控制栏；内嵌使用实际 libmpv D3D11 Render API、共享 F16 纹理和 Electron WebGPU 画布。
- 内嵌不再以 FFprobe 的色彩、格式或初始尺寸判断可否播放。私有 16×16 纹理只用于创建渲染上下文，不展示；实际呈现尺寸来自解码器。文件旋转、非方形像素和播放中分辨率变化按实际尺寸重新创建目标，先等待 GPU 读者释放，再换代共享句柄，不重载媒体或降低源分辨率。
- 不按 SDR/HDR、编码、像素格式、位深、8K、固定 256 MiB 或标签完整程度拒绝视频。D3D11 的真实纹理尺寸、显存、解码器和共享纹理能力仍须满足；错误保留明确诊断和现有播放器入口，不假报成功、不自动转码。
- 独立 MPV 从固定源码构建，启用 LuaJIT，保留截图、音轨字幕、倍速、置顶、队列和进度。启动新的独立会话强校验 EXE、许可与全部动态库；跳播不重复整库校验。
- 默认后端交付改用可追溯的受控 FFmpeg CLI。历史 bin 下的参考工具保留，不冒充当前交付运行库。

## 固定输入和实际证据

本轮成品目录：`build/m5-final-desktop-20261030`，构建 af91fb0d6bbb243b。

| 项目 | 对应输入或报告 |
| --- | --- |
| 内嵌 | build/render-replayed-candidate-7wRYRz；libmpv SHA ee574a3359daa225e63e858faf48e5c3c9be46ddcd552b6781b04992f89d5880；宿主 SHA 86c27f5f8b5511f0dd9066ebfdf3fac4c67845ee562a48e668337f0b16800e7f |
| 独立 | build/mpv-desktop-runtime-95dt6r1c；MPV commit baa3e11d42cb7978da634a8a6a3a55fe074d01be；EXE SHA f4934df422df569b15411a45b03bafffd32da7121132a264a03bc72fcd1ff231 |
| LuaJIT | OpenResty commit 5d8d0a27bfa4595b24b8ed36123555fcd2bb2f8c；MIT；源码归档 SHA 7d1135ba93a7496fbb6d2239fd4c5f2acf89639d99209670a761c7f1f19e009a |
| 构建与静态依赖 | build/desktop-mpv-build-vdmuhux8/report.json、import-audit.json；30 个 PE 文件，29 个附带 DLL，21 个外部静态导入均为 Windows 系统组件 |
| 独立窗口全流程 | build/native-independent-Z1M2Gg/acceptance.json；真实成品，原生指令注入，不冒充物理鼠标或屏幕合成验收 |
| 模式共存、偏好与退出 | build/mpv-window-coexistence-Vaec8h/report.json；两种 MPV 模式与应用退出通过 |
| 动态分辨率 | build/render-unverified-color-F9k4Ta/report.json；640×360 与 1280×720，自然跨段及双向 seek；sourceLoads=1、restarts=0 |
| PQ 与 4K 10-bit | build/render-unverified-color-qvtl74/report.json；build/render-app-flow-QfJUbu/report.json；实际 GPU 导入及帧码定位，不是 HDR 实体显示认证 |
| 控件与缺库恢复 | build/render-app-controls-d4vzTp/report.json；build/render-desktop-package-a9mGjm/report.json；缺失组件不阻止媒体库和另一条可用路径 |
| 后端来源 | build/application-build-replay-NEwWca 与 build/m5-controlled-backend-kost_n3p/AVHubServer；源代码逐项验证，受控 CLI 单独覆盖并核验 |

源码归档构建的 MPV 版本文本可能带 UNKNOWN，因不带 .git；实际源码 commit、归档 SHA、配方 SHA、工具链和二进制摘要均在清单固定，不用版本文本替代来源证明。旧预览清单的 distributionReady=false 是历史来源记录，不应随意改写为许可证认证。

## 交付材料与常规构建

`AVHub-source-materials-<version>.zip` 与 EXE、文件夹 ZIP 一并校验和发布。包含应用源码快照、22 份原生源码归档、3 份原生支持库源码包、11 份受控 CLI 源码归档、实际构建配方/补丁/日志、许可证与 NOTICE。RENDER 明确绑定当前宿主清单和 C# 源码；NATIVE 中历史构建回执不覆盖当前应用源码。源码包不是可运行程序，技术清点也不等于法律认证。

源码生产者：`scripts/stage-m5-source-delivery.py`。准备普通构建输入：`scripts/prepare-desktop-release-inputs.py`，必须绑定本轮实际独立、共存、内嵌报告与源码归档摘要。随后 `npm run package:windows` 使用普通桌面配置；`scripts/build-windows.ps1` 的完整构建还准备受控 CLI，并复制匹配源码包。`scripts/folder-portable.py` 同时检查 FFI、后端/前端许可和独立 MPV 动态库，禁止丢失 DLL 的 ZIP 交付。

这些输入不提交到 Git。全新克隆或 CI 必须先恢复或按源码包说明重建原生输入及对应材料；仅 npm ci 不能生成它们。缺失输入时构建明确停止，不退化成缺少 MPV 的正式包。本文未声称云端已重建原生依赖，也不自动触发 GitHub Actions 或发布。

## 回退与待验证范围

应用设置选择现有播放器、关闭 D3D11 即可回退；保留媒体库数据与现有独立窗口偏好。缺库时可恢复完整原包，不复制系统 DLL，不关闭完整性检查，不覆盖源视频。E:\downloads 始终只读，测试变更只发生在自建样本。

SDR 实体机结果、HDR 纹理导入、物理 HDR 显示准确性是不同证据。实体 HDR、多屏混合 DPI、Dolby Vision/动态元数据和 VMware GPU 兼容性尚未整体认证；这些未验证项不作为源视频白名单。当前最终 EXE/ZIP 的长测、搬迁、旧数据升级及外机复测结果另记 M5-ACCEPTANCE.json；未完成前不把旧包结果算作本轮通过。
