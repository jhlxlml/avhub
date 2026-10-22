# 桌面恢复、诊断及组合使用验收

## 本轮范围

1. 播放页恢复读取：只对媒体详情及片单上下文的暂时网络错误、超时、HTTP 502/503/504
   最多尝试三次；每次五秒，间隔 200/600 ms。返回或切换目标会取消后续尝试。
   404、权限/参数错误和协议不匹配不自动重试。耗尽后保留目标 URL 和片单位置，提供
   手动重试与返回；若已有同一视频播放器，恢复重试不会替换视频元素或播放源。
   不扩展为全局重试，不重发播放 POST、文件操作或设置写入。
2. 测试与发布：渲染器失败附带最多 32 条本地 API/媒体传输错误及健康状态，不记录
   请求头、查询参数或原视频路径。全屏测试采用即时检查两种就绪状态，避免缺失按钮
   的 `isEnabled()` 阻塞整个轮询；不放宽超时、跳过断言或绕过真实续播选择。
   手动上传只允许显式恢复同源码、同说明、带所有权标记的未公开草稿；上传和最终
   公开前均核对大小及 SHA-256，已公开版本不覆盖。详见 [构建与发布](GITHUB-ACTIONS.md)。
3. 播放诊断 schema 2 增加摘要、丢帧比例及呈现帧率。封装模式、诊断被占用等未采集
   原文件请求的场景使用 `null`，只有确实观测到零次请求才记录 `0`。传输值不是磁盘
   I/O；时钟正常、waiting 为零也不能证明画面流畅。采集仍为显式八秒，不常驻监测。
4. 新增真实 Electron 组合使用长测，同时覆盖翻页、滚动、实际封面解码、静音悬停
   预览、原文件播放、增量扫描及封面重试。测试默认 20 分钟、600 个隔离生成样本，
   不接触用户媒体库，不重载文档、强制 GC、清缓存或降低原视频质量。

正式包缺少 MPV 时，不再要求普通用户运行开发脚本；保存过 MPV 偏好的用户可明确
点击“改用现有播放器”。仍未绕过 MPV 分发门槛，不代表本轮开始随包提供 MPV。

## 运行方法

先运行 `npm run build` 和 `npm run build:electron`，再按需分别执行：

```powershell
node electron/test/route-recovery.mjs
node electron/test/desktop-usage-soak.mjs --seconds=1200 --videos=600
npx playwright test tests/ui/route-recovery.spec.ts tests/ui/native-runtime-message.spec.ts
python -m unittest discover -s tests -p test_ci.py
node electron/test/chromium-diagnostics.mjs
```

长测期间不要重建应用或操作测试窗口。报告写入忽略目录
`build/desktop-usage-*/soak.json`，每轮保存未完成检查点；仅最终 `completed:true`、
`cleanExit:true`、`sourceUnchanged:true` 且错误列表为空才是完整通过。
每个 Electron 进程工作集超过 2 GiB 时安全停止。中断不拼接成连续验收。
恢复测试的截图及报告位于 `build/route-recovery-*/`，失败证据由 CI 归档。

