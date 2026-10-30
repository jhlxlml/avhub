# M3 第一批：引擎适配、原生宿主与源验证

> 后续实际应用接入与最新剩余项见 [18：应用内 D3D11 播放链路](18-m3-application-render-bridge.md)。下文是第一批历史结果。

2026-10-26。**M3 进行中，尚未整体完成。** M2 已按用户授权限定 SDR 放行，见 [16](16-current-cohort-and-sdr-gate.md)。
本批没有注册新的默认引擎，没有改变现有播放页布局，也没有以宿主单独测试代替应用内画面验收。

## 已实现

| 范围 | 文件与作用 |
| --- | --- |
| 统一适配器 | `frontend/src/playback/MpvEngine.ts`：实现既有 `PlaybackEngine`，单位为秒、音量 0–1 |
| 表面类型 | `types.ts` / `Html5Engine.ts`：区分原生表面和 HTMLVideoElement；不伪造 video DOM 属性 |
| 原生宿主 | `electron/native/render/{MpvCore,D3dSurface,RenderHost}.cs`：从 M2 验证路径整理的应用自有 D3D11 宿主 |
| 私有管道 | `electron/src/renderHostClient.ts`：受信主进程调用、进程所有权、协议边界和幂等关闭 |
| 源契约 | `app/native_playback.py` / `app/main.py`：`native-read` 显式 `render-d3d11` 分支，默认仍为 legacy |
| 编译 | `scripts/build-native-render.mjs`：仅编译辅助程序并记录源/宿主/DLL 哈希，不打包主应用 |

### 会话与取消

每次 load 使用递增 generation 和真实 session；旧媒体事件、旧 revision、旧命令完成均不能覆盖当前媒体。
取消打开会先让调用方得到取消结果，随后仍等待真实宿主会话返回并清理，不能提前释放源文件保护。
同一表面的并发初始化共享一个任务；dispose 会等待初始化完成后清理。关闭失败保留所有权，允许重试。

纯位置更新按 200ms 合并；暂停、错误、轨道变化和 seek 确认即时通知。
seek 不能仅凭命令成功或 `time-pos` 达标完成；适配器要求同一会话的新帧交接确认。
**GPU 呈现端尚未接入此适配器，所以不能把该接口单测算作应用画面已确认。**

### 宿主与精度

Render API 位于专用渲染线程；普通 libmpv 属性/命令位于控制线程。轨道列表使用真正的 `mpv_node` 类型读取，
不解析不可依赖的字符串表示。覆盖位置、时长、暂停、音量、静音、倍速、结束、轨道和错误。
MPV 的轨道 ID 按类型分别编号，必须同时验证类型和 ID。

固定使用原尺寸 D3D11 RGBA16F 共享纹理及 FP32 内部渲染，即使 8-bit 源也不另降成 RGBA8。
超出原尺寸预算、未知色彩、HDR、位深/尺寸变化时拒绝继续，不自动转码、缩小或映射到 SDR。
源尺寸、色彩和像素格式在发布新帧前检查。初始无内容清屏不计为解码首帧；纹理就绪与帧身份原子发布。
这部分仍需新链路的 Electron 像素验收，不能直接继承 M2 成品的逐帧结果。

