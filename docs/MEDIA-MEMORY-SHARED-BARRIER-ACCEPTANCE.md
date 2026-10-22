# 播放记忆共享确认与有界重试

## 问题与实现

承接 `PARALLEL-PROGRESS-MEMORY-ACCEPTANCE.md`。先前暂停、返回、退出分别
调用 flushMediaPlaybackState()，会对同一失败项各发一次重试。原实现也只
等待调用瞬间的 pending 快照：期间排入的新写入可能仍未完成，确认却已返回。

本轮只调整前端播放记忆确认：

- 进行中的确认轮次共享一个 Promise，暂停/返回/退出不各自创建重试轮次。
- 每轮持续读取 pending，等待期间新提交的字幕、延迟或音轨修改仍被等待。
- 每个视频在一轮内最多自动重试一次，不因新的 failed 对象产生无限重试。
  新修改若也失败，保留最新失败状态并返回 false；下一轮保存确认或用户重试
  仍可重新尝试。这里不是禁止后续定时保存重试，也不是后台持续重试循环。
- 已完成轮次不能用作之后写入的确认；done 标记在 Promise 完成前设置，
  清理仅移除仍属于自身的记录，避免清掉较新的确认轮次。
- 源指纹/409 失效处理、同一视频实际编辑写入的顺序、时间戳与跨视频独立
  重试上限保持。没有合并或丢弃用户的真实编辑，仅合并重叠确认及其重试。
- 沿用上一轮独立进度与播放记忆的并行提交。记忆未保存时仍阻止返回、切片、
  退出，不能以进度先落库代替完整成功。

未修改后端、SQLite FULL/写队列、解码/GPU、分辨率、色彩或播放画质，没有
修改 E:\downloads 或历史网页归档，没有增加日常轮询或新的数据表。

## 定向证据

`electron/test/media-memory-barrier.test.mjs` 直接加载当前 TypeScript 模块，
仅替换 API 与事件环境，不复制保存算法，不作为性能测速。使用 Node 24 的
stripTypeScriptTypes，保留其实验性功能提示；每轮测试有 10 秒超时。

修复前两项针对性测试确实失败：重叠调用不共享确认，以及等待期间新增的
写入尚未完成时确认已经返回。修复后 7 项合约通过：

1. 暂停/返回/退出共享重试，显式重试仍有效。
2. 原写入等待期间新增的修改不会逃出屏障。
3. 重试期间新增的修改保留旧失败字段并按顺序落库。
4. 已完成的确认不被缓存给之后的写入。
5. 源冲突退役旧状态，旧字段不进入新源。
6. 重试上限按视频计算，不因一个视频用完额度便跳过其他视频。
7. 一轮内新修改也失败时停止自动重试，下一轮仍能保存最新值。

测试桩统一 Error 的执行环境，避免跨 VM 的 instanceof 差异误判 HTTP 409；
这不是应用的源冲突缺陷。新增测试已加入现有 CI 验证步骤，仅修改配置，
本轮没有推送、触发云端构建或发布。

## 组件及真实 Electron 验收

组件 harness：media-playback-memory、progress-save、shutdown、autoplay 共
24 项通过（约 1.2 分钟）。失败注入明确断言：正常记忆写入为 1 笔，失败与
重试路径为 3 笔，仍确认真实进度、字幕持久值、返回等待及失败后停留。
测试服务有既有 asyncio/WinError 10054 日志噪声，不能称日志全无异常。

真实桌面使用正常 Electron 窗口/GPU/sandbox/backgroundThrottling，600 个
隔离生成视频、真实 FFprobe 与封面任务。播放源为 H.264 SDR 320×180/12fps，
无声；不是用户高码率/4K/HDR 或物理屏幕验收。故障注入在性能阶段结束后运行，
通过真实字幕控件、实际成功响应和独立 API 读取核对数据库，不能把人为等待
纳入自然保存延迟。所有轮次与回归分开顺序执行。

