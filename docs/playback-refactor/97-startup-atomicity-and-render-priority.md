# 2026-11-10：启动写入与内嵌播放优先级

## 范围与基线

HEAD 仍为 `f3f65dbc321b54541f09be6b1558fb9e4f5eab27`，保留既有未提交修改，版本保持 0.2.19。本轮实际修改源码；没有打包、提交、推送、创建标签或发布。原始媒体只读，测试使用自有数据目录或原媒体库的只读备份。原画、硬件解码、三条播放路径、真实 GPU 完成判定均保留。

96 中 `3CAVog / lAq8db` 的 backend-start 后 30 秒超时仍保留 FAIL / 1。本轮解决了可测的启动写入放大，但尚无该次超时的堆栈，不能宣称已证明其根因或保证不再出现。

## 1. 实际修复：建库/升级使用一个事务

`app/main.py::bootstrap` 原有多个安装器调用 `executescript`；Python 旧式事务行为使中间 DDL 被逐次提交。现在先在事务外设置 WAL，再在桌面使用的 Python 3.13 中设置 `autocommit=False`，原有 SQL 和安装器留在一个事务中，由既有连接边界提交或在失败时关闭回滚。

没有修改 `synchronous=FULL`、WAL checkpoint 策略、数据库字段或用户数据。Python 3.10/3.11 开发环境保留旧式安装行为，不在不支持该 API 的版本赋值；桌面固定 Python 3.13.11 使用新事务行为。

`scripts/benchmark-bootstrap.py` 使用相同 SQL/安装器，在自有空库交替运行六对测试。legacy-reference 只移除新事务模式，明确是源码参考实现，不能冒充旧 EXE 或冷盘对照。保持连接后解析实际 WAL 帧的提交标记，同时核对 integrity_check 和完全一致的 sqlite_schema。

`build/bootstrap-benchmark-jwtposxd/report.json`：PASS / 0。

| 指标 | legacy-reference | atomic |
| --- | ---: | ---: |
| 每次实际 WAL 提交标记 | 58 | 1 |
| WAL 字节 | 626272 | 222512 |
| 建库中位数 | 125.74 ms | 13.66 ms |
| 建库最慢值 | 140.91 ms | 14.54 ms |

这是建库阶段的真实 I/O 减少，不代表应用全部启动时间或视频首帧同比减少。`vn8fzu5g` 再次运行 PASS / 0，不将不同负载下的两次结果混为严格性能对照。

`tests/test_bootstrap_atomic.py` 四项 PASS / 0：新库失败无部分表；升级中新增字段/改写标题后失败可回滚，并保留收藏、进度、标签、片单；重开幂等及 FULL/WAL 不变；旧开发运行时分支可用。首次测试因测试连接未关闭导致 Windows 临时目录清理 WinError32，FAIL / 1；已在测试中显式 closing，保留此记录，不归因于生产迁移。