也可用独立启动器保留 stdout/stderr 和本次运行清单：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File electron/test/start-desktop-usage.ps1 -Seconds 1200 -Videos 600
```

辅助控制台隐藏，隔离 Electron 窗口仍可见。返回的 `run.json` 记录唯一日志和停止
标记路径，stdout 会输出实际报告路径；创建该停止标记只会在本轮结束后停止，
不会被计为完成时长。检查点原子替换，不能根据进程消失或空错误列表认定通过。

## 证据边界

- 浏览器运行的是明确标记的 renderer/HTTP harness，不是网页版支持或桌面验收。
- 组合长测使用生成的 320×180 H.264 SDR 文件及真实生成封面；不是上万个真实文件、
  冷盘、4K/HDR/长 GOP 或用户暂缓处理的视频的性能结论。
  源身份字段核对代表性生成源的哈希、大小和 mtime，不等于逐一核对所有生成副本。
- 真实 Electron 使用正常 GPU/沙箱，但附加 Playwright；同时运行的其他回归存在
  CPU/GPU 负载。进程工作集是采样值，GPU 进程内存不是显存，有限时长不能证明零泄漏。
- 较早的 schema 1 组合测试启用了 `AVHUB_HEADLESS_TEST=1`，虽显式显示/聚焦窗口，
  该开关仍关闭了后台节流，不能称为与发布包完全相同的窗口策略。schema 2 已改为
  正常显示和后台节流，并记录/验证实际 WebPreferences；旧测试保留，不追认新策略。
  `frames/dropped` 是每次打开累计值，包含开播；schema 2 额外记录就绪时基线及
  `activeFrames/activeDropped`，保留总量并拆分播放段，不把开播丢帧删除后声称无丢帧。
- 发布器仅以隔离 mock 验证；本轮没有打包、上传、推送标签或执行 GitHub Actions。
  已下载的公开桌面包不会因源码修改自动更新。

## 本轮结果

未结束的检查点不算通过，原失败记录也不会被最终重测覆盖。

- 最终完整 renderer/HTTP harness：459 项全部通过，跳过 0、unexpected 0、flaky 0，
  实际约 13.7 分钟。报告：`build/recovery-ui-final.json`；失败证据保留在首轮目录。
  包含新恢复用例、MPV 提示、截图、快捷键、全屏、片单、文件管理及深浅色 UI。
  测试按正常鼠标和焦点交互执行，没有强制点击、自动测试重试或全局超时扩张。
- 最终真实 Electron 恢复/诊断导出复核通过：
  `build/route-recovery-avhub-route-recovery-FEfufW/acceptance.json`。本次启动约
  1,177 ms，同一视频元素/源保留、重载 0、八秒诊断 schema 2 导出成功，源哈希不变。
- 600 样本组合长测已完整运行 1,209.53 秒 / 105 轮，315 次解码预览；最终
  `completed:true`、`cleanExit:true`、`sourceUnchanged:true`，错误列表为空。
  报告：`build/desktop-usage-avhub-desktop-usage-qlXkqZ/soak.json`，构建
  `f5cd69f485a35491`。这是前述 schema 1 窗口策略，不追认为正常后台节流长测。
  异常重载 0、stalled 0、waiting 3；每次打开累计 5,809 帧 / 433 丢帧，包含开播，
  尚不能从该计数判断稳态丢帧。返回中位 99 ms、p95 1,339 ms、最大 14,582 ms，
  8 次超过一秒。renderer 工作集 150.7–449.1 MiB，GPU 进程 328.8–744.7 MiB；
  不是显存或零泄漏证明。
  结束时最近 512 条数据库操作中，串行锁等待最大约 10.31 秒，提交最大约 6.41 秒、
  关闭最大约 2.55 秒。与其他回归并行，不能据此确定全部原因；运行稳定性完成，
  响应性能仍有长尾，不能声称全面达标或已优化掉帧。
- 正常窗口策略 schema 2 短测完整结束：192 样本、129.63 秒 / 12 轮，正常退出、
  代表性生成源身份不变、错误 0。报告：
  `build/desktop-usage-avhub-desktop-usage-QRZnOv/soak.json`。实际确认后台节流、沙箱、
  contextIsolation 均为 true；本轮没有同时运行全量 renderer 回归。
  总计 656 帧 / 49 丢帧，就绪基线 51 帧 / 0 丢帧，后续播放段 605 帧 / 49 丢帧，
  waiting 0、重载 0，返回 67–108 ms。播放段从首次就绪开始，仍包含开播早段，
  不是持续稳态基准；但已说明不能把所有丢帧都归因于并行回归或就绪之前。
  该短测不能代替正常窗口策略的完整二十分钟验收。

- 后端 417 项执行成功，其中 1 项明确跳过；发布工具 7 项隔离 mock 回归通过。
  Chromium 诊断、进程诊断、原生控制队列及帮助契约回归通过。
- 首次 120 秒 / 192 样本预检完整结束，`completed:true`、`cleanExit:true`、
  `sourceUnchanged:true`。报告：`build/desktop-usage-avhub-desktop-usage-yyrIZn/soak.json`。
  这只是入口预检，不替代默认时长或真实高分辨率媒体验收。
- 前一次 600 样本长测仅有 446 秒 / 39 轮检查点，没有最终退出和源身份核对；
  报告：`build/desktop-usage-avhub-desktop-usage-SYGcKD/soak.json`。会话已不存在，
  中断原因未确认，不能据空错误列表认定完成或没有崩溃。
- 连播测试原先把等待续播选择与后续解码共用一次五秒轮询。失败追踪中，
  续播选择在约 2.5 秒才出现，媒体请求到测试结束仍未完成，未证明产品卡死。
  测试现分开等待用户选择与解码，且不在轮询中重复点击；新增受控延迟回归，
  不修改生产超时、播放参数或缓存提示。
- 完整 renderer 首轮 458 项中 451 通过、7 失败；不是全量通过。四项涉及上述
  阶段等待/缺失 locator 竞态、续播期间隐藏控件的可访问性查询、确认画质后未移回
  控制热区。另三项在保存或设置初始化尚未返回时触发五秒断言。保留追踪于
  `build/recovery-ui-results/`，没有跳过失败、强制点击、扩大全局超时或改生产提示。
  修正后新增一个受控延迟用例，最终整轮按 459 项重新执行并保存独立 JSON。
- 组合长测一次在返回时仍显示“正在保存”，五秒 DOM 断言失败。隔离库的慢操作
  记录显示提交 1.17–3.58 秒，另有提交加关闭合计约 3.96 秒；当时同时运行完整
  renderer 回归，尚不能判定单一根因或产品卡死。报告保留在
  `build/desktop-usage-avhub-desktop-usage-NVxJ2J/soak.json`，完整长测未通过。
  后续测试先验证点击之后的真实进度保存响应，再使用原五秒 UI 断言等待导航；
  记录完整 `returnMs` 及结束时的数据库耗时，不把慢提交当作快速返回，亦不放宽
  生产二十秒写入期限或降低 SQLite 持久化级别。
- 恢复测试一次尚未创建窗口便触发辅助函数的默认三十秒超时；桌面日志仅到
  `backend-start`，没有 `backend-ready`，不能算恢复功能失败或通过。失败报告位于
  `build/route-recovery-avhub-route-recovery-fruYu0/acceptance.json`。测试窗口等待现与
  应用既有四十五秒后端启动期限对齐，并单独记录实际启动耗时；不改变生产期限，
  更长的允许等待也不代表启动性能达标。

## 下一轮优先级

1. 数据库保存与初始化长尾：分开比较后台任务、优先级小写入、进度保存和连接关闭，
   核对真实响应、锁等待及提交耗时。先减少不必要的后台写入，不弱化同步持久化，
   不跳过保存成功校验，也不把“界面先返回”当作进度落盘更快。
2. 帧呈现：分别采集刚开播及连续播放的帧回调/间隔、掉帧、可见性和真实解码器，
   对照有无封面预览及重复开关。现有短片段不足以确定根因，不以降低画质、隐藏
   缓冲提示或删除开播掉帧计数代替优化。

本轮编译、功能回归和有边界的运行稳定性验证已经完成；上述性能问题仍未关闭。
版本保持不变，没有打包、推送源码/标签或更新已公开的下载文件。

后续保存去重、封面优先级零写入及帧呈现对照，见
[保存 I/O 与帧呈现专项](PLAYBACK-IO-AND-FRAME-ACCEPTANCE.md)。保留本页的原始长测
数据，不用后续较短样本覆盖二十分钟长测结论。