最终产品构建为 2e34b29b541caf50，版本仍为 0.2.14。证据目录前缀为
`build/bulk-playback-avhub-bulk-playback-`，文件 acceptance.json。

| 后缀 | 首次扫描 ms | 首次四次暂停旧总计 ms | 增量扫描 ms | 增量暂停旧总计 ms | 返回 首次/增量 ms |
|---|---:|---|---:|---:|---|
| PdQgWK | 12794 | 28/20/17/22 | 104 | 29 | 122/106 |
| g6tLa6 | 13752 | 28/25/21/18 | 107 | 27 | 137/129 |

PdQgWK 中实际请求至响应头约 4.6–11.3ms，数据库 total 约 2.792–6.356ms。
后台提交最大 198.405ms；快的采样进度请求不能代表全部提交都快。旧总计含
测试命令、响应与持久状态复核，不是纯应用处理时间，也不能据此计算加速比例。

g6tLa6 请求至响应头约 5.4–13.2ms，数据库 total 约 2.963–10.742ms；全程
提交最大 218.968ms。首次扫描比 PdQgWK 慢约一秒，不声称扫描提速或长尾根治。
两轮首次实际帧增量均 131，增量为 12/11，无新增掉帧、waiting、stalled、
源重载。当前仍为系统报告 32Hz/scale=2 环境，不是高帧率流畅验收。

两轮均 completed/cleanExit/sourceUnchanged=true、errors 为空，私有 SQLite
verified=true、封面排空、退出无 WAL。按已有工具核对播放源与模板哈希、
全部生成副本大小/修改时间；不是对每个副本逐一作哈希。

中间一次 j20akH 不算完整通过：正常扫描/暂停阶段完成，但进入字幕控件时
点击超时，memoryBarriers 为空、completed=false。失败截图显示页面滚动后
控制区域不在合适可交互位置，旧工具只滚动隐藏栏后直接点击。修正工具为
将整个播放器置于视口、进入未变换热区、确认 controls-hidden 消失，再 hover
及正常 click；没有改产品隐藏策略、强制点击或穿透遮挡。g6tLa6 是修正后的
完整重测；保留 j20akH 原始失败记录，不计为第二次功能通过。

与上一轮同一故障场景对照：成功路径仍 1 笔；失败路径从 4 笔变为 3 笔
（原写入、共享的一次自动重试、后续显式重试）。这是减少一笔重复重试的
功能证据，不是宣称整体性能提高 25%。

## 后续状态

播放记忆重叠重试及等待中新修改保护已具备定向证据。历史 341–385ms 暂停
长等待仍未关闭，也不将此次去重当作它的根因修复。高帧率验证仍受到当前
系统报告 32Hz 桌面的限制；不据此改变全局 GPU 或转码策略。

最终验证：共享确认 7 项、已有时间线/帧工具 6 项共 13 项通过；Chromium
诊断合约通过；24 项组件回归通过；后端进度定向 9 项通过（1.296s），CI 配置
合约 8 项通过。前端/Electron 编译、git diff --check 通过，仅有既有 Vite、
Node 类型剥离实验性功能及 build-windows.ps1 LF/CRLF 提示。未宣称本轮重新
执行了完整后端全量回归。历史网页归档无修改。

```powershell
node --test --test-timeout=10000 electron/test/media-memory-barrier.test.mjs
npm run build
npm run build:electron
npx playwright test tests/ui/media-playback-memory.spec.ts tests/ui/progress-save.spec.ts tests/ui/shutdown.spec.ts tests/ui/autoplay.spec.ts
node electron/test/bulk-import-playback.mjs --videos=600 --label=shared-memory --readiness=off --search-checks --memory-barrier-checks
```

本轮不打包、不推送、不发布，不提升版本号。

后续暂停/返回分段采集及 17 轮真实 Electron 组合验收见
[暂停与返回阶段归因](PAUSE-RETURN-PHASE-ATTRIBUTION.md)。该后续验收没有复现
历史长尾，不能据此关闭该问题。
