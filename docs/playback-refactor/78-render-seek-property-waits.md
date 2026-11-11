# 内嵌 MPV 同步属性等待排查

## 范围和直接证据

基于 76、77 的本地工作区，版本保持 0.2.19。继续排查内嵌 MPV 的约 200 ms 等待。此轮实际显示查询为单屏 SDR，不能沿用以前双屏 HDR 的显示结论。

固定发行同系 libmpv 的本机源码 video/out/vo_libmpv.c 中，flip_page 设有 200 ms 等待，以缓解 VO 与宿主线程间互相等待。当前直接测得的证据是同步 mpv_get_property 的耗时，未抓到对应超时日志，不能据此断定每次都触发了该分支。

通过显式 AVHUB_NATIVE_SEEK_TRACE=1 采集有界、无文件路径的原生调用诊断。默认不启用。每次用户跳播重置，保留最近 64 个大于等于 20 ms 的调用和受限超时标记。没有绕过调用，也没有提前确认 GPU 完成。

初始同机报告 mpv-seek-paired-k1oRFy 中，72 条配对记录包含 44 次慢 video-params 读取，典型耗时 190–206 ms。仅把 video-params 改成事件后，同样的阻塞转移到了 time-pos，样例为 197–198 ms（mpv-seek-paired-AJJSVq）。后者还因测试误点击自动隐藏的控件而退出 1，测试已改走 77 新增的可见设置入口。

## 改动

- 用 libmpv property-change 观察 video-params、time-pos、seeking、pause、container-fps，复制有界的事件数据。事件内存仍归 libmpv 管理，宿主不释放借用节点。
- Frame 发布热路径使用这些实际观察到的元数据，先退回已过期的未发布帧，再检查几何。保留原尺寸纹理、色彩处理、串行 GPU 读者释放和实际 GPU 回执。
- 精确跳播在 libmpv seek 事件时进一步淘汰旧帧，快速模式保留 restart 后的新帧代次。观察状态本身不算呈现。
- 在 restart 后、当前代次已经渲染的完成候选上，仍读取真实 time-pos，避免把请求时间误当成关键帧实际落点。状态快照也保留真实 time-pos 和 pause 读取。
- 不改硬件解码、视频同步参数、Render API 等待参数或时间精度。独立 MPV EXE 的解码链路不变。

## 中间方案与限制

全量改用观察时间的中间方案虽通过旧测试，但在真实 HDR 对照中发现，关键帧跳转后的 time-pos 事件可能仍携带请求目标。例如目标 5 秒，事件报告 5 秒，而实际关键帧应为 0 秒。hdr-real-media-yLsscL 的相关快速落点不能作为正确性能证据。此问题已促成上面的完成候选真实位置读取，并增加独立关键帧像素测试，不扩大容差。

旧宿主同机短 GOP 4K HEVC 40 次像素验证为中位数 69.35 ms、P95 117.30 ms（render-codec-seek-AVah4Q）。中间方案为 77.75 / 119.90 ms（render-codec-seek-1jwhab），不能称为短 GOP 全面提速。11 月 4 日的旧屏幕环境数据不能代替此轮同机基线。

## 执行与回滚

使用既有 scripts/build-native-render.mjs 编译，scripts/stage-selfbuilt-render-runtime.mjs --replayed 生成有原始源码哈希与运行库哈希校验的本地候选。测试运行在真实 Electron。

关键回归包括 render-codec-seek 的 40 次精确像素帧码和新增关键帧实际落点像素检查、render-ass-seek 的暂停字幕与 20 次跳播、mpv-seek-paired 的连续相对跳播、远跳、暂停与播放、H.264 MP4/TS、4K HEVC MKV。真实 HDR 源仅作只读检查，复制件在 build 隔离目录内。

回滚应仅撤销本轮原生事件观察与帧发布调整，重新编译宿主并重建对应运行库清单，保留 76、77 的设置和用户原有工作区改动。不能混用不同源码清单与宿主。

## 最终候选验收与收益

最终本地候选为 render-replayed-candidate-GySVOi。以下对照以同机旧宿主 mbRTny 为基线，均使用同一固定 libmpv DLL、真实 Electron 和相同目标列表。格式矩阵开启了同样的有界诊断；未清空 OS/驱动缓存，不代表冷盘读取。每格 12 次，暂停与播放各 6 次；P95 为本轮小样本统计。

| 场景 | 旧中位数 / P95 | 新中位数 / P95 |
| --- | ---: | ---: |
| 长 GOP H.264 MP4 精确 | 112.14 / 354.18 ms | 112.69 / 133.93 ms |
| H.264 TS 精确 | 38.26 / 263.82 ms | 35.94 / 69.13 ms |
| 长 4K HEVC MKV 精确 | 231.10 / 269.32 ms | 55.66 / 74.93 ms |
| 长 4K HEVC MKV 关键帧 | 231.58 / 455.69 ms | 74.97 / 102.74 ms |

