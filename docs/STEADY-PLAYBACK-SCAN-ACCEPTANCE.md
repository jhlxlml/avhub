# 预热后连续播放与媒体库扫描对照

## 本轮范围

承接 `PAUSE-SAVE-TIMELINE-ACCEPTANCE.md`，区分起播/恢复边界和持续播放。
新增验收模式，不改变扫描并发、写入优先级、FULL/checkpoint、解码、GPU
参数、音视频质量或加载提示。没有访问或修改 E:\downloads。

每轮启动真实 Electron 正常窗口，生成 600 个导入视频和一个 300 秒播放视频，
真实运行 FFprobe/封面任务。播放视频为生成的 H.264 SDR 320×180，分别为
12/60fps，不是用户高码率/4K/HDR 视频或已搁置的问题样本。

起播并确认实际解码后预热 3 秒，在同一次播放中依次采集：

1. 扫描前 8 秒；
2. 开始首次扫描后 8 秒，检查窗口开始、结束均仍有真实元数据扫描；
3. 等元数据扫描结束后再采集 8 秒。

不主动暂停、恢复、跳播、换源或修改速率。窗口间只查询状态，窗口中没有
测试驱动发出的查询；保留应用本来的 8 秒保存与播放活动请求。封面解码遵循
既有播放让行政策，返回媒体库后才验收任务全部排空；**不是同时强制运行
播放和封面解码的压力测试**。扫描后仍可能有等待让行的封面任务，不能称为
所有后台任务均已消失。

## 测量与边界

`steady-frame-observation.mjs` 只用于验收，不进入产品包：

- 记录 getVideoPlaybackQuality 的窗口增量，不能用回调数量代替实际总帧/掉帧。
- `presentationMs` 是 requestVideoFrameCallback 的 expectedDisplayTime 差，
  属于浏览器的预计呈现时间，**不是物理屏幕观测**。
- 同时保留回调实际到达间隔、mediaTime 步进、presentedFrames 跳号、rAF
  调度间隔，避免把回调漏报混作实际显示丢帧。
- processingMs 为浏览器报告的 processingDuration，不是探测器测出的纯 CPU
  解码时间；不能据其大于一帧周期就断定软件解码不足。
- 每 250ms 取质量快照；帧/动画/快照/事件分别限 4096/8192/256/128 项，
  保存 omitted。结束时撤销定时器、回调、监听器。缺少回调返回 null 而非 0ms。
- 保存请求继续使用真实 updated_at/响应 scope 对应实际已提交操作，不伪造响应。
  A 轮只保留原始 timeline，B 起增加单独的 saves 汇总与关联断言。

全部顺序执行，没有并行运行回归测试。Playwright 附着、采样工作、固定顺序、
缓存和短时间窗口都会影响结果，不能据此计算产品性能提升百分比。

## 结果

证据目录前缀为 `build/bulk-playback-avhub-bulk-playback-`，文件 acceptance.json。

| 轮次/后缀 | 构建 | fps | 扫描前 总帧/掉帧 | 扫描中 总帧/掉帧 | 扫描后 总帧/掉帧 | 元数据扫描 ms |
|---|---|---:|---:|---:|---:|---:|
| A / dM1L6n | 8981359af9116e81 | 12 | 96/0 | 97/0 | 96/0 | 11998 |
| B / LYFhje | 8981359af9116e81 | 60 | 481/236 | 481/235 | 482/237 | 11888 |
| C / TXTXHm | f77209e90d9da12f | 60 | 482/237 | 479/234 | 481/236 | 11987 |
| D / Bb4sM2 | f77209e90d9da12f | 12 | 96/0 | 96/0 | 96/0 | 12517 |

C/D 是增加手动诊断显示上下文后的新构建；新增读取仅在显式导出时发生。
不把跨构建/采集版本的结果当作严格前后性能比较。

- 所有窗口实际播放、可见且有焦点，无 pause/seeking/waiting/stalled/loadstart。
  六个 12fps 窗口未新增掉帧或漏回调；但不能追溯证明上一轮的掉帧都来自起播。
- 所有轮次屏幕 API 均报告 **32Hz、200% 缩放**，工作区 1440×852，窗口
  1408×820；rAF 中位约 32.6–32.9ms，p95 33.1–33.3ms。这与先前报告的
  60Hz/175% 环境不同，不可直接拿历史数值断言回退或改善。
- 60fps 源的累计掉帧约 49%，扫描前中后均存在，未观察到扫描额外增加累计
  掉帧。该调度环境本身不适合验收 60fps 逐帧呈现；但系统报告刷新率并非实测
  物理刷新率，不能据此认定已找出全部掉帧根因。
