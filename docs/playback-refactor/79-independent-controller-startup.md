# 独立 MPV 控制栏偶发启动失败调查

日期 2026-11-08。承接 [78-render-seek-property-waits.md](78-render-seek-property-waits.md)。版本保持 0.2.19；不打包、不提交、不推送。

## 问题与源码边界

之前配对报告 build/mpv-seek-paired-2LezdC/report.json 中，MP4 正常退出后打开 TS 报“独立播放控制栏初始化失败”。electron/src/independentPlayer.ts 在 MPV start 返回后，最多等待 2 秒查询 user-data/avhub-ui/version；independentController.ts 只在存在有效 OSD 布局且执行实际 overlay 更新后写入 version=1。该标记是控制栏初始化证据，不能代替首帧呈现。

失败发生时尚无 MPV 详细日志。没有证据证明是 Lua 崩溃、OSD 尚未建立或主机调度导致。保持为偶发未定位项，未延长超时、跳过控制栏就绪验证或吞掉错误。已有生产日志 native-controls-startup 可记录下一次失败的 ready、elapsed_ms 和 phase，不记录路径或标题。

## 可执行回归

新增 `node electron/test/mpv-independent-reopen.mjs [次数]`，默认 18 次，范围 3–90。使用真实 Electron，复制应用所有的 MP4/4K HEVC MKV 合成样本，并在隔离 build 目录生成含音轨的 H.264 TS。每次从媒体库打开独立 MPV、等待真实 MPV ready、读取实际控制栏布局/version、暂停、通过 Lua seek-relative 执行一次跳播，再返回媒体库。最终校验三份测试媒体 SHA256 不变。每个进程的 MPV 详细日志只保存于隔离测试目录，不改变产品默认日志。

| 执行 | 结果 | 退出码 | 报告 |
| --- | --- | --- | --- |
| 默认 18 次，三格式各 6 次 | PASS | 0 | build/mpv-independent-reopen-MRD6lm/report.json |
| 60 次，三格式各 20 次 | PASS | 0 | build/mpv-independent-reopen-ogMPbM/report.json |

额外复核两份报告的全部 78 行：控制栏包含正尺寸播放按钮，暂停跳播后仍暂停，策略为 exact，sourceLoads=1。每行均有对应 ready=true 的启动诊断。

- MRD6lm: 18 opens; control wait min/median/max 0/0/348 ms
- ogMPbM: 60 opens; control wait min/median/max 0/0/350 ms

ui_wait 只计算 MPV start 返回后等待控制器版本的时间，不等于点击到视频首帧总耗时。部分启动快照尚无硬解字段，本轮不以该字段作硬解覆盖率结论，保留逐次原始状态和日志。测试通过 Lua 消息执行控件，不声称 OS 键鼠、物理屏幕扫描或 PotPlayer 同条件端到端性能。当前 SDR 会话不能补充物理 HDR、多屏或外机验收。

结论为 78 次开关未再复现，不能宣称偶发问题根因已修复。下一次失败应保留启动诊断与对应 MPV 日志，再决定是否修正脚本事件/窗口就绪逻辑；不凭一次偶发直接增加固定延时或自动重试。

本轮仅新增回归脚本和调查记录，无生产播放行为调整。回滚可移除该脚本及文档。git diff --check 退出码 0。


## 后续源码修复与因果验收

上述为修复前调查记录。本轮已直接修改生产源码，不再停留于重复重跑。

1. independentController.ts 的首次 render 在 OSD 尺寸无效时原来直接返回，只能依赖后续外部事件；若启动事件都发生在 OSD 有效之前，无法保证再次绘制。现在仅在首次就绪前每 100 ms 尝试真实布局与 overlay 绘制；version=1 仍在实际 overlay update 之后写入。就绪后不增加常驻重试，关闭时仍取消 pending timer。
2. independentPlayer.ts 原来无论视频是否还处于 starting，都仅给控制器 2 秒。现在 while starting 使用有界 30 秒源启动预算；一旦视频进入非 starting 状态，控制栏只保留 2 秒收尾窗口，总期限仍不超过上述启动预算。已就绪的控制器立即返回，不加固定延时。MPV 进入 error/closed 时立即停止等待，并保留原始错误，而非覆盖为控制栏错误。没有跳过音视频/控制器就绪校验。

### 受控复现，非性能结论

`node electron/test/mpv-independent-reopen.mjs 3 --delayed-layout` 在隔离的实际 MPV Lua 控制器中暂缓 OSD 尺寸，并通过 on_preloaded hook 延迟真实加载 3 秒。没有伪造 time-pos、playback-restart、版本或帧呈现；这是故障时序回归，不代表自然发生频率或实际播放速度。

- 修复前：build/mpv-independent-reopen-oPE4D2/report.json FAIL，退出码 1。日志 ready=false、elapsed_ms=2008、phase=starting，页面同样出现独立控制栏初始化失败。
- 修复后：build/mpv-independent-reopen-DxTxCu/report.json PASS，退出码 0，三种格式均完成真实布局、解码就绪、暂停跳播和关闭。控制栏就绪等待分别为 2908、2904、2947 ms，视频尚未就绪时没有被错误关闭。

### 本机真实视频

`node electron/test/mpv-independent-reopen.mjs 6 --real-media` 使用只读复制的 E:/downloads/The World in HDR in 4K (ULTRA HD).mkv，以及生成 TS/4K HEVC，三种格式各两次。build/mpv-independent-reopen-OGE8vH/report.json PASS，退出码 0，原 HDR 文件 SHA256 与 mtime 前后一致。控制器额外等待 0–351 ms，没有新增固定等待。当前 SDR 会话仅证明真实 HDR 编码片源可播放与跳播，不是物理 HDR 色彩输出验收。

前端构建、Electron 编译、独立会话协调测试 PASS，退出码均为 0，构建标识 312b0dc3a770b0a5。未改动 libmpv/native render 宿主，无需替换或重新编译原生 DLL。画质、引擎默认值、原生输入路径与截图设置保持现状。

本轮已修复有可重复因果证据的启动时序缺陷；历史那次自然偶发是否全部由此导致仍不能完全证明，不能外推为所有硬件环境均不再发生。出现其他失败时继续使用已保留的结构化日志定位。回滚本轮生产改动可恢复独立控制器初始化 render 及 IndependentPlayer 控制器等待块，保留其他尚未提交功能不动。

独立 MPV 实际应用交互回归 native-independent-dvYwWb PASS，退出码 0，覆盖原生输入、截图、全屏进退与退出。git diff --check 退出码 0。本轮未打包、升级版本或推送。
