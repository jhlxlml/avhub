# 扫描核对去写锁与慢提交归因

延续 [多结果搜索和提交长尾](BOUNDED-SEARCH-AND-WRITE-TAIL-ACCEPTANCE.md)。本轮继续
开发迭代，版本不变；不打包、推送或发布。所有数据库与媒体验收样本均自行创建，
未打开日常媒体库，也未访问 `E:\downloads`。播放器、原画策略和转码权限未改动。

## 修复：无变化的目录核对不再进入写队列

扫描完成一个根目录后，原实现用 connection()/串行写锁遍历该根目录所有媒体，
计算缺失状态差异；即使没有任何变化，也持有写锁到遍历结束并调用 commit。
这不是媒体探测或视频解码，但会让进度保存与其他写入等待。

本轮将其提取为 reconcile_scan_presence：

- 保留完整遍历、无目录读取错误、根目录仍在线和原取消检查等前置条件。
- 在只读快照连接中遍历并计算实际差异。没有差异直接返回，不占串行写锁，
  不执行写入或调用写连接的 commit。
- 存在差异时才申请原写队列，在同一事务内更新。每行重新匹配 id、root_id、
  path、旧 missing、source_identity、size、modified 和 normal 文件状态。
  不覆盖快照之后发生的移动、回收、源替换或其他缺失状态变化。
- 只改 missing，不改用户标题、标签、收藏、进度、时间戳或源视频。写入失败
  保持整批回滚，不把后台状态更新拆成异步成功确认。

这项改动消除的是不必要的写锁，而不是承诺目录核对计算本身总是更快。
源信息条件增加了少量读取/比较；大量真实缺失变化仍是单事务，尚未改成分批提交。
没有更改扫描线程数、FULL、默认自动检查点或保存优先队列。

## 改进：按固定操作分类保留提交证据

诊断新增 operation_lifetime：7 个代码内固定操作加 unlabelled，区分 read/
serialized，共最多 16 组。标签不来自文件名、路径、请求 URL 或 SQL 文本。

分类包括 schema-bootstrap、scan-media、scan-reconcile、scan-checkpoint、
cover-queue、cover-publish、progress-save。每组保留全程次数、慢操作数、各阶段
累计/最大毫秒及最差 commit 的关联连接 ID；不会被后续快速请求挤出滚动窗口。
报告复制嵌套字段，外部读取不能修改内部证据。

写连接另记录 commit_attempted、transaction_open_at_commit、changed_rows 和
transaction_outcome。changed_rows 是本连接在提交尝试前的 SQLite total_changes，
不是成功落库证明；故障回滚的进度也可能有非零计数。事务体提前失败的行变化
不在此计数中。HTTP 保存确认仍只在实际提交成功后返回。

executescript 中的初始化 DDL 可能已在函数体内提交，因而 schema-bootstrap
的 transaction 耗时不能简单称为业务 SQL CPU 时间，commit=0 也不表示初始化
没有 I/O。以上都是应用阶段计时，不是 fsync 次数或检查点耗时的底层分解。
本轮没有新增 SQLite hook、定期 WAL 文件读取、诊断 checkpoint 或后台压缩。

## 1200 个实体生成样本的真实 Electron 验收

构建 `a1f76f0247aac3d9`；正常 GPU、sandbox、后台节流，175% DPI / 32 Hz，附加
Playwright。完整重建后生产源码在测试期间保持不变。
证据：`build/bulk-playback-avhub-bulk-playback-8RmKDg/acceptance.json`。

- 首次元数据扫描 26817 ms，扫描中暂停保存 25/27/29/30 ms，返回 154 ms。
  含封面排空的墙钟 86963 ms，不把元数据完成称为封面全部完成。
- 增量扫描 221 ms、更新 0，保存 27/23 ms、返回 152 ms。
- 首次播放增加 251 个真实解码帧，增量增加 21 帧；开始观测后源重载、waiting、
  stalled、掉帧均为零。搜索的精确总数及末页顺序断言继续通过。
- 完成、干净退出、源样本不变均 true，errors 为空，封面排空成功、退出后无 WAL。
  播放目标/模板核对 hash，1200 副本核对大小/mtime，非逐份 hash。
- 3 次目录核对均只读，serialized:scan-reconcile 不存在；脚本对此有强制断言，
  不是因为没有记录慢操作才宣称没有进入写队列。

全程分类统计（含初始化和增量，不是各阶段的分位数）：

