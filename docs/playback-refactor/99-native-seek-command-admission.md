# 原生跳播命令准入：解除同步控制阻塞

2026-11-10。HEAD 保持 `f3f65dbc321b54541f09be6b1558fb9e4f5eab27` 及已有工作区修改，版本仍 0.2.19。最终桌面源码标识 `8945da59f68ac9fd`，原生宿主候选 `render-replayed-candidate-wgp7hX`。没有打包、提交、推送、创建标签或发布。所有 E:/downloads 原视频只读，索引为测试副本。

## 实际问题与证据

98 的逐次完成后再跳没有复现明显排队；新增连续输入模式后，在真实 Electron 的相同三个片源中捕获了最新目标被旧操作拖住的等待。

`electron/test/render-library-seek.mjs` 的 stress 模式每组通过应用进度条 input 处理器发送 12 个不同目标，间隔约 4 ms；每个视频 30 组，交替快速/精确，包含暂停/播放。目标来自确定性序列，原文件不变，最终完成要求最新 seekId 的真实 GPU 收据和实际落点。该密集输入是可执行压力场景，不冒充普通按键速度或物理键盘延迟。

旧宿主 WV657b：`build/render-library-seek-ebK0PQ/report.json` PASS / 0（功能通过但有性能问题）。快速定位在应用派发前的排队中位数：VP9 4K60 约 158 ms、HDR VP9 约 154 ms、AV1 8K 约 170 ms；8K 队列最慢约 380 ms。缓存等待为零，sourceLoads=1，硬件解码仍 d3d11va。

源码链路是 `RenderPlayer.seekDispatch` 等候 `RenderHostClient.control('seek')`，后者等待原生串行 Dispatch；`MpvCore.Cmd` 使用同步 mpv_command。在前一跳仍恢复时，该同步调用会占住控制线程及 stdin 请求处理，后面的 frame/ack 和最新跳播不能及时进入。RenderLoop 虽是另一条线程，共享表面仍依赖控制通道的释放回执。

这里已证明额外控制等待，不能把全部定位耗时归于磁盘或画质。相同精确目标的 GOP 解码仍是另一个成本，未被这项改造消除。

## 撤回的前端实验

曾在 MpvEngine 中对未完成定位的子帧间隔输入增加 16 ms 调度窗口，首跳立即发送，取消/退出/超时清理待发目标，普通 34 ms 按键重复不延迟。20 个受控合约通过，但真实对照 AY6Dnl 的 4K60 快速中位数约 227 ms，对比基线约 224 ms；部分最大值更差，不能作为提速交付。

该字段、计时器、取消分支及本轮四个实验测试已精确撤回。原有 MpvEngine 输入行为保留，不为了改善某一计时字段而增加前台延迟。AY6Dnl 功能 PASS / 0，但性能目标不成立，报告保留。

## 保留的实际改造

- `electron/native/render/MpvCore.cs` 绑定实际 `mpv_command_async`，新增受限调用封送；复制事件的 userdata/error，接收真实 COMMAND_REPLY。现有 DLL、解码及 Render API 未替换。
- `RenderHost.cs` 只把 seek 命令改为异步提交。原生侧最多一个执行中的 seek 命令、一个最新待执行目标；新输入覆盖尚未提交的旧目标。收到执行回执并排空本批事件后，才提交最新目标，避免无界并行命令或任意乱序。
- 准入 ACK 不是定位完成：Frame 仍要求没有待提交目标、没有未确认命令、真实 SEEK/restart、相应 epoch、非 seeking 及原落点规则；Electron 仍等待实际 GPU 完成。
- 快速关键帧方向、末段真实精确回退、TS 有界纠偏、暂停字幕刷新、原始音视频同步和硬解选项保留。只同步变更 seek，不重写其他控制命令。
- 明确取消和 quiesce 清除待提交目标。当前异步命令执行错误进入真实失败状态；已被新目标取代的命令错误写入原生 stderr，不转嫁为新目标错误。待提交命令的注册异常也进入 NATIVE_SEEK_SUBMIT，不能在定时事件中无声丢失。
- `nativeQueueMs` 单独记录原生准入等待，新增实际提交/合并计数并通过受限诊断字段返回。主进程输入到实际 GPU 的总时间仍覆盖此等待，没有把时间移出总量或伪造完成。

