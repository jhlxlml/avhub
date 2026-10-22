# 发布门等待与检查点归因

后续小批次隔离结果见 [有界扫描批次实验](BOUNDED-SCAN-BATCH-EXPERIMENT.md)；
本页保留上一轮历史数据。

承接 [扫描与入队合并](ATOMIC-SCAN-ENQUEUE-ACCEPTANCE.md)。本轮只增加有界观测与
隔离实验，不修改 FULL / 自动检查点策略、不打包推送、不升级版本。未访问日常
媒体库或 `E:\downloads`，原视频与播放画质不变。

## 发布门观测

原有重入互斥的外层获取现在记录 wait / hold / total，保持同一加锁顺序和重入
行为。wait 是进入计时到获取互斥锁，含少量计时记录开销；hold 是获取到释放前，
含其间的数据库排队、事务、提交或其他保护工作。重入只计次数，不重复累加
外层持有时间。

- 固定标签分组不超过 8 个；近期 32 项、慢操作 32 项、最慢 8 项，保留全程计数、
  竞争次数、失败次数和极值。没有原始路径、标题、URL、SQL 或请求传入标签。
- 获取时观察到的持有者 gate_id / operation / scope_id 可供追查，但可能经历
  不止一个持有者，不宣称它是整段等待的唯一原因。
- scan-media 与 cover-publish 使用与数据库相同的 scope_id，支持关联观察。
  未标记的缓存替换、控制和工作者阶段归为 unlabelled，不假称全部已细分。
- report 可在另一个线程持门时读取当前持有者、等待者数量，不要求获取该门。
  报告快照不共享可变内部对象；异常路径释放锁并记录失败。
  `failed` / `outcome=failed` 表示门体以异常退出，包含合作式取消，并非媒体任务
  的 failed 计数；当前未细分异常种类，不能仅据此断言用户可见故障。
- 字段位于 `/api/thumbnails` 和诊断的 `thumbnail_service.publication_gate`，
  不混入 database_timing.total。门 hold 已包含数据库操作，不能再把二者相加。
  这不是 API 全端到端耗时，也不是显示提示的时间。

`process_thumbnail` 的 cover-publish 标签从门外开始，数据库连接/commit 的
计时边界不改。封面解码仍在发布门外。没有后台采样 SQL 或写盘日志线程，没有
新增检查点，也没有以计时为理由改变调度或跳过任务。

## 验证方法

新增 8 项门观测测试，以及上下文快照和真实扫描关联各 1 项。模拟时钟只用于
精确验证计时边界；线程竞争只验证排序和互斥，不能作为性能数据。覆盖异常释放、
嵌套不重复计时、竞争时报告、scope 隔离、记录上限、快照隔离、私密字段排除和
多线程计数。

开发构建 `ebae7e0960d90e45`。后端和组件回归与性能轮分开；真实 Electron
负载继续保留计数/实际行变化断言、持久进度响应关联、真实帧/缓冲/重载及源保护。

## 已完成回归与真实桌面结果

- 后端共 533 项，532 通过、1 跳过，107.813 秒；包含新增的 10 项观测/关联测试。
- 组件/接口 harness 19 项通过，31.4 秒。进度/退出用例有 Windows asyncio
  连接重置日志，断言通过，未将组件 harness 当作桌面验收。
- 前端和 Electron 开发构建、脚本语法和 diff 检查通过。现有 Vite CommonJS / 大
  分包提示不在本轮变更范围。

1200 实体生成视频 / 60 目录，加独立播放源的真实 Electron 证据：
`build/bulk-playback-avhub-bulk-playback-eKZ2y7/acceptance.json`。

- 首次扫描 22951 ms，含封面排空墙钟 77985 ms；暂停保存 23/22/18/18 ms，返回
  152 ms。增量扫描 208 ms、更新 0，暂停 24/24 ms、返回 149 ms。
- 比前轮首次扫描 22925 / 23192 ms 相近；墙钟略高于 76757 / 76831 ms。没有
  随机化冷热缓存对照，不能据此声称计时零开销，或将差异全部归因于计时。
- 扫描、队列、发布仍为 2405 次串行调用、7206 项 SQLite 行变化，1201 张封面，
  与上一轮数量不变。实际活动帧增量首次 215、增量 21；开始观测后 dropped、
  waiting、stalled 和意外重载均 0，保存关联真实 committed 操作。
- completed / cleanExit / sourceUnchanged=true，errors 为空，封面排空、退出后
  无 WAL，固定 SQLite verified=true；源核对方式和生成样本局限同前轮。
- 旧数据库指标最大 lock_wait 仅 4.360 ms，但 scan-media 的门等待仍有
  **120.676 ms**。峰值同时等待 2 项，门内最大持有 140.983 ms，最大 commit
  139.328 ms。证明不能仅凭数据库锁等待小就声称整体排队消失。
