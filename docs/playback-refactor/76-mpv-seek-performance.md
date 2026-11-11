# MPV 跳播审计与回归

## 范围

基线为 0.2.19 的 `f3f65db`。保留三条播放链路和原画策略。本轮改动针对 MPV，设置作用于当前播放会话，默认精确。没有发布流程变更。

## 架构、证据与风险

| 链路 | 源码证据 | 修改 |
| --- | --- | --- |
| MPV EXE | `mpvClient.ts` 使用 `time-pos` 和 `--hr-seek=yes`，由 restart 和落点读回确认。Electron 已在 ACK 窗口内合并请求。独立 Lua 左右按钮以旧播放钟计算目标，短时间重复点击有丢步风险。 | 保留精确路径和 TS 纠偏，增加关键帧选项。快速分支需要 seek 事件、restart 和实际非 seeking 状态，并报告实际落点。Lua 按待处理目标累计。 |
| 内嵌 D3D11 | `MpvEngine.ts` 等帧序号、代次和目标位置。宿主 `RenderHost.cs` 在 restart 后给纹理附 seek ID。主进程 `renderPlayer.ts` 在 GPU 回执后等待纹理释放和状态读回，原先还会重复读一次快照。 | ACK 前的连续输入仅派发最新待处理目标。快速帧需要 restart 后的帧代次和原 GPU 回执；前端仅接受同 ID、同目标的明确关键帧结果。复用完成确认时的新鲜快照。 |
| 播放控件 | `NativePlayerOverlay.tsx` 拖动松手才提交，本身没有在拖动期间逐帧解码。任何 pending 都立即展示定位提示。 | 保留单次提交和错误显示。定位状态持续 150 ms 才显示，实际缓存等待仍立即显示。提示变化不纳入性能数据。 |
| A/V、缓存及读取 | 两条路径都配置 `hwdec=auto-safe`。restart 包含音视频恢复，较早的 MPV seek 事件不能独立量出磁盘、解复用与解码各耗时。 | 记录实际硬解状态、MPV avsync、缓存暂停、纠偏和 start-file 次数。保留解码器、音轨和源打开逻辑。对照实验后，内嵌启用与 EXE 相同的内存包缓存上限。 |

