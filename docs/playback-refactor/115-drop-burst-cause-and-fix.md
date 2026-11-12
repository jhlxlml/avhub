# 丢帧增长区间的定位与修复

2026-11-12，延续 114。保留所有已有修改与用户文件。应用源码构建 `df38ffeb01e51f70`、原生宿主 `render-replayed-candidate-8WuV8I`，未打包、升版本、提交或发布；诊断期间不并行运行其他 GPU 测试。

## 从旧证据缩小范围

114 的原始采样在流程 1007.18–1017.21 秒间，原视频从 430.614s 播放到 440.607s，输出计数 0→44，GPU 序号从 53686 到 54241。源时钟仍前进，不能仅用时钟判断实际交付流畅。此区间来自 seek15、目标 381.2s、关键帧实际落点 380.43s 后的正常播放，并非新的 seek 正在等待。

旧报告只有 10 秒间隔和资源值，不能分辨主线程、宿主、GPU 交付或资源采样耗时，因此不直接修改播放参数。

## 有界记录器

新增测试专用 `frame-delivery-recorder.cjs`，在同一个主进程 performance 时钟上记录 frame/snapshot/ack/control/resources、GPU present 和同步 app.getAppMetrics 调用。50ms 定时器只记录大于 20ms 的主事件循环延迟，不新增原生查询或 GPU 读取。

固定 2048 条滚动记录、最多 4 个增长区间，每次保留历史及最多 1 秒后续；更大增长替换较小增长，避免长测早期的小波动占满预算。后续记录也有容量上限和截断标记。提示、时钟或计数均不冒充物理 scanout。数据在确认暂停后导出，避免 111 的大数组导出干扰。

`AVHUB_TEST_DELIVERY_RECORDER=1` 才安装到自有真实 Electron 测试进程，生产默认代码不加载这些 hooks。复用原有并发 soak、共享媒体池和只读原视频。

记录器契约 4 PASS / 0：环形顺序、预算、停止后不再写、优先大增长、不完整尾部和缺失计数。短测 `render-concurrent-soak-Lg6bZU` 90 秒 PASS / 0，未触发丢帧增长；15842 条调用经过固定容量记录，没有保留无界历史。app.getAppMetrics 最慢 0.683ms、resources 最慢 4.54ms，不能据此把它们判为根因。

## 排除未经证明的假设

只读电源查询显示本机接电后的关闭显示超时为 10800 秒（3 小时），大于本轮 20 分钟；`powercfg /requests` 因 Windows 管理员权限不足未得到结果，没有修改系统电源设置。未将系统休眠认定为这次突增原因，也未加入没有证据关联的电源行为修改。