停用配置文件、脚本、自动伴随文件、外部引用，并将 lavf 文件协议限制为本地 file。
这些 libmpv 选项的语义见 [官方说明](https://mpv.io/manual/master/#options-access-references)。
Render API ABI 以固定源码 `baa3e11d42cb7978da634a8a6a3a55fe074d01be` 对应头文件为准。

### 生命周期与安全

- 真实管道测试发现“暂停后重绘帧仍待释放”的关闭竞态。新增 quiesce：停止原生新帧、暂停音频、等待 GPU 读者回收，再退出。
- 已渲染纹理和尚未对外公布的帧身份在同一个锁内发布，避免新纹理匹配上一帧信息。
- 客户端要求调用方提供 reader drain。读者释放失败时保留宿主，不假称关闭，也拒绝继续播放；重试可完成关闭。
- 运行库哈希按 1MiB 块流式读取，避免每次打开将整份约 122MB DLL 留在 Node 缓冲区中；读取期间身份变化会失败。
- 并发 open 不会生成多个宿主；构建校验阶段取消不会再启动子进程；协议/管道异常退休整个宿主。
- 消息、队列、原生节点和输出大小均有上限。无 shell、任意命令或渲染进程路径接口。
- 新源请求仍要求受信桌面令牌、媒体 ID 和 reader lease。旧 native-read 默认分支及 SDR8 规则不变。
- 新源探测限 5 秒 / 32 包 / 2MiB 输出，核对流与解码首帧；未知不是 SDR。探测期间文件身份变化会拒绝打开。

## 验证记录

```powershell
node --test electron/test/mpv-engine.test.mjs electron/test/playback-engine.test.mjs electron/test/render-api/cohort-evidence.test.cjs electron/test/render-api/runtime-attestation.test.cjs
python scripts/python-runtime.py scripts/test-backend.py
npm run build
npm run build:electron
node electron/test/native-render-host.mjs
node electron/test/render-host-client.mjs <自建 native-render-host-* 夹>
node electron/test/native-render-matrix.mjs
node electron/test/native-app-flow.mjs
```

- 接口/证据规则单测 29 项通过；这些是模拟 port 和证据规则测试，不是原生播放证明。
- 后端完整 685 项通过，1 项按既有条件跳过；相关的源与运行库准备测试 26 项通过。
- 前端与 Electron 构建通过。Vite 原有配置加载方式及 HLS 大 chunk 提示仍在，不影响本轮结果。
- 真实 native host：两个音轨、内嵌/外挂字幕、延迟、暂停续播、倍速、音量、PNG 原尺寸截图通过。
- 真实应用管道客户端：退出、重复关闭、异常终止、缺失源、并发打开、加载前取消和 reader drain 失败后重试通过。
- 五种生成样本矩阵：H.264 MP4、4K HEVC、4K AV1、4K SDR10、4K 竖屏 SDR10；原尺寸和时钟定位通过。
  **该矩阵主动回收未导入的纹理，没有 Electron 消费者；不能声称像素准确或应用跳播已通过。**
- 既有 `native-app-flow.mjs` 在真实 AVHub Electron 中通过：暂停快进、进度条、继续播放、自然结束连播及返回媒体库。
  首次试跑在构建后又改源码而触发前后端指纹保护；重新构建一致后通过，不删除版本保护。
- 自建测试源前后哈希/mtime 一致。没有使用或修改用户视频。

最终三个原生报告绑定同一辅助程序 SHA-256：
`efa1b5e236d895db764994e860ffd9c35fd205ccd8b3daf55c388331b4b04cb4`。
对应 `build/native-render-host-Dxth5U/report.json`、`build/render-host-client-ozWCxn/report.json`、
`build/native-render-matrix-xXfidS/report.json`。最终应用构建为 `e4b305943f3932ff`，
旧路径应用验收保留在 `build/native-app-flow-vsSs2R/acceptance.json`。失败报告保留，不覆盖为成功。

## 仍需完成才能宣布 M3 通过

1. 正式主进程协调器将媒体 ID、现有 reader lease、宿主和 GPU 读者绑定到同一生命周期；公开 IPC 必须验证窗口及代次。
2. 正式 preload GPU 接收端和现有 React 播放 UI 接通；保留控件、截图、旋转/缩放、全屏/纯净播放与队列。
3. 接通现有进度/轨道/字幕偏好恢复与导航保护；最多一次有提示的原画回退，保持进度与播放意图。
4. 新路径在实际 AVHub Electron 内做固定样本像素、音频、快速切片和故障验收；不是单独 mpv 或 PoC 窗口。

在这些完成前，M3 不标记完成，不进入 M4/M5。物理 HDR/多屏继续是已批准的范围外待办。

## 回退与版本

本批新引擎没有接入选择器或主 preload，默认行为没有迁移；暂停使用新辅助程序即可保留原有播放器。
原有 `playbackControllerEnabled` 默认仍关闭。版本保持 `0.2.16`，没有正式打包、远程提交、推送或发布。
