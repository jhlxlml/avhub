# M5：FFmpeg、着色器链与 D3D11 渲染依赖实际构建

2026-10-27。接续第 33 批。Git 基线 `main / 9678689`，原有修改保留。本批为隔离的 Windows 原生库构建与验收，未更换应用运行库、修改原媒体、打包、升版本、推送或发布。完整 libmpv 尚未生成，M5 不放行。

## 构建输入与方案

新增 `prepare-native-git-inputs.py`：只选择显式组件、HTTPS 官方仓库和完整固定提交，浅取到独立自有 Git 目录，核对顶层、HEAD、干净状态，保存 Git 源归档及 SHA-256。重跑会检查已有归档与已记录摘要，不重置/清理原有树，也不把未知或损坏归档重新标成有效。子模块未隐式获取，dependencyClosureVerified 保持 false。

独立解析的 glslang、SPIRV-Tools、SPIRV-Headers 引用与固定 shaderc `170316e2df47f621804bb6372e7fe00c10184105` 的 DEPS 不同。本批新增 `ci/native-shaderc-dependencies.json`，按父项目 DEPS 原文固定配套三提交，记录 DEPS 摘要和此前独立引用；原始提案、缓存和旧 DLL 历史未改写。DEPS 通过 AST literal_eval 读取 vars，没有执行外部 Python 文件。

libplacebo `275f7dea27924cdd34ab2e6c20e448b6bc4fab65` 的公共 Vulkan 接口即使在 D3D11-only 构建下仍需 Vulkan 头文件。新增 `ci/native-libplacebo-dependencies.json`，使用父仓库 gitlink `74d8a6cb930c68ef617b202c3ff3c59d919e086b`，仅补头文件。用户提供的 Vulkan 1.4.363 运行时未更换。

## 实际发现并解决的问题

1. **资源编译器错误使用主机预处理器。** 仅解压 Debian 包不会运行 update-alternatives。FFmpeg/LittleCMS 首次编译在 Windows RC 中找不到 windows.h。`prepare-native-cross-tools.py` 现在生成项目内明确的 GCC/G++/windres 等入口，并向 windres 显式指定交叉 GCC、`-E -xc -DRC_INVOKED`。没有修改系统 alternatives。探针增加实际包含 windows.h 的资源编译、链接及 Windows D3D11 运行测试，均通过。
2. **基础 FFmpeg 没有可用 AV1 软件解码器。** 初次基线 3 个目标帧通过，AV1 失败；未把这轮标成兼容性通过。补固定 dav1d `e5fd231fe9955a342c60600edb7e0b8777786a6a`，明确编译 8/16 两类位深路径（16 类覆盖高位深实现），以 `--enable-libdav1d` 重建后，4K AV1 的实际 Windows 解码通过。
3. **shaderc CMake 导出依赖不完整。** 启用 SPIRV-Tools install/export 定义解决 glslang 引用 SPIRV-Tools-opt 的生成错误，保留优化器。随后发现单独 shaderc_shared 目标不会生成 shaderc.pc，构建脚本明确同时执行上游 shaderc-pkg-config 目标，没有手写替代版本/链接信息。
4. **libplacebo 缺少公共 Vulkan 头文件。** 补入父项目固定 gitlink 的头文件后重新构建；未删除公共接口或伪造空头文件。

首次失败保留：`build/ffmpeg-windows-cross-j0_tn0zw/`、`build/render-deps-cross-zd3_g028/`、`build/shaderc-windows-cross-m27ulr_l/`、`build/libplacebo-windows-cross-6c8nky99/`。基础 FFmpeg 的 AV1 失败报告保留在 `build/ffmpeg-windows-cross-p_38v5nz/windows-tests.json`。shaderc 的编译成功/后续缺 pc 阶段及补目标日志保留在最终 k10wlpyf 目录。

## 实际结果

| 项目 | Windows 实际验证 | 证据 |
| --- | --- | --- |
| RC、C++20、D3D11 设备 | 编译、链接、硬件设备创建通过 | `build/native-cross-tools/execution-probe.json` |
| LittleCMS / SPIRV-Cross / xxHash | 浮点 sRGB 变换、SPIR-V 转 HLSL、已知向量通过 | `build/render-deps-cross-m3twx_94/windows-tests.json` |
| shaderc 配套链 | 实际 GLSL → SPIR-V → HLSL SM5 通过 | `build/shaderc-windows-cross-k10wlpyf/windows-tests.json` |
| FFmpeg + dav1d | H.264、4K HEVC、4K 10-bit HEVC、4K AV1 各一个固定目标的原尺寸原像素格式 YUV 输出与现有 FFmpeg 逐字节一致，4/4 | `build/ffmpeg-windows-cross-qhjdbkpa/windows-tests.json` |
| libplacebo 7.387.0 | 新 DLL 实际加载，官方 D3D11 GPU 测试及全部 15 项测试通过，共 53.22 秒 | `build/libplacebo-windows-cross-1bb_qu_s/windows-tests.json` |

libplacebo 官方测试还包含缓存、色彩、合成、抖动、滤镜、ICC、LUT、选项、场景、字符串、tone_mapping、工具等；运行上游 tone_mapping 单测不代表应用开启 HDR→SDR。D3D11 测试使用实际候选编译对象与着色器/色彩依赖，日志包含本机 NVIDIA GeForce RTX 4090、Intel UHD Graphics 770 及 Microsoft Basic Render Driver（软件适配器）的测试路径；硬件和软件路径分别保留原始日志。这属于真实 GPU/适配器测试，不是 Electron 画面、其他电脑或实体显示测量。

Windows FFmpeg 测试显式使用软件解码，将生成样本的一个指定帧以源像素格式导出原始 YUV；没有编码、缩放或主动色彩变换。生成源前后 SHA-256 相同。该结果仅覆盖这四个帧，不证明整库、所有 HDR/音频、随机跳播性能或完整特性等价。dav1d 高位深实现已编译，但这轮 AV1 样本为 8-bit，不把 HEVC 10-bit 验收写成 AV1 10/12-bit 验收。

单元回归：固定源选择、工具元数据、引用解析、免模型配方、归档和源树捕获共 22 项；Windows 21 通过/1 项链接权限跳过，Ubuntu 22 项全部通过。新增 Python 脚本语法检查通过。

## 范围与待办

本批 libplacebo 候选明确只启用 D3D11；shaderc、lcms、xxhash 启用，Vulkan/OpenGL 后端及独立 libdovi 未启用。普通 DOVI shader 支持仍由上游构建为 YES。这是限定 SDR/D3D11 的依赖可行性构建，不能默认为旧运行库全部功能等价。新的 DLL 和 GCC 支持运行库均在自有 build 前缀，旧应用 DLL 未替换。

FFmpeg 目前是显式基础能力构建，外部库除了 dav1d 尚未全部补齐；featureParityVerified、distributionReady 仍为 false。新获取的源码不等于旧 DLL 的精确历史或已完成再分发审核。完整依赖清单、相应源码/构建输入/许可材料和新库对应关系仍待收口。

下一步补齐字幕/字体及 MPV 必需依赖，实际生成 Windows libmpv；再用新 DLL 跑 Render API、原尺寸/位深/色彩、真实 Electron 播放与跳播、字幕音轨、退出及长时回归。上述依赖库测试不能替代应用验收，更不能替代未配置开发环境的成品验收。