- 不能把“未新增累计掉帧”说成扫描无任何影响：C 的回调中位间隔从扫描前
  33.3ms 变为扫描中 65.2ms；presentedFrames 跳号对应漏回调从 78 增至 119，
  扫描后为 85。B 则是 116/117/114，未复现同幅变化。这是应保留的坏结果，
  不能当作实际多掉了 41 帧，也不能据此立即改扫描线程数或播放参数。
- 12fps 的预计呈现 p95 约 98.4–99.4ms；60fps 扫描中约 97.5/98.2ms，
  前后约 66.1–66.5ms。预计呈现、回调和物理呈现仍须分别解释。
- 普通定时保存的观测请求往返约 4.3–7.5ms。B/C/D 的数据库 total 约
  2.666–5.507ms，均关联成功提交。未复现 300ms 请求或命令长尾，**不代表
  已解决上一轮长尾**，也没有为省时先返回再提交。
- 四轮 completed/cleanExit/sourceUnchanged=true、errors 为空、SQLite 私有
  运行时 verified=true，退出无 WAL。检查播放源/模板哈希及全部生成副本的
  大小和修改时间；不是对每个生成副本逐个作哈希。生成了 601 张封面并排空。
- longtask 列表为空，不代表不存在 GPU/合成/调度阻塞。完成标志只确认流程
  和数据验收完成，不是 60fps 已流畅通过。

## 产品改进：手动诊断包含显示环境

既有手动“采集并导出播放诊断（8 秒）”新增 display.first/last：系统报告
刷新率、缩放因子和逻辑尺寸，摘要明确不等于物理刷新率或视频帧率。
仅读取窗口所在显示区域，不枚举输出显示器名称、ID、序列号或桌面坐标。
无效/未知值为 null，不以 60Hz 等猜测替代；显示查询失败不影响其他诊断。
不新增日常后台轮询，不改变用户的屏幕设置。

C 轮在三个计时窗口结束后，通过应用按钮实际完成额外的 8 秒导出，首末
均为 32Hz/scale=2/1440×900；不把这段额外诊断混入对照窗口。单测覆盖
32→60Hz 的首末变化、无效参数、异常降级和私密字段剔除。

## 决定与下一步

不根据这组受限桌面数据修改解码/GPU、降低画质或盲目收紧扫描并发。持续
播放中未复现慢保存，只能说明它不是每次定时保存都会发生。保留此前长尾。

下一步应在正常高刷新率本机桌面上，以同一构建、代表性原视频复核连续呈现；
同时复测暂停/恢复的 HTTP/handler/数据库分段，不将本轮稳定定时保存当成
暂停长尾已修复。若再次观察扫描下回调交付变差，再做无调试器对照和预算实验。

后续已补充手动诊断调度统计，并修复独立进度写入被轨道记忆阻塞的问题，见
`PARALLEL-PROGRESS-MEMORY-ACCEPTANCE.md`。仍未把历史长尾标为解决。

```powershell
node --test electron/test/steady-frame-observation.test.mjs electron/test/playback-timeline.test.mjs
npm run build
npm run build:electron
node electron/test/chromium-diagnostics.mjs
node electron/test/bulk-import-playback.mjs --videos=600 --label=steady-12 --readiness=off --frame-comparison --playback-fps=12
node electron/test/bulk-import-playback.mjs --videos=600 --label=steady-60 --readiness=off --frame-comparison --playback-fps=60 --capture-diagnostics
```

本轮版本仍为 0.2.14，不打包、不发布、不推送。

## 回归

- 前端及 Electron 编译通过；最终构建 f77209e90d9da12f。既有 Vite 配置加载、
  大 chunk 警告仍保留。
- Chromium 手动诊断合约通过：隐私、无效值、首末显示变化、查询失败降级、
  取消、换源、debugger 所有权及清理。
- 时间线与连续帧工具 6 项单测通过，另对采样容量边界、重复 stop、监听器与
  定时器/回调释放作了故障/边界测试；这些合成测试不是性能证据。
- 显式浏览器组件 harness：progress-save/shutdown/thumbnail-tasks 共 10 项
  通过，19.9s。桌面验收使用上面的真实 Electron，不以组件测试替代。
- git diff --check 通过，仅既有 build-windows.ps1 的 LF/CRLF 提示。
- 本轮未修改后端业务逻辑，未重新宣称上一轮的 559 项全量后端回归是本轮
  新执行的结果。
