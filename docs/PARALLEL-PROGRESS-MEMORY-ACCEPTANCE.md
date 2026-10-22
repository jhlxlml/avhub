# 独立进度保存与播放记忆屏障

## 已证实的问题与修复

现有播放器的 save() 原来先 await flushMediaPlaybackState()，之后才读取当前位置、
发送 progress PUT。音轨/字幕记忆和播放进度是独立接口，却串行等待：播放记忆
请求受阻时，暂停的进度请求根本不会发出；定时保存的取样位置也会被推迟。

修复前在明确的浏览器组件 harness 中人为阻塞字幕记忆 PATCH，暂停后等待
progress 响应 2000ms 超时。这个失败复现的是依赖关系，**不是自然发生了两秒
慢请求，也不证明此前 385/373/341ms 长尾源于它**；先前那些样本并未编辑轨道。

现在同时启动播放记忆确认与独立的进度请求，按触发时的实际进度取样。
Promise.allSettled 等待两者结果后才确认 save() 成功：

- 正在写入的相同进度仍共享真实请求，不缓存已完成请求；keepalive 仍单独确认。
- 每次调用均有自己的当前播放记忆屏障，复用进度请求不能跳过新发生的记忆写入。
- 进度可先成功落库、更新应用状态；播放记忆失败时明确提示“进度已保存，但
  播放记忆尚未保存，请重试”，不把它错误描述为进度未保存。
- 返回/切片/连播/关闭仍等待两者成功；错误保留，允许重试，不提前放行。
- 两个 HTTP 等待并行，**不是两个 SQLite 写事务绕开原有串行队列**。FULL、
  保存优先级、原子提交、时间戳防旧写和本地媒体只读政策均不变。
- 不增加定时器，不改正常 8 秒保存频率，不改变解码、分辨率、编码或色彩。

## 验收

### 故障注入：组件与真实桌面

tests/ui/media-playback-memory.spec.ts 新增成功、失败/重试两项：阻塞实际
记忆 PATCH，验证 progress 已收到真实成功响应且能从独立读取中核对持久值；
点击返回后仍处于“正在保存…”。解除阻塞成功后才返回，失败则保留播放器与
准确错误，重试成功后核对字幕记忆。

第一次修复后整组回归为 23 通过、1 失败：失败测试的 getByRole('alert') 同时
匹配全局错误 toast 与播放器持久错误。保留两个提示，改用播放器内部 notice
准确定位后重跑，24 项全通过（约 1.2 分钟），不是移除失败提示来通过测试。
测试服务日志仍有 Windows asyncio 10054 连接重置噪声，不能称日志全部无异常。

真实 Electron 同样通过字幕控件切换生成的外挂 SRT，阻塞实际记忆请求后
核对进度持久状态、返回屏障、失败和重试。该人为注入在性能阶段结束后才运行，
**不混入暂停性能统计**。每轮成功路径一笔记忆写入，失败/重试路径四笔：
原写入、重叠屏障的重试及显式重试；没有假装它们已全部去重，这是后续优化点。
不修改用户视频；SRT 与视频均为隔离测试新建样本。

### 正常性能阶段

最终构建 e8ba7f9785ec0b11，正常 Electron/GPU/sandbox/backgroundThrottling，
600 个视频、真实扫描和封面任务，普通原文件直放。两轮顺序执行，无并行回归。
播放源为生成的 H.264 SDR 320×180/12fps、无声；不是实际大码率/4K/HDR 验收。

证据目录前缀 build/bulk-playback-avhub-bulk-playback-，文件 acceptance.json：

| 后缀 | 首次扫描 ms | 首次四次暂停旧总计 ms | 增量扫描 ms | 增量暂停旧总计 ms | 返回 首次/增量 ms |
|---|---:|---|---:|---:|---|
| tG9Asd | 12747 | 31/18/18/24 | 105 | 31 | 124/118 |
| 7q8xow | 13086 | 19/24/24/21 | 105 | 30 | 107/133 |

- 旧总计仍包含测试命令、响应读取、画面与持久值复核，不是纯应用保存耗时。
  十次实际 fetch 至响应头约 4.7–12.9ms，数据库 total 约 2.705–9.694ms。
  本轮未复现历史数百毫秒长等待，不能宣布长尾已根治，也不计算笼统加速比例。
- 首次/增量的实际总帧增量均为 131/11，无新增掉帧、waiting、stalled、源重载。
  系统报告 32Hz/scale=2，仅说明本次生成的低帧率样本；不能覆盖历史坏样本。
- SQLite 提交长尾仍存在，两轮全程 commit 最大值分别 184.606/139.030ms。
  快速的已采样进度保存不等于所有事务均快。