技术依据：[Python executescript 事务行为](https://docs.python.org/3.13/library/sqlite3.html#sqlite3.Cursor.executescript)、[SQLite WAL 帧结构](https://www.sqlite.org/fileformat2.html#wal_frame_header)。

## 2. 实际修复：内嵌 MPV 持续向后台工作申请让路

独立 MPV 已持续上报 activity；内嵌 `RenderPlayer` 原先只有获取源读取保护时的一次准备状态，没有播放期 activity 心跳，也未在后续暂停跳播时重新申请短期读取优先级。后台封面让路租约在 20 秒后失效，存在视频仍在播放而封面重新竞争读取/解码资源的具体缺口。

真实 Electron 复现 `render-library-seek-CUlrjs/report.json`：FAIL / 1。原 VP9 4K60 MKV 实际播放 24.925 秒、1494 帧后 yielding 从 true 变为 false。该测试暂停了封面工作线程，因此证明的是租约失效，不是已经量化了封面并发造成的跳播延迟。

`electron/src/renderPlayer.ts` 现在复用既有 `/api/playback/activity`：

- 每 3 秒异步续租；首帧前、跳播待完成、暂停/恢复、错误和关闭时同步更新语义。
- 每会话只保留一个在途请求与最新待发状态，不积压旧状态；失败有日志，后续心跳可恢复。
- API 上报不阻塞 seek 或 GPU present；跳播完成仍要求真实新帧，不能用 activity ACK 冒充。
- 暂停不再占用正常播放优先级；暂停跳播短期申请 preparing，完成后释放。
- 关闭先发释放状态，与原有保存/宿主关闭并行；最终仍保留 native-read 的硬源文件保护，直到原生退出和已有 GPU 排空流程完成才解除。

`electron/test/render-priority.test.mjs` 四项 PASS / 0，覆盖心跳续租、暂停/错误/跳播状态、慢 API 合并至最终关闭、失败恢复。已接入桌面串行回归及 CI 测试命令，没有关闭检查。

真实应用 `wIrcOv`、`tAEgfd` 两次 PASS / 0。后者实际播放 24.107 秒，超过租约期限后仍 yielding=true；暂停释放、暂停跳播读取优先级、真实完成后释放、关闭释放及原文件哈希不变全部通过。暂停跳播使用受控 GPU 门闩使状态可观测，明确标为 **生命周期验证，不是延迟提升证据**。本轮没有声称所有磁盘、片源和后台负载都已完成并发性能验收。

## 3. 启动分段定位，不掩盖等待

`app/startup_trace.py`、`run.py`、`app/main.py` 增加桌面会话启动阶段：Python 入口、固定 SQLite 就绪、Web 框架导入、schema、文件恢复、lifespan、WAL anchor、实际 health 完成。只记录阶段、耗时和 PID，不记录令牌或媒体路径。

桌面启动超过 10 秒自动把 Python 真实线程堆栈写入原有后端日志；实际 health 完成后取消，不延长原有窗口超时，不重试或虚报就绪，不启动第二个服务。迁移命令和非桌面导入不启用 watchdog。

`tests/test_startup_trace.py` 三项 PASS / 0，包括实际子进程等待 11 秒获得 faulthandler 堆栈、正常取消及非桌面不启用。该受控等待不是应用性能结果。

`node electron/test/backend-startup.mjs`：`build/backend-startup-GcxbVb/report.json` PASS / 0。最终构建 `8e0661f5fd7ab07c`，5 次空库和 3 次现有媒体库副本分别启动真实 Electron、验证 health、正常退出；保持原 30 秒 firstWindow 超时。进入界面约 850–1166 ms，后端 health 阶段约 501–764 ms，均无 watchdog 超时。不是系统冷启动或低概率故障已经消失的证明。

## 4. 整体验收与边界

- `npm run build`、`npm run build:electron`：PASS / 0。既有 Vite CommonJS 配置和大 chunk 警告保留，不当作播放失败。
- `npm run test:backend`：794 项，PASS / 0，2 项既有条件跳过，140.026 秒。包括新事务和真实 watchdog 测试。
- `npm run test:playback:desktop`：`build/playback-regression-GxsYdN/report.json` PASS / 0，18 个串行步骤，无未运行项。包括两个 MPV 路径、请求/状态合约、真实进度条输入、首帧前操作、受控 GPU 初始化失败、独立窗口重开/截图、三路径切换及双路径跳播矩阵。
- `render-library-seek-OryreE/report.json`：PASS / 0，四个真实片源共 96 次跳播，覆盖快速/精确、暂停/播放、近跳/远跳。每个源 SHA256/修改时间不变，所有 seek 的 sourceLoads=1、hwdec=d3d11va；实际新帧/GPU 完成和落点断言通过。
- 此次实际 GPU 首帧最慢值（快速 / 精确）：VP9 4K60 MKV 328.5 / 787.7 ms，VP9 PQ MKV 52.8 / 600.9 ms，长 H.264 TS 109.4 / 211.2 ms，AV1 4K MP4 76.0 / 492.3 ms。队列记录最大约 0.11 ms。与 96 的无后台负载跳播结果接近，不把新 activity 策略宣称为所有场景数倍提速；精确定位仍有真实解码成本。
- `render-app-flow-NUqItP/report.json`：PASS / 0，五个实际 4K SDR10 像素码落点一致，截图 3840×2160、16-bit PNG；不是物理 HDR 色彩认证。
- `git diff --check`：PASS / 0。测试结束后仅清理本轮两个已关闭测试实例中各 1510485230 字节的自建 HEVC 副本；先核对绝对路径、大小、非重解析点，保留原生成样本和全部报告，未删除用户媒体。

本轮未修改 native C#，仍使用源码对应的 `render-replayed-candidate-WV657b`；libmpv SHA256 `ee574a3359daa225e63e858faf48e5c3c9be46ddcd552b6781b04992f89d5880`。没有降精度截图、关闭硬件加速、跳过运行库校验或改变用户选定的快速/精确定位语义。精确定位的长 GOP 前置解码仍可能等待；本轮不以旧帧保留或隐藏缓冲提示冒充解决。

回滚仅限本轮事务模式、启动追踪导入/标记及 RenderPlayer activity 上报增量，同时移除对应新增测试入口；不要覆盖其他未提交播放改动。没有不可逆数据迁移或新 schema，原视频未写入。