旧报告 mpv-seek-paired-k1oRFy、新报告 mpv-seek-paired-BnLGHa 均退出码 0。最终矩阵的受限原生调用记录里未再出现大于等于 20 ms 的同步属性读取，仍观察到正常 Render API 渲染耗时。这是对测量窗口的描述，不保证所有文件与设备都不会阻塞。

独立短 GOP 4K 像素测试 render-codec-seek-br15og 退出码 0，40 次精确跳播为 82.40 / 109.10 ms；同机旧版为 69.35 / 117.30 ms。短 GOP 中位数增加约 13 ms，P95 小幅改善，不能称为该场景整体提速。测试新增关键帧像素检查，目标 1.72 秒实际 0 秒且像素帧码 0，目标 4.68 秒实际 4 秒且帧码 100，匹配 25 fps 时间轴。

真实 HDR 源的最终配对报告 hdr-real-media-SlRWHM/seek-pair.json 退出码 0，原始文件 SHA256 前后一致。精确跳到 5、38、73 秒分别约 487–490、375–376、158–174 ms；关键帧分别实际落在 0、35.302、71.972 秒，GPU 回执约 33–48 ms。精确解码等待仍然存在，不能用这轮元数据改造宣称任意位置瞬时精确跳转。

原生宿主编译、候选 staging 及 MPV Client 回归退出码均为 0；27 项适配器/会话/恢复时钟合约通过，退出码 0。暂停复杂 ASS 字幕与 20 次像素跳播回归 render-ass-seek-IVnKqa 通过，退出码 0。本轮未进行打包或远程操作。

最终候选继续通过真实 Electron 窗口最小化恢复（render-app-window-CLGYFy）、真实 HDR 文件 15 秒连续播放及退出（hdr-real-media-3ber5O）、两种 MPV 模式的默认设置/重开/入口（mpv-seek-settings-TUTmvs），退出码均为 0。开发启动 --check 确认复用本轮 GySVOi 候选，退出码 0。HDR 文件在当前 SDR 显示环境中验收，不能据此宣称物理 HDR 输出或外机验证。


## 2026-11-08 连续操作边界回归

本轮保留 GySVOi 原生实现，未再修改生产播放代码。扩展 `electron/test/mpv-seek-paired.mjs`，在播放和暂停两种状态同步提交 31.4 → 7.4 → 23.4 秒三个快速请求，验证最后目标完成、关键帧策略及真实偏差、暂停状态保持、源加载次数为 1。内嵌完成必须有 GPU 回执；独立 EXE 的 frameMs 必须为 null，不能冒充 compositor 呈现。原有精确连续快进快退、远跳、暂停智能模式回归继续执行。

使用 AVHUB_MPV_LONG_GOP_TS=1，将合成 H.264 TS 关键帧间隔从 2 秒增加到 8 秒，MP4 同为 8 秒；4K HEVC MKV 使用原有应用所有的合成重复内容。全部是生成样本，不是新真实片源验收。当前机器 SDR 会话，本轮不证明物理 HDR、多屏或外机结果。

| 真实 Electron 回归 | 结果 | 退出码 | 报告 |
| --- | --- | --- | --- |
| 内嵌，三格式精确/快速配对共 72 次，加连续、远跳与暂停智能回归 | PASS | 0 | build/mpv-seek-paired-F6AjTj/report.json |
| 独立 EXE，同样矩阵及原生 Lua 相对跳播 | PASS | 0 | build/mpv-seek-paired-Jty9zF/report.json |
| 首帧前连续播放/暂停意图，释放真实呈现后核对时钟及继续播放 | PASS | 0 | build/render-app-startup-intent-5645sD/report.json |

本轮快速连续请求的内嵌队列等待 0.10–0.50 ms，最终请求确认 26.7–100.8 ms；独立 EXE 队列等待 0.13–1.50 ms，确认 7.0–238.4 ms。独立 EXE 确认是 MPV 状态证据，不是物理首帧时间，不能直接与内嵌 GPU 回执等同。测试通过 Electron overlay DOM 输入与可信 native action/Lua 控件触发，不测 OS 鼠标输入耗时。

8 秒 GOP 的快速模式目标 23.4 秒实际约 16 秒，偏差约 -7.4 秒，保留为真实结果而非精确成功。现有 MpvSeekEvidence 已拒绝大于 2 秒偏差的观测以优先选择精确策略，暂停智能模式保持精确。本轮未为了减少偏差偷偷补发精确跳播；用户明确选择快速模式时仍应接受实际关键帧落点。长 GOP 下要求精准落点需使用精确模式。