- 例如 scope 721 的数据库 connection 722，commit 139.328 ms、total 140.919 ms，
  对应门 369、hold 140.983 ms；门 370 进入时观察到 scope 721，等待 112.108 ms。
  这是关联证据，不把观察到的持有者声明为整段等待的唯一原因。
- scan-media / cover-publish 各 1201 次门记录，分别 59 / 8 次竞争，异常退出均 0。
  unlabelled 有 2 次异常退出，而封面任务 failed=0；未细分异常类型，保留该事实，
  不把合作式取消等异常路径自动说成播放故障，也不隐去计数。
- 本轮只是观测补齐，不把门等待移入新字段后宣称这段等待已被优化掉。

短时桌面回归证据：`build/desktop-usage-avhub-desktop-usage-0KtofE/soak.json`。
实际 67.696 秒、6 轮操作、18 次预览，活动帧增加 285，活动掉帧、waiting、stalled、
意外重载均 0，最大返回 174 ms。completed / cleanExit / sourceUnchanged=true，
errors 为空，SQLite verified=true，退出后 WAL 为 0 字节。

该轮 scan-media 门等待最大 **161.233 ms**，cover-publish 持有最大 178.972 ms，
全程最大 commit 177.823 ms，门记录中异常退出为 0。它仍显著高于一次快速保存，
不能因单次保存很快、帧正常或数据库队列短，就称长尾已解决。门采集覆盖初次
扫描和后续操作，不能擅自将极值归为活动播放期间。约一分钟不等于长时间稳定性；
此前三分钟验证属于前轮构建，不能与本轮时间拼接成一个持续运行。

## 检查点实验口径

使用既有 `scripts/benchmark-sqlite-checkpoints.py`，只操作其自建临时数据库，
不对用户媒体库运行 checkpoint。顺序 default → split → split → default：

- 每轮写入次数相同、所有事务 synchronous=FULL。
- default 保持自动检查点 1000 页；split 仅在该实验数据库关闭自动检查点，
  用由首轮 WAL 复用位置推导的计划执行串行 PASSIVE，并分别测量提交和检查点。
- WAL 头的复用位置不是内部自动检查点耗时，不能对总耗时作减法来伪造归因。
- 保留显式检查点、WAL 高水位、最后关闭 anchor 的耗时及数据完整性校验；
  不能只看 commit 降低就忽略维护与退出成本。
- 没有并发检查点、真实媒体、长期读事务或冷盘对照。缓存与顺序会影响极值，
  不据此认定所有慢提交都由检查点或 fsync 引起。

## 检查点实验结果与决定

固定私有 SQLite 3.54.1；证据为
`build/sqlite-checkpoint-1792562819297248100/report.json`，completed=true。
四轮各 1000 次写入，均通过 integrity_check、行数和最后进度校验。

| 轮次 | commit 中位数 ms | p95 ms | 最大 ms | 显式检查点最大 ms | 最后关闭 anchor ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| default 0 | 1.876 | 2.134 | 55.888 | — | 3.272 |
| split 1 | 1.889 | 2.123 | 5.972 | 4.104 | 3.132 |
| split 2 | 1.887 | 2.150 | 51.247 | 3.510 | 3.659 |
| default 3 | 1.885 | 2.195 | 708.209 | — | 3.512 |

各轮 WAL 观测最大 4140632 字节，复用点 [199,393,585,775,965]；split 的
串行 PASSIVE 计划 [198,392,584,774,964]。两轮显式检查点累计 15.652 / 15.320 ms，
并非无成本。commit 累计依次 1984.758 / 1920.883 / 1972.725 / 2651.649 ms，
这只是所测阶段的累计，不是完整运行墙钟。

中位数与 p95 相近，没有足以支持生产策略更改的典型耗时收益。split 2 在 index 22
仍出现 51.247 ms commit：自动检查点已在该隔离连接关闭，且该项未执行显式
检查点，不能把这种长尾全部归于自动检查点。default 3 的 708.209 ms 保留在
结果里，不丢弃也不据此宣称关闭自动检查点会令所有应用稳定提速。

该离散极值不是用户桌面卡顿的直接复现，也没有跟踪 SQLite 内部函数、系统
I/O 或 fsync 调用，不能确定具体原因。**保留生产 FULL 与默认自动检查点**；
本轮未上线分离检查点、异步维护、退出集中写盘或降低同步可靠性的策略。

下一步优先做有界小批量扫描提交的隔离对照，连同保存优先、取消回滚、修订
保护和端到端延迟一起评估；只有真实收益且无行为退步才考虑采用，不直接扩大
事务，也不继续只通过移动等待位置来改善数字。

## 复现

```powershell
npm run test:backend
npm run build
npm run build:electron
node electron/test/bulk-import-playback.mjs --videos=1200 --label=gate-observation --search-checks
node electron/test/desktop-usage-soak.mjs --seconds=60 --videos=600
python scripts/python-runtime.py scripts/benchmark-sqlite-checkpoints.py --writes=1000
```

性能运行顺序执行，不并发其他回归或性能套件。隔离检查点实验不替代真实桌面验收。
