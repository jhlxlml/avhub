# M2 后续：libmpv、Render API 与共享纹理实测

> 本文件为第一轮共享纹理 PoC 的记录。后续已完成原始尺寸、像素帧编号、4K HEVC/AV1
> 及资源重复测试，详见 [M2 原始尺寸与目标帧报告](04-original-size-and-frame-accuracy.md)。
> 下文“仅固定640×360”等是当轮限制，不能替代后续结果；完整 M2 仍未放行。

2026-10-25。**缺少 DLL 的阻碍已解决；本机核心 PoC 已通过，完整 M2 门槛尚未放行，M3–M5 未开始。**
用户已允许按需替换现有库；本轮实际证明新链路可行后，仍将它留在隔离 PoC 中，未改变现有
播放器运行库、引擎偏好、UI 或原画策略。没有 Cinema OS、正式版本升级、上传或远程推送。

## 依赖补齐

先下载并校验 MPV 官方 v0.41.0 MSVC 归档，SHA-256
`4e197f729f5071c6772f35fffd96e0f36e3e8a044bd9479b136bb09b7c6a80ff`，
其中只有 EXE、PDB、Vulkan loader 等，确无 libmpv。

随后选择 MPV 官网列出的第三方 zhongfly 固定构建，而非跟随 latest：

| 输入 | 绑定证据 |
|---|---|
| 发布标签 | `2026-10-14-7c4f662c08` |
| 完整 MPV 提交 | `7c4f662c088d55fdb4f7049e9226de061ecad8c5`；与现有开发 EXE 相同 |
| 归档 | `mpv-dev-x86_64-20261014-git-7c4f662c08.7z`，32,789,318 字节 |
| 归档 SHA-256 | `c88b6c9cc368495dc4f8d66fec3b10f720d8a2bd6d7aa5d857bdda218393d174`，与发布资产元数据一致 |
| libmpv DLL | 121,889,792 字节，约116.2 MiB；SHA-256 `13c9ea4260760058f506df2fd4bfe5fa82db14a9d1be4131acb35648141bf8a3` |
| 实际 API / 版本 | client API 2.5 / `mpv v0.41.0-1174-g7c4f662c0` |
| 平台和许可 | Windows x64，GPL 构建；许可/版权文本已保存，传递依赖材料仍待审查，分发状态仍 false |

来源、构建记录与全部六个文件的摘要见 `ci/libmpv-render-candidate.json`，许可来源见
`third_party/libmpv-render/README.md`。没有下载或执行上游构建脚本，没有安装系统级编译器。
宿主使用本机已有的 Framework C# 编译器构建，不依赖 Electron ABI addon。

`scripts/prepare-libmpv-render.py` 提供固定来源下载、离线校验、所有文件逐个摘要验证、
路径/目录重定向防护、未知 DLL 拒绝、空间检查、分阶段解压和无覆盖发布。首次手动解压
保留于 `runtime-initial/`，之后通过脚本从归档重新准备完整目录，实际解压验证通过。
已有输入不匹配时拒绝覆盖；不写入 `bin/mpv`。

## 两条真实尝试与选择

### 原生 WGL 子窗口：未选用

使用真实 `mpv_render_context_create/render`、独立 GL 渲染线程和普通控制线程。
实际可见的独立宿主、NVDEC 解码和 GL 像素均通过，但默认 Electron DirectComposition
下的原生子窗口未正确呈现。透明控件区域的实际 alpha 为零，GL 像素有内容，不能简单归因于 CSS。
最终默认路径复现见 `build/libmpv-render-spike/evidence-X0oFm5/acceptance.json`。

独立诊断 `evidence-uJJUbA/acceptance.json` 通过但明确
`embeddedAcceptancePassed=false`，没有把另一个窗口能播放当作嵌入成功。
关闭 DirectComposition 的诊断曾在普通窗口看到视频与菜单，但全屏采集未通过；部分桌面采集
受其他前台窗口影响，不据此归因为解码故障。后续加入前台检查，并删除了无关画面截图。
该诊断开关未写入主应用，也不是最终通过方案。

### Render API → GPU 共享纹理 → 同一 React 页面：核心 PoC 通过

```text
生成的 640×360 SDR H.264 原文件
  → libmpv / NVDEC
  → 独立渲染线程 OpenGL FBO
  → WGL_NV_DX_interop2 / D3D11 普通纹理
  → 一次 GPU CopyResource / 完成查询
  → NT 共享纹理句柄复制给可信 Electron 主进程
  → Electron sharedTexture / VideoFrame
  → 同一沙箱 renderer 的 canvas + React 控件
```

