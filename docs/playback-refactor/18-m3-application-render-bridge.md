# M3 第二批：真实 AVHub 应用内 D3D11 播放链路

> 最新回退、队列、十五分钟应用验收及最后观察项见 [19](19-m3-handoff-queue-and-application-soak.md)。本页保留第二批历史结果。

2026-10-26。M2 按用户明确批准的单屏 SDR 范围放行；**M3 进行中，不标记整体通过，不进入 M4/M5**。
本报告接续 [第一批](17-m3-engine-and-native-host.md)，覆盖实际 AVHub Electron，而不是另开的 PoC 播放器。

## 已实现与文件清单

| 范围 | 文件 |
| --- | --- |
| 主进程会话、源保护、进度与轨道记忆、截图与字幕 | `electron/src/renderPlayer.ts`、`main.ts`、`nativeCapture.ts` |
| 共享纹理导入、真实 GPU 完成及引用释放确认、句柄所有权 | `electron/src/renderTexture.ts` |
| 隔离世界 WebGPU F16 接收端、画面变换与设备丢失报告 | `electron/src/preload.ts` |
| 原生显示资格核查、字幕外观 | `electron/native/render/DisplayProbe.cs`、`RenderHost.cs`、`renderHostClient.ts`、`scripts/build-native-render.mjs` |
| 统一引擎与既有 UI 的适配、会话/表面隔离 | `frontend/src/playback/renderDesktop.ts`、`MpvEngine.ts`、`PlaybackController.ts`、`EngineSelector.ts` |
| 复用控件、暂停意图交接、设置、类型和样式 | `NativePlayerLaunch.tsx`、`NativePlayerOverlay.tsx`、`NativePlayerSettings.tsx`、`Player.tsx`、`desktop.d.ts`、`native-player.css` |
| 源资格与默认关闭的试验项 | `app/native_playback.py`、`app/main.py`、`app/preferences.py` |
| 原尺寸高位深 PNG 接收校验 | `app/screenshots.py`、`tests/test_screenshots.py` |
| 真实 Electron 验收 | `electron/test/render-app-{flow,controls,faults}.mjs`、`render-fault-bootstrap.cjs` |

数据流为：媒体 ID → 主进程取得原文件 reader lease → 校验宿主/DLL/源码 → libmpv D3D11 原尺寸 RGBA16F →
Electron sharedTexture → 隔离 preload WebGPU F16 → 既有播放页。主进程等 GPU 完成与引用全部释放才 ack 原生纹理。
React 不接触原文件路径、GPU 句柄、VideoFrame 或 native 函数指针。renderer 重载先退役旧会话，防止旧事件影响新表面。
关闭依次保留截图、进度保存、GPU 读者、原生进程退出和源保护；失败可重试，不凭 UI 关闭提前释放文件租约。

默认仍为现有播放器。设置中的 **D3D11 原生嵌入（SDR 试验）** 默认关闭，仅开发态可开启；发行包拒绝此试验路径。
只接受已验证的单屏 SDR、BT.709、8/10-bit、原尺寸/预算内样本；HDR、多屏、未知色彩不自动降质。
原生宿主未降低视频分辨率或源位深，没有视频/音频转码；浏览器切换仍沿用现有原画保护策略。

## 实测中发现并修复

- SDR10 原生 PNG 带 `sBIT` 且为 RGB16；旧截图接收器只认 8-bit，造成保存失败。
  增加严格的 8/16-bit 行长度、`sBIT` 顺序/长度/范围与 CRC 校验；保留既有空间、像素数和流式解压上限，不重编码 PNG。
- 连续修改字幕字号、颜色和底色时，旧 UI 快照覆盖前一条未确认意图；改用最新意图并由真实状态确认。
- 控件刚显现时可能错过 mouseenter，或悬停在重试提示上仍隐藏；按真实控件区域及交互区域判断。
- 手动切换引擎仅保留进度、丢失暂停意图；现在双向保留暂停和位置，且不修改全局默认引擎。
- 旧 renderer/表面的状态和恢复操作可能与新会话交叉；按 surface、session、generation 隔离，重复旧关闭不影响当前媒体。
- 真实当前 WebGPU 设备丢失后，原生暂停成功但界面保留播放中快照；改为实际暂停后读取属性。
  错误状态拒绝继续发播放命令，避免画面失败后重新放出音频；恢复由显式重试或切换完成。

## 命令与结果

```powershell
npm run build
npm run build:electron
node --test electron/test/playback-engine.test.mjs electron/test/mpv-engine.test.mjs electron/test/render-api/cohort-evidence.test.cjs electron/test/render-api/runtime-attestation.test.cjs
npx playwright test tests/ui/native-player-controls.spec.ts tests/ui/native-launch-lifecycle.spec.ts tests/ui/native-runtime-settings.spec.ts --workers=1
python scripts/python-runtime.py scripts/test-backend.py
node electron/test/render-app-flow.mjs
node electron/test/render-app-flow.mjs Precision-SDR10-3840x2160.mkv
node electron/test/render-app-flow.mjs Framecode-v2-3840x2160-hevc.mkv
node electron/test/render-app-flow.mjs Framecode-v3-3840x2160-av1.mkv
node electron/test/render-app-controls.mjs
node electron/test/render-app-faults.mjs
node electron/test/native-app-flow.mjs
```