| 操作 | 连接次数 | 行变化计数 | 最大事务体 | 最大 commit |
| --- | ---: | ---: | ---: | ---: |
| schema-bootstrap | 1 | 0 | 129.367 ms | 约 0 ms |
| scan-media | 1201 | 3603 | 6.32 ms | 114.496 ms |
| cover-queue | 2405 | 2402 | 10.58 ms | 11.59 ms |
| cover-publish | 1201 | 1201 | 3.92 ms | 78.64 ms |
| progress-save | 10 | 10 | 3.28 ms | 3.13 ms |
| scan-reconcile（只读） | 3 | 0 | 7.27 ms | 0 ms |

因此本轮能够区分：初始化约 129ms 落在初始化体内；业务最长提交落在媒体扫描
的 commit，不能解释成视频探测在写锁里执行。进度保存最大排队约 3.62ms，
后台最大排队约 88.60ms；这只是本轮观察，不证明任意保存都不会遇到长等待。

**真正的 commit 长尾仍在**，不能因为本轮最大值从前一轮 189ms 变成 114ms 就
宣称修复：负载/存储波动、运行顺序会影响最大值，且本轮没有改提交策略。也不能
仅凭计时确认某次慢 commit 就是检查点、杀毒软件或物理磁盘造成。

样本为 320×180 / 12 fps / SDR H.264 / 静音，不代表用户真实 4K、高码率、HDR、
音频设备或物理显示器验收，更不是暂缓处理的问题视频。没有做十万实体视频测试。

## 持续桌面使用：600 个实体生成视频

证据：`build/desktop-usage-avhub-desktop-usage-nnaiRs/soak.json`。
初始扫描和封面排空后，计划 180 秒，实际完成 189.547 秒、17 轮操作，包含
翻页、真实图片解码、51 次悬停预览、原文件播放、暂停保存/返回、增量发现新
生成文件及封面重试。与上一节顺序运行，没有并发执行后端/界面测试套件。

- completed、cleanExit、sourceUnchanged=true，errors 为空，实际 SQLite
  verified=true，退出后 WAL 为 0。源样本校验 hash、大小和 mtime；循环中新建
  的视频是复制到自有测试目录，不操作用户媒体。
- 活动区间帧计数增加 807、**活动掉帧 1**，waiting/stalled/源重载均为零。
  保留这一掉帧，不能描述为零掉帧；这些帧计数也不等同物理显示器实际刷新率。
- 最大返回耗时 158ms；34 次保存的最大 commit 约 3.15ms。7 次目录核对均为
  read:scan-reconcile，没有 serialized:scan-reconcile。
- 本轮扫描媒体提交最大 **192.724ms**，封面队列提交最大约 132.56ms；后台
  最大写锁等待约 169.41ms，均保留。没有把初始快速提交、滚动窗口或低 p95
  当成全程长尾已消失的证据。
- 采集了进程工作集样本，但三分钟左右的有界测试不能证明数小时无泄漏或
  任意机器长期稳定，GPU 进程 RAM 也不代表显存。

## 回归与边界

- 后端 **502 项：501 通过、1 跳过**，92.737 秒。新增 5 项扫描核对回归、1 项
  操作统计容量/保留/复制回归；同时补充提交失败时非零行变化不代表成功落库的断言。
- 核对测试覆盖无变化时即使其他线程持有写门仍可完成、仅更新实际差异、根/
  路径/回收/缺失/源身份/大小变化后的竞态保护，以及中途写入失败整批回滚。
- 界面/HTTP 契约 **19 项通过**，30.5 秒；分类、保存、完整备份、退出取消与
  封面任务回归通过。这些是组件 harness，不替代前面的真实 Electron 验收。
- 开发构建、Electron 编译、Node 语法及 diff 空白检查通过；版本保持 0.2.14，
  冻结网页归档和包锁版本未改，没有打包、推送或 Actions/发行成品验收。

## 复现入口

```powershell
npm run test:backend
npm run build
npm run build:electron
node electron/test/bulk-import-playback.mjs --videos=1200 --label=reconcile-read --search-checks
node electron/test/desktop-usage-soak.mjs --seconds=180 --videos=600
```

性能运行顺序执行，不并发其他测试。后续优先核查封面发布与任务完成之间的
独立提交是否可安全合并；必须保留修订保护、取消/恢复与实际提交确认，不直接
降低 synchronous 或通过隐藏等待状态来声称提速。

后续已实施单张封面索引与任务完成的原子提交，见
[封面合并提交验收](ATOMIC-COVER-COMPLETION-ACCEPTANCE.md)。本页保留此前两次提交的统计。
