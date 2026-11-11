# WebGPU 管线提前编译与首帧初始化

2026-11-09，版本保持 0.2.19，HEAD 为 f3f65dbc321b54541f09be6b1558fb9e4f5eab27，保留已有工作区修改。最终本轮构建 932a263a92727ce1，原生候选仍为 KhYHON；未打包、提交、推送或发布。

## 修改与实际计时

`preload.ts` 中 SDR、PQ、HLG 三个管线使用同一原有 shader 模块、入口、F16 target 与描述符，改为并行 `createRenderPipelineAsync`。准备仍在 attach 时开始，与宿主启动重叠。所有 shader 数学、色彩和采样参数均未改；实际帧仍须等待 `queue.onSubmittedWorkDone`，不提前报告 GPU 完成。

准备失败时清除 context 配置并销毁已申请的 device；缺少 canvas context 时也销毁设备，错误继续向实际播放链路传播。没有切为 8-bit、软件视频解码或有损播放。

同一只读指定 4K VP9 MKV 的真实 Electron 对照：

| 实现/报告 | 首次实际起播首帧 | 首次真实纹理传送至 GPU 完成 |
| --- | --- | --- |
| 同步管线 `render-startup-profile-BfkRC3` | 730.46 ms | 83.31 ms |
| 异步试验 `render-startup-profile-6fNeBn` | 619.06 ms | 14.53 ms |
| 补齐清理后 `render-startup-profile-8ketmj` | 613.00 ms | 13.44 ms |

后两次打开首帧分别约 423/443 ms、424/435 ms，后续 GPU 完成约 6–9 ms，没有把首次优势扩展为每次都减少 0.1 秒。记录是不同新建隔离数据目录下的同机进程级首次打开，未清 OS/驱动缓存；不是电脑冷启动保证。首次管线等待约减少 70 ms，而整体首次差值还含宿主及其他波动，不全归因于 GPU 编译。

## 失败初始化的真实清理路径

新增 `render-gpu-init-failure.mjs`：实际 Electron/native/GPU 运输，明确注入管线初始化 Promise 拒绝。不是实际显卡驱动故障，也不是性能对照。`render-gpu-init-failure-scIj0m/report.json` PASS / 0：失败 phase=error、firstFrameMs=null、gpuCompletions=0；device/context 各清理一次。恢复真实 WebGPU 函数后同一应用成功重开，实际 GPU 帧及播放时钟推进；最终两次关闭宿主退出、源文件租约和纹理引用释放通过。没有用受控故障结果冒充正常播放。

## 保留的独立 MPV 中断

首次完整回归 `playback-regression-OFAWf9` 在最后一项退出 1。`mpv-seek-paired-k50nah` 的独立 MPV、4K HEVC 连续相对输入时出现“播放器已断开”；native log 停在定位后的 playback restart。前面的 144 个配对样本已执行，但这不能使整套报告变成 PASS。未自动重试、放宽断言或移除失败报告。

此路径不使用本轮改动的 preload WebGPU 管线，但没有足够证据排除间接图形状态影响，不能仅凭模块不同断言无关。Windows Application 1000 查询未取得对应事件；失败时缺少退出码，不能据此排除原生崩溃。

针对独立路径 `mpv-seek-paired-zG32yI` PASS / 0，以及补充管道/退出监听后重现原先先内嵌后独立顺序的 `mpv-seek-paired-uEPXxr` PASS / 0，均未复现。后者三次独立进程都记录正常 pipe-close、OS exitCode=0。**一次中断原因仍未确定，不宣称已经修复。**

为让后续真实使用可诊断，`MpvClient` 新增结构化 transport 状态，记录管道错误码、关闭、实际 OS 退出码/信号，不保存源路径或原始 stderr。IndependentPlayer 在首次失败及关闭时写入 desktop.log，并加入复制诊断；兼容原 NativePlayer 的诊断也包含这些信息。未加重连或重新加载来掩盖故障。测试额外采集同类退出事件，只用于定位，不替代生产行为。

`native-startup-failure.mjs` 合约 PASS / 0，仍要求：有 PID 的 error 不是退出证明、停止超时保留占用、真正退出后才能清理；新退出诊断与实际证据一致。该项含受控进程事件，不是硬件验收。

## 最终验收

- `playback-regression-T9py7Y/report.json`：最终代码 15 步 PASS / 0，无 skipped/unrun。包括首帧前暂停、受控 GPU 初始化失败、三引擎切换与双 MPV 矩阵。它不覆盖或抹去原先 OFAWf9 的 FAIL / 1。
- `render-gpu-init-failure-c4wdyd`：最终代码受控初始化拒绝、device/context 各释放一次、恢复实际 API 后重开 PASS / 0。
- `mpv-independent-reopen-SP63Mw`：三格式正常关闭均记录 pipeClosed=true、exited=true、exitCode=0、signal=null，PASS / 0。
- `mpv-seek-paired-tpp4W7`：完整双路径与各模式矩阵 PASS / 0；附加退出事件可审计。
- `render-app-flow-abbqHL`：4K SDR10 实际像素定位、缓存损坏重建及重开、全屏/纯净播放 PASS / 0。请求帧码 31、实际 31；截图 3840×2160、16-bit PNG，源样本身份不变。
- `render-app-soak-e6YW7t`：生成的 4K HLG10 短验收 20 秒 PASS / 0，实际 compositor 帧码/墙钟比例 0.999998，9 个连续样本的解码/输出丢帧均为 0。不是实际母版 HLG 片源，不是长期稳定性或物理色彩认证。

真实 PQ HDR `hdr-real-media-IbQIw8`：PASS / 0。真实只读 VP9/PQ 片源，缓存关闭/重开后跨当前显示器检查，并持续测量 90.026 秒、含一次精确跳播。呈现序号推进 5,365，sourceLoads=1，最终与采样窗口观察到的解码/输出丢帧最大值均为 0；源 SHA256 与 mtime 不变。它是实际 compositor/原生播放验收，不是物理色彩准确性认证。

后续截图位深专项修复的构建另见文档 93；不把本轮 932a263a92727ce1 的完整入口结果冒充那个后续构建的新成品发布验收。历史成品报告不代表本构建；一次未解释中断始终保留为未解决项。

回滚 GPU 优化时只将三条管线构造恢复同步 API，保留色彩/descriptor 和真实 GPU 回执。保留初始化失败清理及 transport 诊断不影响原画播放；不要整体还原 preload 或 MPV Client，避免撤销此前缓存、暂停与 seek 修复。
