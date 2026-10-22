# SQLite 页占用归因与大库搜索优化

延续 [私有运行库验收](PRIVATE-SQLITE-RUNTIME-ACCEPTANCE.md) 的两个待办：拆分新增页
占用、减少大库文本搜索的重复扫描。只使用自建隔离数据库和生成视频，没有打开、
压缩、整理日常媒体库，也没有访问 `E:\downloads`。版本不变，未打包、推送或发布。

## 页占用：定位到数值编码与页面填充差异

同一脚本生成十万媒体、一万目录，对照宿主 SQLite 3.50.4 和固定私有 3.54.1。
页归因通过 SQLite backup API 的一致性副本完成；检查器只接受本基准创建的
`layout-snapshot.db`，以只读连接和 query_only 打开。
[官方 DBSTAT](https://sqlite.org/dbstat.html) 用来按表/索引统计页、有效载荷与未用空间。

原始整数值较多的生成负载，两份 schema SHA-256 均为
`44390c4d6557edd0f00e9a9f5caadfeec3d569835192153c3d370f27121fa8db`；媒体
100000、目录 10000、剧集组 22751、片单项 10000，integrity_check 均为 ok。

| 对象 | 旧引擎页数 | 私有引擎页数 | 增加页数 |
| --- | ---: | ---: | ---: |
| media | 5572 | 6686 | 1114 |
| media_added | 450 | 600 | 150 |
| media_recent_order | 542 | 685 | 143 |
| media_recent | 384 | 449 | 65 |
| media_episode_order | 127 | 170 | 43 |
| roots | 210 | 234 | 24 |
| media_favorite_order | 75 | 96 | 21 |
| 其他对象合计 | 11533 | 11533 | 0 |
| 全库 | 18893 | 20453 | 1560 |

page_size=4096、freelist_count=0：增加 6389760 字节，约 8.3%。media 表的有效
载荷从 21339697 增至 25006512 字节，未用空间从 706004 增至 1583393 字节。
不是额外创建了索引、重复行，或仅仅多了一批可回收空闲页。插入媒体后已出现
主要差异（18289 / 19848 页），并非搜索请求、ANALYZE 或剧集回填才造成。

最小复现使用独立子进程、六条相同数值记录和四种表布局（无索引、TEXT UNIQUE、
TEXT 索引、REAL 索引），关闭连接后只读检查生成库的单个叶页记录：

- 宿主引擎四种布局均可把 REAL 的整数值 0/100 紧凑存为 serial type 8/1。
- 私有引擎无索引时相同；该样本存在任一测试索引时，0/100 存为 serial type 7，
  数值部分占 8 字节。小数样本两者均为 type 7。
- 所有样本读回的数值和 SQL typeof 都一致，未发现精度丢失。

SQLite 的 REAL affinity 允许内部紧凑存储整数值，对 SQL 层透明，见
[官方类型说明](https://sqlite.org/datatype3.html)。本轮证明的是这两个实际二进制
在该带索引插入形态下的磁盘编码差别，不能仅据此断言上游有 bug 或确定其设计意图。

加入小数时间戳、时长和进度的补充负载中，旧库为 82132992 字节 / 20052 页，
私有库为 83775488 字节 / 20453 页，差约 2.0%。仍保留默认零值，也不是用户真实库。
因此 **8.3% 和 2.0% 都不能直接套用到日常库**，更不代表视频文件增大。

保留引擎维护升级；不改 REAL schema、不截断时间或进度、不删除现有索引、不改
FULL 持久化，也不自动 VACUUM/REINDEX。任何额外索引都应连同容量和写入代价评估。

证据（均在忽略的 build 内）：

- 页归因：`library-benchmarks/20261021-093104-09775689.json`（旧）、
  `20261021-093109-5b0ff9d1.json`（私有）。
- 小数补充负载：`20261021-093830-281584e4.json` / `20261021-093836-912eefd6.json`。
- 最小编码复现：`sqlite-real-layout-1792547185059549100.json`。

## 搜索：减少零结果与单条结果的第二次扫描

包含式搜索保留 title/name/tags 的原有 LIKE 字面匹配，不新增 FTS 表或索引，不改变
中文、大小写、`%`、`_`、反斜杠语义。含前导通配符的普通 LIKE 不能按常规前缀
范围定位，参见 [SQLite 查询优化说明](https://sqlite.org/optoverview.html#the_like_optimization)。

分页接口在同一只读事务里执行：

1. 搜索计数顺带返回 id；只有 COUNT=1 时才使用该 id，COUNT=0/多条时忽略它。
   SQLite 支持 aggregate 中的 bare column，值来自其中一行；只有一行时无歧义，
   见 [SELECT 语义](https://sqlite.org/lang_select.html#bareagg)。不用对每个匹配行执行 MIN。
2. 零结果直接返回空页；单条结果按主键取完整记录，不再执行第二遍 LIKE。
3. 多条结果沿用原分页/排序路径；旧非分页接口不变。计数后并发写入不能让
   主键查询看到不同快照或泄漏不匹配的记录。

私有引擎、十万媒体/一万目录，每项预热后 7 次测量，以下为 p50 毫秒。
这是直接 Python API 热查询，不是 Electron 端到端延迟，也不是视频播放/跳播测试。

| 查询 | 修改前 | 修改后第一轮 | 修改后复测 |
| --- | ---: | ---: | ---: |
| 零结果 | 47.70 | 24.76 | 24.49 |
| 单条文件名 | 50.48 | 25.79 | 25.74 |
| 单条标签 | 48.39 | 24.91 | 25.23 |
| 多条子串 | 46.86 | 46.93 | 46.48 |
| 宽泛标题 | 22.36 | 22.78 | 22.60 |
| 宽泛标签 | 26.80 | 29.46 | 27.38 |

零结果 p95 为 48.33 → 25.05 / 25.34 ms，单条文件名 52.49 → 25.90 / 26.84 ms。
收益仅针对零/单条结果，约省去一半查询耗时；宽泛搜索未提速，存在少量开销/波动，
不能宣称全场景提速或毫无退化。分配页总量保持 83775488 字节，未用额外索引换速度。
新增基准保留宽泛标题/标签、多条子串、零结果、单条文件名/标签及对应搜索计划，
不只记录有利案例。普通列表、分页、保存等测量也继续保留。

证据：`library-benchmarks/20261021-093632-f1278e8b.json`（修改前）、
`20261021-093817-cb3dcde6.json`（修改后）、`20261021-093823-31bb48ba.json`（复测）。

最终查询计划复核保存在 `20261021-095008-16e87a6e.json`：计数是 SCAN media，
单条取值是 INTEGER PRIMARY KEY 定位，小结果集扫描后有界排序，宽泛结果仍使用
media_recent_order。该轮零结果/单条文件名/单条标签为 24.34 / 25.75 / 24.54 ms，
宽泛标题/标签为 22.69 / 27.39 ms，与前述收益和限制一致。

## 正确性与实际 Electron 验收

最终开发构建 `1edcd06226cfff97`，应用版本未变。

- 后端 **491 项：490 通过、1 跳过**，92.449 秒。新增 5 项搜索测试覆盖全部排序、
  各页、Unicode/字面通配符、组合筛选、零/单条查询次数及并发 WAL 快照；新增
  4 项页工具测试覆盖路径范围、拒绝覆盖、varint 边界和读取前后字节不变。
- 界面/HTTP 契约 harness **19 项通过**，31.1 秒，覆盖分类切换、缓存失效、慢请求
  竞争、进度保存、完整备份、退出取消与封面任务。退出取消期间有一条 Windows
  socket reset 回调日志，断言和进程退出均成功；不把它当作查询性能数据。
- `electron/test/library-search.mjs` 使用真实 Electron、正常 GPU/sandbox/
  backgroundThrottling 与私有 SQLite verified=true。四个生成视频验证零/多条/
  中文/字面 `%_` 搜索、快速更改查询、打开单条原文件、暂停返回后进度落库。
- 实际播放增加至少 7 个解码帧，最终观测 16 帧、掉帧 0、开始观测后源重载 0；
  所有源样本哈希/mtime 不变，cleanExit/sourceUnchanged/passed=true，errors 为空。
  证据 `build/library-search-avhub-library-search-JyyuTH/acceptance.json`。
- 这是四个实体 320×180 / 12 fps / SDR H.264 / 静音样本，不是十万实体视频 UI、
  真实 4K、高码率或声音设备验收。未修改任何播放链路和有损权限。
- 开发构建通过；没有运行 PyInstaller/Electron 打包，也没有 Actions 或发行成品结论。

## 复现与后续边界

```powershell
# 必须先准备固定私有运行库；日常查询与测试使用相同入口。
npm run check:sqlite
npm run benchmark:library -- --rows 100000 --roots 10000 --repeats 7 --layout-details
npm run benchmark:library -- --rows 100000 --roots 10000 --repeats 7 --layout-details --fractional-values
python scripts/probe-sqlite-real-layout.py
npm run test:backend
npm run build
npm run build:electron
node electron/test/library-search.mjs
```

故意对照宿主时，仅将基准入口改为 `python scripts/benchmark-library.py`；这是标明的
宿主引擎 harness，不能冒充桌面私有引擎。探针也只创建独立临时库，不接受用户库。

下一步优先评估 **多条匹配时的重复文本扫描**：保持同样排序/精确计数/筛选语义，
同时记录宽泛搜索、写入开销、原生内存与索引体积，不应直接为此默认新增全文索引。
此前后台事务提交长尾也仍需在实际长时间 Electron 使用中观察；本轮没有证明它已解决。

后续已将优化扩展至有界多结果集合，并补测原生 SQLite 分配峰值与真实桌面
扫描/搜索/播放并发，见 [多结果搜索与写入长尾复查](BOUNDED-SEARCH-AND-WRITE-TAIL-ACCEPTANCE.md)。
本页数字和单条快捷查询描述保留为前一轮记录。