- 两轮 completed/cleanExit/sourceUnchanged=true，errors 为空，退出无 WAL；
  私有 SQLite verified=true。校验播放源/模板哈希和全部生成副本大小/修改时间，
  不是对每个副本逐一作哈希。任务排空，源文件原地不动。

## 手动诊断更准确地区分回调与呈现

播放诊断增加 playback.scheduling，仅在用户显式采集的 8 秒内运行：

- animationGapMs：页面 requestAnimationFrame 调度间隔；
- predictedPresentationGapMs：浏览器预计呈现时间的间隔，不是物理屏幕实测；
- reportedProcessingMs：浏览器可选 processingDuration，不是纯 CPU 解码耗时；
- missedFrameCallbacks：presentedFrames 跳号对应的未交付回调数，不能等同丢帧；
- truncated：采样是否到达容量上限。各新数组最多 4096 项，原回调间隔数组
  最多 2048 项；缺失值为 null/count=0，不以 0ms 代替未知。

统计范围从采样初始化至最后读取，包含诊断建立阶段；不是所有字段都能与
首末质量计数器的增量窗口逐毫秒对齐。摘要明确回调间隔不等于物理呈现，
不自动推断“硬件不足”或切换转码。结束/取消时撤销动画和视频回调及监听器。
日常播放不运行这些新采样，不写偏好、不读取画面像素。

先行真实导出证据 HjYegM 使用构建 693dd569021211a4（尚未改进度保存）：
实际应用内导出统计为 rAF 中位 32.5ms，预计呈现中位 65.2ms，浏览器报告
processing 中位 33.5ms，漏回调 120、truncated=false。仍是受限 32Hz 桌面，
不能据此认定解码耗时或物理刷新率，更不能把它当作修复后的帧率提升。

合约测试实际执行编译后序列化到页面的函数，以合成 DOM 快速推进回调，覆盖
容量上限、缺失 processingDuration、缺失值保持 null、所有监听器与两类回调
清理；合成推进不是实际播放或性能证据。最初编译暴露可选字段的类型问题，
修正后前端和 Electron 编译均通过，未把带编译错误的构建用于桌面验收。

最终构建的真实导出证据为 bvAB5E：通过应用按钮实际采集并保存，断言新统计
存在且未截断。rAF 中位 31.2ms，预计呈现中位 62.3ms，报告 processing 中位
32ms，漏回调 107；8.002 秒质量增量 480 帧/掉帧 224，画面回调 147、报告
presented 增量 254，最小已采样缓冲约 70.3 秒，waiting/stalled/换源均为 0。
这直观说明时钟约 1×、缓冲充足和回调数不同，并不能等同流畅或解码不足。
显示区域首末仍报告 32Hz/scale=2；不可把与先行轮次的调度波动说成代码提帧。

该轮三个 8 秒窗口分别为 482/225、480/224、482/225（总帧/掉帧），实际采集
在窗口结束后另外运行，不混入对照。completed/cleanExit/sourceUnchanged=true、
errors 为空。高帧率物理显示验收与历史暂停长尾仍未关闭。

## 最终回归与下一步

- 前端与 Electron 构建通过，诊断合约通过，采样/时间线工具 6 项通过。
- 保存/记忆/退出/连播组件 harness 24 项通过；不代替两轮真实 Electron 屏障验收。
- 后端进度定向回归 9 项通过，1.286 秒；未修改后端业务，未把上一轮全量结果
  冒充本轮新执行的全量回归。
- git diff --check 通过，仅既有 build-windows.ps1 的 LF/CRLF 提示。
- 后续优先收敛同一视频播放记忆的重叠重试，保留新修改与未保存保护；高帧率
  问题须使用正常刷新率桌面和代表性原视频的新诊断，不再从受限桌面计数猜测。
- 此次已修复一项有明确前后故障注入证据的串行依赖，不宣称旧暂停长尾根治。

后续共享确认与重试去重已实现，验收见 `MEDIA-MEMORY-SHARED-BARRIER-ACCEPTANCE.md`；
此处的四笔失败路径记录作为历史基线保留，不改写成后续结果。

## 复现

```powershell
npm run build
npm run build:electron
node electron/test/chromium-diagnostics.mjs
npx playwright test tests/ui/progress-save.spec.ts tests/ui/media-playback-memory.spec.ts tests/ui/shutdown.spec.ts tests/ui/autoplay.spec.ts
node electron/test/bulk-import-playback.mjs --videos=600 --label=parallel-save --readiness=off --search-checks --memory-barrier-checks
node electron/test/bulk-import-playback.mjs --videos=600 --label=diagnostic-export --readiness=off --frame-comparison --playback-fps=60 --capture-diagnostics
```

回归与性能轮顺序运行。版本保持 0.2.14，本轮不打包、不推送、不发布。