第一次启动测试 FAIL，退出码 1，报告 build/mpv-seek-paired-PiUhm3/report.json。原因是测试命令错误地把绝对路径传给仅接受候选名称的环境变量，应用正确拒绝“无效原生运行库测试目录”，未进入播放测量。改用 render-replayed-candidate-GySVOi 后完成上述正式回归，未放宽路径或哈希校验。git diff --check 退出码 0。

本轮不打包、不升级版本、不提交、不推送。回滚本轮仅需移除新增 fastBursts 测试块与本节记录，不涉及生产行为。


## 2026-11-08 智能模式真实策略回归

继续扩展同一配对脚本，验证暂停智能跳播之后恢复播放，并在已经观察到大于 2 秒关键帧偏差的 8 秒 GOP MP4/TS 上执行远跳，要求策略恢复 exact。随后三种格式均执行短距前进/后退，要求 exact、落点在现有精确容差内、sourceLoads=1。本轮未修改生产实现，未降低默认精确定位、硬件解码或原始画质。

真实 Electron 双路径完整配对矩阵及新增策略断言 PASS，退出码 0，报告 build/mpv-seek-paired-XOtUnM/report.json。包含两引擎、三格式，每组合 24 次精确/快速配对、连续跳播、暂停智能、播放中短跳，MP4/TS 再验证大偏差恢复精确，4K HEVC 保留远跳。MPV Client 队列/策略/超时等合约回归 PASS，退出码 0。合成片源与本机 SDR 范围同上，不作为新增真实 HDR 片源、物理显示或外机结论。

首轮新增断言 FAIL，退出码 1，报告 build/mpv-seek-paired-UavGwA/report.json。应用实际已在 36.55 ms 完成 exact 跳播，目标 26.43 秒、实际 26.4667 秒、无错误且源加载一次；测试按未量化的当前时间减 5 秒比较，忽略 HTML range 的 step=0.01，导致误报等待超时。修复测试目标按百分之一秒取整后上述矩阵通过，未放宽生产跳播成功标准或隐藏错误。

本轮结论是智能策略边界在已测样本上符合预期，不是新一次性能提速。现有默认仍为精确模式；用户可在媒体库设置的播放偏好中自行选择。未进行构建产物打包、版本变更或远程操作。


## 2026-11-08 独立窗口原生控件链路与启动诊断

新增真实 Lua seek-relative -15 秒回归，覆盖播放中 MP4/长 GOP TS 的智能大偏差反馈。要求原生控件执行 exact，实际误差不超过既有 0.51 秒容差，queueMs=null，源只加载一次。这里测的是 MPV 原生脚本输入，不是 OS 键盘/鼠标端到端延迟。主进程动作与 Lua 原生动作分别验证，避免只验证其中一条。

初轮 build/mpv-seek-paired-2LezdC/report.json 退出码 1。MP4 的原生智能快退已通过，但随后打开 TS 时报告“独立播放控制栏初始化失败”，后续矩阵没有完成。此次未采集 MPV 详细日志，不能确定是脚本、输出建立还是调度原因。保留为偶发未定位项，不能把重跑 PASS 当成修复。

配对测试现为每次 MPV 启动在其隔离 build 目录保存 mpv-N.log。日志仅用于生成样本调试，不进入产品默认日志，也不采集原始用户媒体；额外日志 I/O 意味着本轮不宜当作严格前后性能对比。带日志复测 build/mpv-seek-paired-SeS7YC/report.json PASS，退出码 0，两种格式的原生智能 -15 秒快退均精确，TS 控制器版本约在进程启动 168 ms 写入，未复现首轮失败。

生产源码 electron/src/independentPlayer.ts 新增每个独立会话一次 native-controls-startup 诊断，包含 ready、elapsed_ms、phase，不包含标题、源路径或设备 ID；未改变 2 秒控制器就绪期限、重试、解码或错误回退。这样再次发生失败时可直接区分等待控制器的时间和当时 MPV 播放阶段。Electron TypeScript 构建与独立会话协调测试均 PASS，退出码 0。


新增诊断后的最终真实 Electron 独立窗口完整矩阵 build/mpv-seek-paired-CoxXxn/report.json PASS，退出码 0。MP4/TS 的 Lua 原生智能快退、短跳和既有连续跳播均通过；desktop.log 已记录三次 native-controls-startup，均 ready=true。该结果验证新日志可用，但偶发控制器初始化失败仍未证明根因或修复，不列为已解决问题。

构建验收期间另一次 build/mpv-seek-paired-21NoCX/report.json FAIL，退出码 1，原因是仅重编 Electron 后服务自动使用新源码指纹，而前端静态构建仍是旧指纹，应用正确拒绝启动。执行 npm run build 与 npm run build:electron 同步构建标识 bc95704ec575d805 后完成最终验收，未禁用版本/哈希校验。两次构建退出码均为 0；前端既有 Vite 配置与 chunk 大小提示保留为非阻断 warning。本轮不打包、不提交或发布。