MPV API 的异步回执和排序约束依据：[官方 client.h](https://raw.githubusercontent.com/mpv-player/mpv/master/include/mpv/client.h)。不直接无界替换全部命令；保留一个在途命令和真实回执顺序。

## 同目标真实对照

下表时间为同一密集输入场景的最后目标输入至真实 GPU 收据，取 `inputToDispatchMs + frameMs`，不同单调时钟阶段没有重复加 queueMs。输入时间基于毫秒时钟，含约 1 ms 量化误差。每源/模式 15 组，系统/驱动缓存不受控，不能推广成所有视频/所有输入均数倍提速。

| 片源/模式 | 原同步中位数 | 原生异步候选中位数 | 原同步最慢 | 原生异步候选最慢 |
| --- | ---: | ---: | ---: | ---: |
| VP9 4K60 快速 | 223.5 ms | 62.2 ms | 358.4 ms | 299.7 ms |
| VP9 PQ HDR 快速 | 200.6 ms | 64.2 ms | 224.4 ms | 89.9 ms |
| AV1 8K 快速 | 257.9 ms | 102.8 ms | 637.7 ms | 145.9 ms |
| VP9 4K60 精确 | 648.5 ms | 648.4 ms | 1029.9 ms | 1023.7 ms |
| VP9 PQ HDR 精确 | 491.7 ms | 492.4 ms | 780.0 ms | 790.0 ms |
| AV1 8K 精确 | 868.1 ms | 866.9 ms | 1806.8 ms | 1458.1 ms |

基线 ebK0PQ；初版异步 N7oX8L / sDUqqs，全部 90 组 PASS / 0。初版桌面 JS 标识与旧 JS 同为 175fb26bd7015045，宿主 SHA/候选不同，因此不能仅靠 JS build_id 混淆两次实现。后续只增加诊断、异步注册异常边界，最终宿主为 wgp7hX。

PdUbT5 / BwLova：再测 90 组，含每源 8 次定位中暂停/恢复，PASS / 0。实际合并旧目标分别 24、48、91 个；捕获的原生排队最慢约 24 / 21 / 35 ms。所有最终目标、状态和原文件检查通过。快速中位数约 61 / 70 / 121 ms；不是物理 scanout 或 HDR 显示色彩认证。

## 回归和未验证项

`render-async-api.mjs` 编译使用当前 MpvCore.cs 的独立 API 合约，加载哈希验证后的真实 libmpv，不模拟其回执：无媒体 seek 的异步错误 -12、后续合法 set 命令成功 0、无效命令注册被同步拒绝，userdata 对应 41/42。7cT0OS、最终 HPshMT 均 PASS / 0。该测试只证明真实 API/ABI 错误与恢复，不冒充桌面播放性能。已接入桌面串行 runner（增加一个步骤）。

MpvEngine 原有 16 合约 PASS / 0。前端、Electron、C# 编译、候选 staging/完整运行库核验 PASS / 0；DLL pin 仍 `ee574a3359daa225e63e858faf48e5c3c9be46ddcd552b6781b04992f89d5880`，没有弱化 sandbox/hash 校验。

最终 wgp7hX 源码/宿主验收：

| 验收 | 结果 / 退出码 | 报告 |
| --- | --- | --- |
| 八源 192 次快速/精确、暂停/播放定位，原文件一致 | PASS / 0 | render-library-seek-HhNS3P |
| 八个源均在精确定位尚未完成时返回媒体库，后续视频仍可打开 | PASS / 0 | 同上，pendingAtClose 全 true，约 216–870 ms 返回 |
| 4K HEVC 40 次实际像素码目标与快速末段真实回退 | PASS / 0 | render-codec-seek-qMinyD |
| 4K SDR10 像素定位及 3840×2160、16-bit PNG | PASS / 0 | render-app-flow-yKHPnC |
| 暂停 ASS 切换、动画/绘图及 20 次像素定位 | PASS / 0 | render-ass-seek-RpDIuQ |
| 首帧前用户意图 | PASS / 0 | render-app-startup-intent-SrS9hn |
| 受控真实 GPU 初始化错误，不假装成功 | PASS / 0 | render-gpu-init-failure-6Bpgkr |
| Chromium、独立 MPV、内嵌 libmpv 切换 | PASS / 0 | playback-path-cycle-HCmCPy |
| 最终三源每源 10 组连续输入、定位中暂停/恢复及定位中退出 | PASS / 0 | render-library-seek-VwsbHo |
| 基础串行回归 9 步、脚本语法与 diff --check | PASS / 0 | playback-regression-c26NRc |

VwsbHo 最终原生准入等待最大约 22 / 34 / 45 ms，实际合并过时目标 4 / 14 / 28 个，所有最终目标和关闭前正在定位断言通过。它加入了暂停/退出，不与 ebK0PQ 的不含该操作序列混作严格性能配对；配对表仍标明使用 sDUqqs。

完整 19 步 `--desktop` runner 本轮未整体重跑；本轮在磁盘有限的情况下执行上述有针对性的真实 Electron 验收和完整基础套件，不能冒称 19 步整体 PASS。Python/SQLite 未再修改，未借用 97 的后端测试作为本轮新运行记录。

精确长 GOP 解码、外机、物理 HDR 色彩、既有偶发后端启动超时，不因本轮异步控制改造自动变为已解决。真实 HDR 文件通过控件/跳播也不能替代实体色彩验收。没有伪造 scanout、关闭硬解、降画质、静默转码、跳过错误或延长原有超时来通过测试。

回滚应恢复本轮 C# 的 CmdAsync/单槽目标逻辑与本轮新增诊断字段，按原流程重编译并 staging 宿主；不要将新源码搭配旧 hash manifest，也不要覆盖前面 76–98 的修复。无媒体或 schema 迁移。
