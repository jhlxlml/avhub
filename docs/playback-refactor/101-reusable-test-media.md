# 统一管理和复用验收媒体

日期：2026-11-10。目标是减少重复生成/复制测试视频，不修改播放器、UI、画质、用户偏好或播放路径。版本保持 0.2.19，不打包或发布。原始视频继续只读。

## 下一步顺序与本轮落实

1. 固定样本池与配方登记：本轮实施。
2. 将频繁执行的播放、跳播、恢复、持续验收脚本接入，并验证重复运行与修改隔离：本轮实施。
3. 后续触及的旧脚本逐个迁移；真实播放长等待和帧节奏分析使用这些固定样本及只读原片，保持同源可比。

## 管理规则

实现：`electron/test/media-pool.mjs`；目录：`build/test-media/`，被 Git 排除，不能打包进应用。根目录必须有对应所有权标记；拒绝未知非空目录、越界目录及重解析目录。每份配方/导入按版本或完整内容哈希发布，写入 `fixture.json`，包含文件字节数、SHA256、来源类别及配方。每次复用校验完整文件；损坏时报错，不静默重生成。保留生成失败的未发布 staging 目录供排查，它不会成为成功样本。

标准配置包括 basic H.264、4K 10-bit HEVC、8 秒 TS、38 秒长 GOP MP4、普通/长 GOP TS。已有的大 HEVC 标准样本通过显式 adoption 登记，不再编码或复制。像素条码、SDR10、HLG 长片等已有自有样本可以登记为内容哈希引用；不强行重建一份不同的视频。

只读播放使用池内自有媒体的 NTFS 硬链接。各次运行仍保留独立媒体别名、SQLite、缓存、截图及报告；硬链接不隔离写入，因此池媒体设为只读，**不能拿它测试覆盖、重命名连带修改、损坏或回收流程**。修改类测试必须请求 `mutable:true`，创建独立、可写的字节副本；只改变这个副本。契约测试故意创建的小型隔离池例外，不能污染常用池。

原始本地视频不可硬链接、chmod 或修改。现有克隆索引的真实媒体测试可以直接只读引用原片；需要私有别名的测试可以先建立一份独立快照，后续重复使用池内快照。报告不把快照测试称为冷盘读取测试。大文件哈希采用流式读取，避免将整个视频载入内存。

缓存预算为 24 GiB、预留至少 1 GiB 空间；超限明确失败，不自动删除正在引用的文件或回收旧版本。旧版本、失败 staging 和历史媒体的清理需单独核对，不与报告清理混为一谈。并行首次准备同一配方没有自动重试机制；播放验收本来串行执行，先串行准备再启动测试。

## 使用方法

```powershell
npm run test:media -- list
npm run test:media -- prepare basic
npm run test:media -- prepare hevc4k
# 仅限已确认由测试生成且位于 build 内的样本
npm run test:media -- adopt-generated hevc4k D:\AI\codex\avhub\build\owned-fixture\HEVC4K.mkv
npm run test:media:contracts
npm run test:playback:desktop
```

`playbackFixture(profile)` 返回校验后的标准样本；`placeTestMedia(source,destination,{mutable:false})` 创建只读别名；修改用 `{mutable:true}`。`generateTestMedia(ffmpegArgs)` 按去除输出路径、输入文件内容哈希归一化的配方缓存派生样本，生成一次后复用；不能用它改写用户视频。只有测试配方可以编码人工样本，真实视频仍遵守原画/stream-copy 规则。

每个媒体别名目录写入 `.avhub-test-media.jsonl`，记录配方路径、哈希、大小及 `read-only-hardlink`/`private-mutable-copy`，便于归因与清理。此文件不是播放成功证据；实际 Electron、像素、GPU 回执、目标精度与源完整性断言仍保留。

## 迁移范围与边界

已接入标准 fixture 提供器，以及独立 MPV 重开、两路径 seek 对照、启动计时、启动意图、播放输入、GPU 故障、恢复、跨路径切换、并发扫描/封面、像素播放、持续 SDR/HLG、codec 对照、ASS 和 seek 设置脚本。完整播放回归新增媒体池契约测试。

