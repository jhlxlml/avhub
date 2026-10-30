# M5：渲染依赖链的冻结源码重放

2026-10-28。继续报告 38。版本仍为 0.2.16；未替换应用 DLL、修改默认引擎、打包或推送。源码与配方从 `build/native-source-materials-0tfp4dc4` 读取。

## 实际重建与测试

| 新前缀（均在 build 下） | 重建内容 | Windows 实测结果 |
| --- | --- | --- |
| render-deps-replay-n9lsb7gr | LCMS2（含 fastfloat/threaded 插件）、SPIRV-Cross、xxHash | 浮点色彩转换、已知哈希向量、SPIR-V→HLSL 全部通过 |
| shaderc-source-replay-j5155yvv | shaderc、匹配的 glslang、SPIRV-Tools、SPIRV-Headers | 实际 GLSL→SPIR-V→HLSL 通过 |
| libplacebo-source-replay-halz2k13 | libplacebo、固定 fast_float 与 Vulkan 头文件，链接以上新依赖 | 15 项上游 Windows 测试全部通过，含 D3D11 |

本轮涉及 10 个固定 Git 源归档，包括构建用头文件输入。shaderc 的固定示例输出为 752 字节 SPIR-V，SHA256 `6bd9fe753d2424b3202455a9d8b810919f1d4359b28d14098d3004172b4a8891`，与原候选相同；这只是该示例结果，不能外推为所有着色器语义等价。

libplacebo 实际加载版本 v7.387.0。上游 D3D11 测试约 52.8 秒，日志观察到 NVIDIA GeForce RTX 4090、Intel UHD Graphics 770 和 Microsoft Basic Render Driver（软件适配器）。这些是本机 API／上游渲染测试，**不是跨机器、实体 HDR、多屏显示或 Electron 播放页面验收**。

摘要 `build/render-source-replay-result.json`；各前缀包含 report.json、构建日志、windows-tests.json 和测试日志。D3D11 详细日志为 libplacebo-source-replay-halz2k13/windows-test.d3d11.c.exe.log。

## 输入与前缀隔离

- 共用 `scripts/native_source_replay.py` 核对冻结清单全部文件的大小、SHA256、路径与文件类型，要求实际构建配方及共用校验模块与冻结副本一致。
- 三个重建报告记录相同的 inventorySha256；libplacebo 显式选择本轮两个新依赖前缀，并要求其 Windows 检查通过及冻结材料身份相同，没有回退到原依赖前缀。
- 现有编译器／工具链仍复用，未重新构建 GCC，也不是干净机器重建。没有启用下载或修改媒体文件。
- 仅使用各自独立 replay 指针。原 render-deps-cross-latest、shaderc-windows-cross-latest、libplacebo-windows-cross-latest 分别仍指向 m3twx_94、k10wlpyf、1bb_qu_s。
- 源码固定版本、D3D11／色彩／shader 配置保持既有范围；未以关闭功能、降精度或画质转换换取通过。

## 修复验证脚本的失败退出码

核查发现 verify-libplacebo-windows-harness.py 原先即使上游测试失败，也可能写出 `passed: false` 后以进程状态 0 结束。现已在失败时返回 1，使调用方能正确阻止后续步骤。

负向回归在自建隔离目录中加载真实 libplacebo DLL，并编译一个故意返回 7 的小测试子进程。验证脚本实际保留失败报告并返回 1。**这只是验证脚本的合成负向测试，不算上游测试或渲染性能结果**；测试结束后该隔离目录已清理，不改变任何默认指针。

相关 Python 回归共 38 项，通过 37 项、跳过 1 项（已有目录链接测试的环境限制）。同时核对新 DLL 文件身份、三层来源一致性、默认指针保留和实际 Windows 测试证据。

验证脚本最后一项退出码修复在材料冻结后完成，实际执行版本的 SHA256 单独记录在摘要的 validationRecipes 中；未改写冻结材料来冒充其原始内容。

## 当前边界与下一步

已实际重建 MPV 单层（报告 38）及渲染链；媒体解码和字幕链仍为原先已验证的前缀，尚未完成其独立重放。下一步按固定来源重建 dav1d／FFmpeg 与字幕字体链，再组装并验收整个新闭包。

本轮新库没有加入 Electron 允许的 DLL 哈希。没有将报告 36 的桌面结果转移给这些新产物，也不宣称已经更快、更清晰或完成 M5。完整应用源码与发行材料审核、成品／干净机器验收及已保留的资源观察继续待办，发行标志保持 false。