Electron 官方 [powerSaveBlocker 文档](https://www.electronjs.org/docs/latest/api/power-save-blocker) 说明显示保持唤醒属于独立功能；这不构成其缺失就是本次丢帧原因的证据。

## 长窗口结果与修复

按实际捕获补充，不将测试准备或短测通过写成根因已经解决。


### 已捕获的真实长等待

- `render-concurrent-soak-owVPqi`：20 分钟 PASS / 0，输出计数增长下界 104、解码计数 0。两次明显突增周围存在 230ms frame RPC、507ms present 等待及主事件循环延后；资源查询最慢 5.283ms、app metrics 0.730ms，不能归因为资源采样。
- `render-concurrent-soak-jlSdZB`：固定回到同一原视频片段，180 秒 PASS / 0、未观察到增长；不能将原片该处判为损坏。纹理导入最慢 0.502ms、发送 5.245ms。
- `render-concurrent-soak-voHH3f`：720 秒、真实播放/扫描/封面并发，PASS / 0（资源/生命周期），输出增长下界 62、解码 0。加入 10ms 采样间隔的主进程 CPU profile；它是诊断运行，不能直接代替无仪器性能验收。

voHH3f 的最大增长区间（同一主进程 performance 时钟）：frame RPC 在 238313.397ms 开始、225.994ms 返回；随后 present 在 238539.396ms 开始。GPU 回执在 238544.321ms（约 4.93ms），而真实 allReferencesReleased 在 239040.582ms（又过约 496.26ms），ACK 随后才发送。这段主进程采样几乎均为 idle，未见长 GC；纹理导入 0.054ms、发送 0.765ms。CPU profile 锚点映射存在约 ±10.3ms 不确定度，不能用于逐毫秒因果判定；但不支持“长 JS 或 GC 占满主线程”的假设。Electron 的 ELU 在本环境返回零，未用它证明空闲。

20 秒最小化对照 `XqUj1X` / `5K26lh` 均约 60 GPU 回执/秒，关闭 backgroundThrottling 没有改善证据；未修改生产窗口的该设置。

### 有证据约束的候选修复

`renderPlayer.ts` 增加 `AVHUB_RENDER_NODE_PULSE=1` 试验：仅在已有取帧任务等待真实 frame/GPU/引用释放/ACK 时保留 referenced 16ms Node 定时器，任务 finally 清理。它不读取额外视频数据，不增加并发帧任务，不提前 ACK，不合成 GPU 或释放回执。目的为避免 Node/Electron 在等待 native callback 时的空闲唤醒长延迟；需要真实 A/B 结果决定是否采用。

候选构建 `bc3542cdbaa3fbbd`。生命周期契约 1 PASS / 0：等待中没有提前 present/ACK，关闭后释放 pulse；带开关的失败分类契约 3 PASS / 0：首帧超时、GPU 失败、命令超时与解码错误仍可见，进程正常退出。记录器契约 4 PASS / 0。


### 候选被否决，不扩大启用

`render-concurrent-soak-46i7Lq` 的 720035ms 运行 PASS / 0（功能、资源、退出），但性能候选 **FAIL**：输出计数增长下界 79，对照 voHH3f 是 62；解码均 0，流程均 64 次采样、11 次跳播。present 最慢 367.585ms、ACK 290.718ms、snapshot 291.249ms、事件循环延后 278.003ms，问题仍在。最大突增实际集中在主时钟约 55–57 秒，后续稀疏采样为零，不能据“后半段正常”声称解决。此前进度描述把长测完整结果理解为后段增长不准确，以原始时间线为准。

已移除 production pulse 修改和对应临时契约，不保留无收益的计时器；ready 通知仍为之前默认关闭的试验。原始报告未修改；哈希、数据及否决原因写在 `build/iteration-115-pulse-rejection.json`。这轮没有证明系统唤醒是唯一根因，也没有通过提前 ACK 或跳过 allReferencesReleased 获得虚假改善。

### 已修复的确定缺陷：GPU 完成后的无限释放等待

源码核查发现 `renderTexture.ts` 原来仅给 GPU receipt 设 5 秒超时；GPU 已回执会清掉该计时器，随后 `Promise.all([receipt,resource])` 对引用释放没有期限。如果 Chromium 释放回调缺失，这段等待可永久挂起。修复为真实资源释放也设 5 秒失败期限，finally 清掉计时器。超时不会删资源、伪造释放、关闭 NT lease 或发送 ACK；仍保留 drain 的占用保护。

`renderPlayer.ts` 区分 `texture-release-timeout`，页面明确显示纹理释放超时并暂停输出。没有静默切换引擎、降质、转码、关闭硬件加速或关闭 sandbox。超时是实际错误路径修复，不是数百毫秒性能问题已经解决。

新增真实桌面 `render-release-timeout.mjs`：截留已经由 Electron 发出的真实释放回调；实际 GPU 完成一次后验证约 6.018 秒（包含打开开销）进入明确错误，imports=1、released=0、closedLeases=0、GPUcompletions=1、native ACK=0；重新交付真实回调后关闭，再打开成功，两次关闭均 imports/releases 与 leases/closedLeases 平衡，宿主退出且源租约释放。`render-release-timeout-NcCNy2` PASS / 0。此为受控故障验收，不是自然驱动故障或物理 scanout 证明。

正常路径与回归结果见下。下一步应进一步区分 Electron 主消息循环、跨进程 callback 调度与宿主 GPU 等待的跨进程时间线；目前证据不足以安全更改纹理复用/ACK 协议。未对该持续性性能问题宣称完成。


### 最终源码回归

最终构建 `474c072471ba0d90`，`npm run build`、`npm run build:electron` PASS / 0。输出错误分类/通知/计数/记录器契约共 19 PASS / 0。完整真实 Electron 串行回归 `playback-regression-OliCg5` 共 **27 PASS / 0、无 SKIP、无未运行项**，包括新增释放回调超时故障、GPU 初始化故障、启动、播放意图、恢复、独立 MPV、三路径循环与 seek matrix。所有测试使用自有隔离资料及共享媒体池，真实原片只读。

本轮没有打包、版本变化、提交、推送、标签或 Release。未做新的 HDR/多屏/外机验收，不沿用旧报告宣称本轮已通过。保留用户 AGENTS.md 与架构方案文档及其他未提交修改。


最终默认通知关闭路径 `render-frame-cadence-ZqkZ8w`：原始只读 4K60 MKV、60 秒，PASS / 0，实际 3597 GPU 回执（约59.95/s，显式门槛57/s）；GPU回执间隔 P95/max=22.727/29.044ms，frameRPC max8.421ms、present max10.702ms，292次原生计数采样输出/解码增长下界均0。sourceLoads=1、d3d11va、源文件身份校验通过。这只排除本次60秒正常路径退化，不证明偶发长等待已经消失。diff/syntax检查 PASS / 0。