- 构建通过。Vite 既有配置加载方式及大 chunk 提示仍在。
- 接口和证据规则单测 **31 通过**，其中模拟 port 不算真实播放证明。
- 明确标记的浏览器 UI 组件 harness **34 通过**；不作为桌面解码/扫描输出验收。
- 后端 **688 项运行、0 失败/错误、1 跳过**（Windows 无 symlink 创建权限），报告 `build/backend-tests/normal.json`。
- 实际 AVHub 窗口只有一个。H.264、4K HEVC、4K AV1、4K SDR10：暂停后目标帧 31/52/109/128/10 的
  **compositor 截图像素码**逐项命中；不是只读取 time-pos，也不是隐藏缓存提示。
  精确目标通过真实进度条 DOM input handler 提交，因此不等于 OS 鼠标落点精度测试。
- 播放中 seek 后真实像素继续推进；Space 暂停/继续、滚轮缩放、还原、旋转、全屏/纯净播放与自动置顶通过。
- SDR10 截图为 **3840×2160、16-bit PNG**。这验证原尺寸/PNG 位深，不等于物理屏幕 10-bit 扫描或完整色彩校准。
- 实际 UI：双音轨、内嵌字幕、延迟、倍速、字幕外观、保存并恢复、下一视频、暂停双向引擎交接通过。
  使用静音的隔离测试配置；没有宣称主观音质、独占音频、设备切换或音画同步完整验收通过。
- 实际故障：页面重载、终止自有宿主、OS spawn 失败、真实 LoadLibrary 缺失 DLL、当前 GPUDevice.destroy、
  Windows 独占锁、损坏自有样本、删除自有样本均得到错误/恢复结果。DLL 失败由测试钩子把宿主参数指向自有缺失文件，
  没有移动或破坏固定 DLL；不是单测中伪造成功/错误消息。
- 故障结束逐条核查 helperAlive=false、sourceLeaseReleased=true、imports=released、leases=closedLeases。
- 旧路径 `native-app-flow.mjs` 回归通过；新开关未改变旧默认行为。

实际报告（均为本地生成内容，不上传用户视频）：

| 验收 | 报告 |
| --- | --- |
| H.264 应用像素/控件 | `build/render-app-flow-gg9Yub/report.json` |
| 4K SDR10 应用像素/16-bit PNG | `build/render-app-flow-nQy9HZ/report.json` |
| 4K HEVC 应用像素 | `build/render-app-flow-p24NE6/report.json` |
| 4K AV1 应用像素 | `build/render-app-flow-YbXKg8/report.json` |
| UI、恢复、暂停交接、旧会话隔离 | `build/render-app-controls-6iWN9s/report.json` |
| 完整故障矩阵及资源闭环 | `build/render-app-faults-Kb8nJM/report.json` |
| 旧应用路径 | `build/native-app-flow-704vLN/acceptance.json` |

原生辅助程序 SHA-256：`8bc8bf41bb5d0ea24f6d95c5657cbbd411386b8ab606a06f2b09ab2b25df5dd5`。
DLL SHA-256：`ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74`。
最终应用构建 `a6dc7fc4f4142b1e`；HEVC/AV1/完整故障/控件报告在该构建生成。
H.264/SDR10/旧路径报告在最后的设备错误状态保护修复前生成，保留原始时间与结果，未篡改为统一构建 cohort。
M2 的十五分钟闭环属于此前 PoC 构建，不能借用为新应用链路的长时通过。

失败证据继续保留，例如 `render-app-faults-ygMSjx`（真实设备丢失后暂停快照未同步），
`render-app-controls-dGSP06`（测试未先展开诊断区域），以及最初 sBIT 接收失败的报告。
组件测试曾因源码/构建指纹不一致失败；重新构建后复测，不移除版本保护或弱化断言。

## M3 剩余工作与下一步

1. 按计划完成最多一次、明确提示的原画回退策略；现在仅有显式手动切换，不声称自动回退已完成。
2. 新应用链路的快速切换/取消压力、自然结束连播、竖屏固定样本和音频输出回归；已有宿主单测不替代应用验收。
3. 补齐新链路长时资源和时钟验收。当前短时通过不能推出内存、显存、音画同步长期稳定。
4. 通过 M3 退出条件后才进入 M4：同片源、同构建的首帧/seek/丢帧/I/O 与旧链路对照，再决定性能或 auto 策略。

实体 HDR/多屏按用户授权继续范围外待办。M5 的再分发来源/许可证/打包态验收仍未完成；不开放正式包。

## 回退

关闭设置中的 D3D11 试验选项，再打开视频即恢复原 MPV 窗口路径；默认引擎选“现有播放器”恢复 Chromium 路径。
保留媒体库、进度、收藏、队列和目录权限；不需要改写原媒体。
本轮所有破坏性样本测试仅在新建 `build/render-app-faults-*` 内；未访问或修改 `E:\downloads`。
版本仍为 `0.2.16`，保留 M0 的 package、lock、README 和用户计划；未打包、提交、推送、打标签或发布。