MPV 文档说明精确跳播可能从前一个关键帧开始解码。快速模式落在关键帧边界。公开 restart 事件描述播放恢复，无法证明屏幕扫描输出。[MPV 手册](https://mpv.io/manual/stable/#list-of-input-commands) · [libmpv 事件定义](https://github.com/mpv-player/mpv/blob/master/include/mpv/client.h)

智能模式只参考同一个打开源、本次会话实际完成的远距离播放中跳播。两种策略各需至少三条记录，快速平均至少节省 30 ms 且耗时不超过精确的三分之二。保留最近四条每种策略记录，已观察到的关键帧误差超过 2 秒即回到精确。2 秒是决策门槛，不能保证下一次落点误差。暂停、短跳、首次使用及证据不足时使用精确。

## 测量口径

- `inputToDispatchMs` 是 Electron 控件提交到主进程派发，跨进程墙钟只有毫秒级。Lua 原生窗口单独记录处理函数入口到发送 seek 意图的耗时。该口径不包含 OS 输入队列或跨进程传输，不能直接与 Electron 控件的时间比较。
- `queueMs` 是主进程接收至命令派发；`seekEventMs` 是消费 MPV seek 事件的时间，不代表解复用已完成。`restartMs` 是消费播放恢复事件的时间，含解复用、解码和 A/V 恢复；不能据此拆出单独解码 CPU 时间。
- `frameMs` 是内嵌实际 WebGPU 工作完成的回执，`confirmationMs` 还包含资源释放、宿主 ACK 和状态读回。独立 MPV EXE 没有受信任的合成呈现回执，`frameMs=null`，独立报告使用事件加落点读回。
- `cacheWaitMs` 只统计已观测的 paused-for-cache，不等于磁盘读取延迟。OS、解码器和驱动缓存未清空；没有宣称冷缓存。单一当前源通过 MPV start-file 实测验证。A/V 时钟差是 MPV 自身观测，不代表音频设备和屏幕光学同步。
- 实际关键帧偏差、旧请求被取代和精确超时单独保留。生成素材和协议注入不等于用户真实片源或物理按键验收。

## 执行与回滚

```powershell
npm run build
npm run build:electron
node scripts/build-native-render.mjs
node electron/test/mpv-client.mjs
node --test electron/test/mpv-engine.test.mjs electron/test/independent-session.test.mjs electron/test/render-resume.test.mjs electron/test/render-seek-comparison.test.mjs
node electron/test/render-codec-seek.mjs Framecode-v2-3840x2160-hevc.mkv
node electron/test/mpv-seek-paired.mjs
```

通过真实 Electron 开发窗口运行，需要本机正常可用的 MPV 与 D3D11 环境。使用当前源码编译的宿主及已有完整性校验。主测试含 H.264 MP4、H.264 TS、4K HEVC MKV，暂停和播放中远跳、交替策略及连续相对跳播。通过 `AVHUB_MPV_LONG_GOP_TS=1` 复查长 GOP TS 压力路径。报告写入独立的 `build/mpv-seek-paired-*`。

行为回滚可在播放设置切回精确，模式仅作用于当前会话。源码回滚只撤销本轮跳播改动，并重建 Electron 前端、主进程和 D3D11 宿主。不能混用旧宿主与新源码清单。保留工作区其他修改。

## 实测

以下先列无缓存改造的初轮结果，再列最终配置。

- 基线 4K HEVC MKV 像素帧码，40 次精确跳播，中位数 50.3 ms、P95 66.0 ms。改动后同测试中位数 45.7 ms、P95 67.0 ms。两次均退出码 0；单轮对照未显示 P95 改善。报告为 `render-codec-seek-W80ln9`、`render-codec-seek-hB2k9r`。
- 配对矩阵 `mpv-seek-paired-ZXyH6E` 退出码 0。每格 12 次，暂停和播放各 6 次，全部在同一文件内跳播，媒体 SHA256 保持一致。以下是命令排队至状态完成的毫秒中位数，独立路径和内嵌路径的完成证据不同。

| 链路与样本 | 精确 暂停 / 播放 | 关键帧 暂停 / 播放 | 关键帧最大误差 |
| --- | ---: | ---: | ---: |
| D3D11 MP4 H.264，8 秒 GOP | 101.1 / 89.4 | 37.1 / 249.6 | 7.40 秒 |
| D3D11 TS H.264，2 秒 GOP | 481.7 / 474.6 | 255.4 / 254.7 | 0.69 秒 |
| D3D11 MKV 4K HEVC | 230.9 / 234.9 | 231.2 / 241.9 | 1.36 秒 |
| EXE MP4 H.264，8 秒 GOP | 76.5 / 89.6 | 2.8 / 20.8 | 7.40 秒 |
| EXE TS H.264，2 秒 GOP | 12.7 / 29.2 | 2.6 / 19.8 | 1.38 秒 |
| EXE MKV 4K HEVC | 14.1 / 20.2 | 4.3 / 26.5 | 1.40 秒 |

- 此轮矩阵观察到的硬解均为 `d3d11va`，未观察到 paused-for-cache 等待，MPV A/V 时钟差采样最大约 33.4 ms。内嵌长 HEVC 的主要等待已经发生在 restart 前，无音轨也能复现，因此不能单归因于音频。独立窗口现有真实应用回归 `native-independent-QfTblA` 退出码 0。
- 内嵌 8 秒 GOP TS 压力样本曾在请求 7.4 秒时落到约 8.921 秒，既有两次纠偏后仍未满足精确标准，UI 正确报超时。保留 `mpv-seek-paired-jHYUkV` 失败报告，退出码 1。常用短 GOP TS 已验证。这是生成样本上的实际失败，不能外推为所有 TS。
- PotPlayer 同文件同输出的端到端配对、物理扫描输出时间、真实素材的广覆盖和带硬盘冷缓存的 I/O 分解本轮未验证。

### 最终配置与缓存对照

缓存试验采用 `cache=yes`、96 MiB 前向与 32 MiB 回退的 MPV 包缓存设置，和独立 EXE 一致。属于单会话内存包缓存，非应用落盘缓存。这两个值是 MPV 的包缓存参数，不能作为整个宿主进程内存上限。无全局 OS 缓存清空、无硬件加速切换。

- 短 GOP TS 内嵌精确跳播中位数 477.1 → 223.8 → 225.5 ms，对应无缓存改造、第一轮有界缓存试验、最终配置。P95 520.7 → 253.3 ms（首轮缓存对照）。长 GOP TS 最终精确中位数 89.4 ms，原失败目标也通过。保留未启用缓存时的失败证据，不宣称其他 TS 都能精确定位。
- 最终普通矩阵 `mpv-seek-paired-EVvWl1`、内嵌长 GOP TS `mpv-seek-paired-Z7aPLc` 均退出码 0。960 秒的 4K HEVC 样本远跳到 573.4 秒，两条链路均实际落在 573.4 秒。普通矩阵全部观察到 `d3d11va`、源加载次数 1、缓存暂停 0。MPV A/V 时钟差的观测峰值约 33.4 ms。
- 最终 4K HEVC 像素测试 `render-codec-seek-24K5SU` 退出码 0，40 次精确跳播中位数 46.8 ms、P95 65.5 ms。相对原基线是小幅波动范围；长 4K 样本仍可在 restart 前出现约 200 ms 的等待。
- 最终独立窗口既有交互回归 `native-independent-ceoz6V` 退出码 0。前端构建、Electron 主进程构建、宿主编译退出码均为 0。MPV Client 回归及 29 个 Node 合约退出码为 0。

| 最终链路与样本 | 精确 暂停 / 播放 | 关键帧 暂停 / 播放 | 最大关键帧偏差 |
| --- | ---: | ---: | ---: |
| D3D11 H.264 MP4 | 92.3 / 90.6 ms | 29.3 / 245.8 ms | 7.40 秒 |
| D3D11 H.264 TS | 223.9 / 227.8 ms | 247.7 / 251.5 ms | 1.35 秒 |
| D3D11 4K HEVC MKV | 229.3 / 251.1 ms | 244.7 / 244.2 ms | 1.36 秒 |
| EXE H.264 MP4 | 88.9 / 120.8 ms | 3.3 / 23.5 ms | 7.40 秒 |
| EXE H.264 TS | 23.4 / 27.7 ms | 3.0 / 21.2 ms | 1.38 秒 |
| EXE 4K HEVC MKV | 13.6 / 19.3 ms | 3.4 / 22.0 ms | 1.40 秒 |

### 发行同系 libmpv 本地复核

首次 HDR 回归误用了旧候选宿主，旧宿主缺少本轮实际 start-file 计数，测试按原断言失败，退出码 1（`hdr-real-media-69AlXE`）。测试入口已改为默认使用当前开发宿主，支持显式指定重新构建的候选。通过正式 staging 校验，`render-replayed-candidate-pfJYah` 使用本轮宿主和固定发行同系 libmpv。

真实 VP9 4K PQ 文件在该候选上双屏实测。125% 与 175% 屏均完成暂停跳至 5 秒，GPU 回执分别约 510 / 485 ms，restart 约 489 / 466 ms，D3D11 硬解保持，源只加载一次。75 秒测试通过，连续播放样本的解码与输出丢帧计数最大均为 0；播放中的一次跳回包含测试轮询约 907 ms。仍有可感知等待，主要发生在 GPU 回执之前。报告 `hdr-real-media-ZXkWRT`，保留原文件 SHA256 检查和真实合成截图。此测量不等于物理色彩、屏幕扫描或 PotPlayer 对照。

发行同系候选普通内嵌矩阵 `mpv-seek-paired-9FMcZe`、独立 Lua 实际关键帧控制 `mpv-seek-paired-1e49nm` 均退出码 0。Lua 记录处理器入口至派发标记约 0.005–0.006 ms，仅表示 Lua 处理开销。


后续默认模式持久化、智能模式冷启动和开发运行库统一见 [77-mpv-seek-settings-and-development.md](77-mpv-seek-settings-and-development.md)。本报告中的初版智能策略由该轮修订。