直接把 NT 共享纹理注册到 WGL 在本机失败；分离 GL 互操作纹理与导出纹理并在 GPU 内复制后通过。
GL 和 D3D11 选择匹配厂商的适配器；同厂商多适配器仍未覆盖，生产实现需用 LUID 精确匹配。
新方案没有可见视频子窗口或覆盖在应用上方的原生视频 popup，React 和视频在同一个
Electron 合成画面中；隐藏宿主只持有 GL 上下文。开始时保持透明、不激活，不弹出播放器界面。

播放链路不传输逐帧 PNG、JPEG、base64 视频或整帧 CPU 图像。初始少数帧读取一个诊断像素，
图像编码仅用于测试截图取证；这些取证操作不计为生产性能。
这里有 GPU 复制、完成等待和 canvas 合成，**不宣称零拷贝、性能提升或全面原画色彩认证**。

依赖的 [Electron sharedTexture](https://www.electronjs.org/docs/latest/api/shared-texture)
是实验 API；当前锁定的 Electron44.9.3 源码确实把该 API 放入沙箱 preload 白名单。
纹理生命周期遵循 `allReferencesReleased`：单个在途纹理，消费引用释放后才允许原生写入下一帧。
renderer 只取得 VideoFrame 与白名单控制；原始 NT 句柄留在可信进程，不提供任意文件/命令入口。
正常退出先等待在途引用，再关闭宿主；超时有明确错误，不能无限等待。

相关官方约束：[WGL NV_DX_interop2](https://registry.khronos.org/OpenGL/extensions/NV/WGL_NV_DX_interop2.txt)、
[DXGI CreateSharedHandle](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgiresource1-createsharedhandle)。

## 测试与原始证据

| 验证 | 结果/报告 |
|---|---|
| 依赖准备边界单测 | 10/10 PASS；`build/libmpv-render-spike/preparation-tests.log`；首次受 Windows 临时目录沙箱权限阻止，正常权限重跑通过 |
| 实际离线准备、完整性校验 | PASS；`fresh-preparation.log`，6 个文件；初始解压目录保留 |
| M1 契约回归 | 9/9 PASS；没有改变 Controller/HTML5 生产源码 |
| 原有 D3D11 HWND 路径 | PASS；`build/native-embedded-9kqOKU/acceptance.json`，正常 GPU/沙箱、实际桌面画面；无原文件变化 |
| 共享纹理开发态 | PASS；`evidence-9cighh/acceptance.json`；视频/菜单/暂停/四次 seek/全屏/最小化恢复/退出 |
| 原生进程异常注入 | PASS；`evidence-C8vhsw/acceptance.json`；终止宿主后 React 页面与菜单继续响应，并显示错误 |
| 最新 PoC 打包正常运行 | PASS；`evidence-L8u30w/acceptance.json`；实际 `app.isPackaged=true`，DLL/宿主从成品 resources/spike 载入 |
| 最新 PoC 打包故障注入 | PASS；`evidence-Go0xIk/acceptance.json`，界面保留、错误可见、进程清理和源摘要检查通过 |
| PoC TS/JS/C# | TSX 独立类型检查、Node语法检查、C#真实编译通过；`git diff --check` 无错误，仅既存行尾提示 |

上述 `evidence-*` 均位于 `build/libmpv-render-spike/`。正常/全屏/菜单/恢复 PNG 是实际
Electron GPU 合成画面，包含经共享纹理导入的视频；不把普通 DOM 可见性作为播放证明。
它们不是物理显示器扫描取证，肉眼、多屏与实际显示输出仍待补验。

本地 PoC 目录包：
`build/libmpv-render-spike/package-20261025T015251598Z/win-unpacked/AVHubRenderSpike.exe`。
这是独立 `avhub-render-api-spike`、版本0.0.0 的**测试程序**，不是 AVHub 版本变更或 Release。
`packaged-location.json` 绑定 EXE 摘要；正常与故障报告还绑定资源 DLL、样本路径和摘要。
生产 `package.json`、版本号、资源配置和 `bin/mpv` 均未因本轮而修改。未联网发布成品。

最新两份打包报告确认：`disable-direct-composition=false`、正常 D3D11 GPU、sandbox=true、
contextIsolation=true、nodeIntegration=false、源摘要不变、宿主随应用退出。

跳播记录等待原生位置与新增 Render API 绘制；尚未对 GPU 画面的目标 PTS 做逐帧校验，且有
测试轮询开销。因此不将这些耗时与 M0/M1 的 requestVideoFrameCallback 基准直接比较，不宣称
“跳播更快”。4 次 seek 也不是长期吞吐、真实长视频或并发性能验收。

## 复现

```powershell
python scripts/prepare-libmpv-render.py
$env:AVHUB_RENDER_SHARED_TEXTURE='1'
node electron/test/render-api/spike.mjs
$env:AVHUB_RENDER_INJECT_EXIT='1'
node electron/test/render-api/spike.mjs
Remove-Item Env:AVHUB_RENDER_INJECT_EXIT
# 仅本地 M2 目录 PoC，不调用产品 release 脚本
node electron/test/render-api/package.mjs
node electron/test/render-api/spike.mjs --packaged
Remove-Item Env:AVHUB_RENDER_SHARED_TEXTURE
```

准备有缓存时使用 `--offline`；校验使用 `--offline --verify-only`。默认不指定共享纹理
环境变量会保留原生子窗口失败复现路径，不应把该模式作为已选实现。
PoC 编译器、7-Zip、DLL 全部在准备/测试时校验，不要求安装新的系统 SDK。

## 未完成项与阶段决定

1. **真实原始尺寸与色彩/位深契约**：目前纹理严格限定640×360、8-bit SDR生成片，拒绝其他源，
   不对用户4K/HDR内容套用此固定表面。动态尺寸、旋转/PAR、RGBA16F/10-bit/HDR元数据和色准
   尚未验证；不能因此降低原片质量或启用色调映射。
2. **硬件和呈现矩阵**：仅 RTX4090、125%单屏；集显/AMD、混合GPU、100%/150%、多屏及设备丢失
   未验收，WGL扩展缺失时不能假装支持或切换有损处理。
3. **完整现有 UI/业务**：当前是独立 React 控件夹具，原有完整控件由旧 HWND 路径另行回归。
   尚未将共享纹理桥接到现有 Player、字幕/音轨、队列、持久化及统一 Engine，不能宣称正式 MPV 引擎已升级。
4. **长时间资源和性能**：当前5ms轮询、GPU完成等待与单纹理 backpressure 是 PoC 机制；需事件化、
   源 generation 与丢帧/显存/句柄/CPU长期测量后再定生产策略，不能直接复制为性能优化。
5. **分发材料**：这是可核验的固定开发构建而非稳定版；完整递归依赖源码/通知/构建材料未完成，
   不修改 `distributionReady=false`，不把私人 PoC 打包当作正式分发许可或完整应用成品验收。

阶段决定：**选择共享纹理作为继续验证的 A 方案，保留当前 B/HTML5 功能；完整 M2 暂不放行，
不提前执行 M3–M5。** 下一步先验证原始尺寸/色彩位深、目标帧准确性与资源上限，再补可用硬件
和实际显示验证，按明确支持范围重新评审 M2。物理多屏/其他 GPU 需相应设备，不能用模拟替代。

回滚：本轮新增均为 `ci/libmpv-render-candidate.json`、准备脚本/测试、`electron/test/render-api/`、
许可快照及文档；已有测试取证 helper 增加了可选目标/前台信息。生产播放链路没有改动，
不运行该 PoC 即不影响现有应用。不要用 git reset 清除先前工作区修改。

本轮文件清单：

| 文件 | 作用 |
|---|---|
| `ci/libmpv-render-candidate.json` | 固定 DLL、头文件、归档和来源 |
| `scripts/prepare-libmpv-render.py` / `tests/test_libmpv_render_prepare.py` | 依赖准备、安全边界测试 |
| `electron/test/render-api/RenderHost.cs` | libmpv控制/渲染线程、白名单命令与退出 |
| `electron/test/render-api/SharedSurface.cs` | GL/D3D11互操作、GPU复制、共享句柄和释放 |
| `electron/test/render-api/main.cjs` / `preload.cjs` / `controls.tsx` | 隔离Electron桥接、沙箱VideoFrame消费、React控件 |
| `electron/test/render-api/spike.mjs` / `package.mjs` | 实际运行、失败注入、本地私有打包验收 |
| `electron/test/native-visual-evidence.mjs` / `native-window-evidence.ps1` | 可选PoC目标与前台窗口元数据，不改原播放器 |
| `third_party/libmpv-render/` / 本报告及02报告追加说明 | 许可快照、来源和阶段证据 |