**不是所有历史测试生成器已迁移。** UI、文件操作、临时目录等旧 harness 仍有自有小样本生成；涉及改写/回收的不能直接换成共享硬链接。后续修改这些脚本时遵循 AGENTS 规则，优先复用配方并创建必要的独立副本。未改变历史样本内容、原有验证断言或归档源码。

## 本轮验收

当前 HEAD `f3f65dbc321b54541f09be6b1558fb9e4f5eab27`，保留既有未提交修改。应用构建 `f74c72f3f1e6380b` / 原生候选 `render-replayed-candidate-wgp7hX`；本轮没有修改生产播放器或原生源码。

| 验收 | 结果 / 退出码 | 证据 |
| --- | --- | --- |
| 媒体池契约：复用/只读/独立副本/输入内容身份/失败不发布/损坏与越界拒绝 | 5 个测试 PASS / 0；末轮使用 bigint 核对精确 NTFS 文件标识 | `build/media-pool-contract-OloNDf/`、`build/test-media-contracts-final.log` |
| 完整实际 Electron 回归，含构建、两种 MPV、恢复与跨引擎循环 | 两轮各 21 项 PASS / 0，均无 unrun | `build/playback-regression-NIv3np/report.json`、`build/playback-regression-ySiyGO/report.json` |
| 共享媒体真实身份对照 | PASS / 0：两轮相同标准目录/内容，4 处 HEVC 别名精确 inode 与 SHA256 一致 | `build/test-media-reuse-evidence.json` |
| SDR10 像素、PNG16 截图及控件流程 | PASS / 0 | `build/render-app-flow-qDr6B0/report.json` |
| ASS 字幕/20 次像素确认跳播 | PASS / 0 | `build/render-ass-seek-XZI2rr/report.json` |
| HEVC MP4，40 次精确定位及关键帧像素检查 | PASS / 0 | `build/render-codec-seek-4IVb0v/report.json` |
| seek 设置/重开保持 | PASS / 0 | `build/mpv-seek-settings-I1bbE5/report.json` |
| SDR10 持续播放/共享别名释放 | 20 秒回归 PASS / 0，源哈希不变，退出只 unlink 别名，池仍保留 | `build/render-app-soak-VmkOV9/report.json` |
| 原片 + 扫描 + 封面短时并发 | 实际 68.066 秒 PASS / 0，6 次资源采样，1 次 seek，13 张封面，源完整性不变；3601 次纹理导入/释放平衡，helper 已退出、占用已释放 | `build/render-concurrent-soak-XHAZjL/report.json` |
| 补充验收汇总 | 7 项 PASS / 0，无 unrun | `build/media-reuse-acceptance-6af038/report.json` |
| 格式检查 | `git diff --check` PASS / 0；已有 CRLF 提示不属于检查失败 | 本地执行结果 |

两轮仅四处 1510485230 字节 HEVC 引用就避免了 **6041940920 字节（约 5.63 GiB）** 独立副本。不是“本轮删除释放”量，而是与此前复制方式比较的重复分配避免量；NTFS 普通目录大小可能重复累计硬链接，不能据此声称又占了四份物理空间。第一轮前后标准样本目录/文件清单不变；最终统一目录校验输出 `build/test-media-final-catalogue.json`。

codec MP4 本轮 input→GPU 回执精确定位 p50 71.1 ms / p95 88.8 ms，仅作本轮功能/计时记录，没有同条件配对基线，**不声称样本管理提升了播放跳播速度**。短时并发不是全天稳定性、全帧零丢帧或物理 HDR 色彩认证。上一轮 20 分钟并发报告只保留为其自身代码与运行环境的历史证据，不冒充本轮样本迁移验收。外机/实体 HDR 本轮 SKIP（未执行），没有新成品打包结论。

环境说明：初始默认沙箱的 NTFS link 探针返回 EPERM，未将其当作功能通过；随后在已授权的项目自有隔离样本上执行真实硬链接/只读/独立副本测试并通过。未跳过所有权或哈希检查。

回滚：仅撤销本轮 fixture 提供器、媒体准备/引用及 runner 改动，保留报告与池；不撤销之前播放修复。共享别名只可 unlink，不得先取消只读再修改；需要内容变更就复制。回滚不需要删除用户数据、原视频或降低安全检查。
