# 播放通道去除自动显示查询与真实封面让路验收

2026-11-10，HEAD 仍为 `f3f65dbc321b54541f09be6b1558fb9e4f5eab27` 加保留的工作区修改，版本不变 0.2.19。本轮源码构建 `175fb26bd7015045`，原生候选仍为 WV657b；没有 native C# / DLL 修改、打包、提交或远程操作。

## 发现并直接修复的问题

`electron/src/renderPlayer.ts::pump` 在首帧 GPU 收据后，先发送 `client.display()` 再发送恢复播放请求。虽然 JavaScript 使用 fire-and-forget，`RenderHost.ReadInput` 仍逐条等待原生 Dispatch 完成；因此 `DisplayProbe.Read` 的 DXGI 显卡/显示器枚举和 Windows 显示拓扑查询会阻挡后面的 play、frame、seek。该查询只用于日志，既不是媒体色彩解释的依据，也不是开始播放的必要条件。

旧源码真实报告 `render-startup-profile-QPnSNp` 的三次显示查询约 6.24 / 6.56 / 6.15 ms，对应 play 命令 ACK 约 6.44 / 6.90 / 6.39 ms。请求发生在同一时刻并按原生串行通道处理，确认 play 被诊断工作拖后。这不是对秒级异常的复现；显示驱动查询在其他环境的最慢值尚无本轮证据。

现已删除播放时的自动 `display()` 调用，不挪到另一个仍会阻塞 seek 的时间点。保留 `RenderHostClient.display()`、原生 `DisplayProbe` 和显式物理显示验收调用。没有删除显示诊断能力、假定 HDR 可用或改变色彩/渲染策略。

`electron/test/render-startup-profile.mjs` 新增断言：正常打开的调用序列不得自动包含 display；最后通过显式请求真实读取显示数据，证明按需能力仍在。

修复后 `render-startup-profile-FeFpeP/report.json` PASS / 0：三个 play ACK 约 0.204 / 0.192 / 0.196 ms；自动查询为 0，显式查询成功并返回 2 个输出。三次首帧约 629 / 397 / 401 ms，旧报告约 621 / 404 / 404 ms，不能称为整体首帧显著提速。收益是消除非必要诊断对播放命令的前置依赖。取消打开后重新打开、源加载次数、宿主退出/GPU 读者释放也通过原有断言。

## 97 的优先级修复增加真实工作验收

此前 CUlrjs / tAEgfd 验证租约及状态生命周期时暂停了封面工作线程，不能据此宣称真实封面已停止竞争。本轮扩展 `electron/test/render-library-seek.mjs` 的 priority 模式：

- 只读备份用户索引后，清空**测试副本**的旧 thumbnail_jobs，避免唤醒无关任务。
- 播放真实 VP9 4K60 MKV 后，在测试数据库排入该源的封面生成任务，并真正启用封面工作线程。
- 实际播放 24 秒以上后，要求 worker.paused=false、yielding=true、current=null，任务仍 pending。
- 暂停视频，要求租约释放、任务实际生成并发布，published 增加，任务变为 idle。
- 后续暂停跳播优先级、真实 GPU 完成后释放、退出释放仍保留原有断言；受控 GPU 门闩仍明确不是性能测量。

`render-library-seek-z0C3kd/report.json` PASS / 0：实际播放 24.274 秒，queuedCoverDeferred、queuedCoverPublishedAfterPause、pauseReleased、pausedSeekYielded、completedSeekReleased、closedReleased 均 true，原始文件哈希/大小/修改时间不变。封面仅写入该测试实例拥有的缓存。

这是实际任务准入/恢复的功能证据，不是“所有并发情况下跳播缩短多少”的延迟对照。没有终止前台解码、降低画质或用工作线程暂停设置冒充动态让路。

## 继续追踪长等待的实测

修改前，本轮原生 trace 开启的真实四源 `render-library-seek-ye8rFG/report.json` PASS / 0，96 次快速/精确、暂停/播放跳播。VP9 4K60 快速最慢约 327 ms，其中 seek event 9 ms、restart 307 ms、新帧 327 ms；缓存等待 0，无纠偏、sourceLoads=1。精确最慢约 802 ms。未记录 >=20 ms 的同步 property 或 seek command 阻塞，TS 有少量 20–49 ms 的 render 调用。

这批等待主要在播放核心重新启动解码之前，不是应用命令队列长时间积压；不因此断言全部视频或偶发秒级等待都只有解码原因。保留快速关键帧偏差、精确模式原有实际落点、硬件解码和新帧完成要求，不引入无证据的缓存/线程参数调整。

最终实际验收（均针对本轮源码，不借用旧成品）：

| 命令/报告 | 结果 | 退出码 | 范围 |
| --- | --- | --- | --- |
| npm run build / build:electron | PASS | 0 | 前端与桌面源码编译，既有 Vite 警告保留 |
| render-startup-profile FeFpeP | PASS | 0 | 三次正常打开、禁止自动显示查询、显式双输出查询、取消/重开、读者/宿主退出 |
| render-playback-intent --real-media，xvBGUn | PASS | 0 | 用户 HDR MKV，真实 Electron 控件、播放意图和跳播回归 |
| render-library-seek TA5EZ3 | PASS | 0 | 八个真实视频、192 次新帧确认跳播，所有源 SHA256/大小/修改时间不变 |
| render-app-flow RETUu3 | PASS | 0 | 4K SDR10 实际像素码定位，3840×2160、16-bit PNG |
| npm run test:playback，2Mmv5o | PASS | 0 | 9 步基础回归，包括 Client、发送队列、优先级、准备、shader 安全和引擎/会话合约 |

TA5EZ3 包含 VP9 4K60/PQ MKV、长 H.264 MP4/TS、H.264 MOV、HEVC MP4 和 AV1 4K/8K MP4。全部 sourceLoads=1、硬件解码与真实 GPU seekId/落点检查通过。各片源最快模式最慢值约 54–328 ms；精确模式最慢约 63–1064 ms，8K AV1 的精确定位仍有约 1 秒实际成本。没有用关键帧偏差冒充精确提速。

基础回归首次 OPUg8z 保留 FAIL / 1：沙箱禁止测试创建 Windows 目录联接，shader-cache 安全用例在 symlink 调用处 EPERM，未执行到缓存逻辑。未跳过或修改安全用例，在允许创建自有测试联接的执行环境重跑后 2Mmv5o 全部通过。不是生产缓存功能修复，也不记为产品运行故障。

此前 97 的 30 秒后端启动超时仍没有根因证明，本轮不宣布修复该异常。外机和物理 HDR 色彩效果没有新增验收；本轮 HDR 文件控件通过不能替代物理显示认证。

## 回滚范围

如需回滚，只恢复 RenderPlayer 首帧后的自动显示查询及相关新增断言；真实封面准入测试可独立保留。不要覆盖其余播放重构和用户文件。没有数据库 schema/媒体变更或画质迁移。
