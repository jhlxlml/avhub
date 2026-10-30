# M5：固定 Vulkan 输入与独立布局准备

2026-10-27，接续第 25 批。播放器、宿主与默认引擎不变；未打包、推送或改版本。M5 尚未完成。

## 本批实现

- `ci/vulkan-runtime.json`：固定 LunarG Runtime ZIP 版本 1.4.350.0、大小 20,034,700、SHA-256 `23ce69f32cef3e2799617e2b1776cd0c71030d23a91f8375821cc40d76b185b9`，均来自 [官方公开文件目录](https://vulkan.lunarg.com/sdk/files.json) 的 windows/1.4.350.0/Runtime zip。没有把 latest 用作构建输入。
- `third_party/vulkan-loader/LICENSE.txt`：取得并保留 Khronos 固定标签对应提交 `a9e72c66d5cb79911eb9a9063bf4016dd0a3a123` 的原始许可文本，记录哈希。标签/源码许可材料不等于已取得或验证官方二进制。
- `scripts/prepare-vulkan-runtime.py`：校验固定 ZIP 后，从真实 PE Machine 与 PE32+ 标识选择唯一 AMD64 loader。固定输出名，不执行归档路径，不运行安装器，不写系统目录，不覆盖不同文件。支持离线输入。
- `scripts/stage-render-runtime.mjs`：先核验开发运行库和真实 Vulkan 准备记录，再创建新的本地目录，布局为宿主、libmpv、Vulkan、ffi、source、licenses。保留源码构建对应关系和 FFI 原始校验清单，输出 layout.json。目录不是成品 EXE/ZIP；分发标志仍为 false。

## 实际阻碍，未冒充完成

官方文件目录与 SDK config 可读取。SDK 配置把 Vulkan-Loader 关联到 `vulkan-sdk-1.4.350.0`；[官方 API 说明](https://vulkan.lunarg.com/content/view/latest-sdk-version-api)支持版本固定的下载与校验查询。固定 ZIP 的 [公开下载地址](https://sdk.lunarg.com/sdk/download/1.4.350.0/windows/VulkanRT-X64-1.4.350.0-Components.zip) 返回 HTTP 403，正文 `error code: 1010`、Server cloudflare；没有绕过访问限制。

源码构建替代路线已核查 [固定版本构建说明](https://github.com/KhronosGroup/Vulkan-Loader/blob/vulkan-sdk-1.4.350.0/BUILD.md)，本机 `vswhere -products '*'` 返回空列表，PATH 亦无 CMake、cl 或 Ninja。没有擅自安装系统级 C++ 工具链，也没有拿 System32 DLL 顶替。

因此当前**尚无真实 Vulkan 二进制，尚无实际组装好的布局候选**。准备脚本的单测使用明确标注的合成 ZIP，只证明验证与提取规则，不能证明真实 DLL 可加载。路径组装代码没有接入播放器，避免未经实际候选验证就改动已经过 M4 的产品加载链路。

## 测试

- `python -m unittest tests.test_vulkan_prepare`：5 项通过。覆盖离线缺失、损坏 ZIP 保留、x86 拒绝、重复准备一致、不同已有 DLL 不覆盖。
- `node --test electron/test/render-distribution-audit.test.mjs electron/test/render-runtime-stage.test.mjs`：5 项通过。实际库存测试确认缺少真实 loader 时失败，并且没有新增假候选目录；其他为清单契约测试。
- `node --check scripts/stage-render-runtime.mjs`、`git diff --check` 通过。既有其他文件的换行提示不作为本批修复。
- 实际 `node scripts/stage-render-runtime.mjs` 因缺少真实 `build/vulkan-runtime-input/runtime/runtime.json` 失败，符合预期。不将这个失败写成实际运行成功。

## 后续处理

优先取得同一官方 ZIP；若用户可通过普通浏览器下载，可把原文件放在 `build/vulkan-runtime-input/VulkanRT-X64-1.4.350.0-Components.zip`，无须安装。离线准备通过后才能组装并核验真实候选，然后接入统一 resources/native-render 加载路径、进行实际 Electron 播放与缺失依赖验收。若下载持续受阻，应另行准备可复现的 C++ 构建环境与固定源码构建证据。

许可完整性、打包态和干净机器验收仍按第 25 批保持阻塞。关闭新渲染开关可继续使用现有播放器；本批只新增工具和材料，无产品回滚需要。
