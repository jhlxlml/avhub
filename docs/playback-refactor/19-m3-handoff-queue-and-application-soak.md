# M3：回退、队列及真实应用连续验收

> 后续 32 组定向退出、M3 限定验收决定及 M4 首帧同步见 [20](20-m3-scoped-acceptance-and-m4-startup.md)。本页保留上一批判断，不将未定位事件追写为已修复。

2026-10-26，接续 [18](18-m3-application-render-bridge.md)。主要功能和本批长时检查已补齐；
仍保留一次未定位的返回异常，**M3 不整体标记完成，M4/M5 未开始**。

## 变更与回退边界

`Player.tsx`、`NativePlayerLaunch.tsx`、`playback/nativeRecovery.ts` 增加同一视频最多一次的返回预算。
仅显式 HTML5 → D3D11 试验切换的已识别宿主/运行库初始化错误可自动返回；先完成保存、退出及资源清理，
再恢复进度和暂停意图并提示。文件丢失/损坏、未知错误、保存或清理失败不触发自动切换。
默认 MPV 打开和运行中异常仍提供显式重试/切换。没有启用有损转换权限或改变默认引擎。

新增实际 Electron 测试 `render-app-handoff.mjs`、`render-app-queue.mjs`、`render-app-soak.mjs`、
`render-app-window.mjs`，扩展 flow 的竖屏样本、faults 的真实 HDR 拒绝、controls 的 WASAPI 和退出时序观测。
controls 已自行生成双音轨/字幕样本，去掉旧随机临时目录依赖。计时包装可用 `AVHUB_TEST_RENDER_TIMINGS=0` 禁用。

## 命令与结果

```powershell
npm run build
npm run build:electron
node --test electron/test/native-recovery.test.mjs
npx playwright test tests/ui/native-player-controls.spec.ts tests/ui/native-launch-lifecycle.spec.ts tests/ui/native-runtime-settings.spec.ts --workers=1
node electron/test/render-app-handoff.mjs
node electron/test/render-app-queue.mjs
node electron/test/render-app-flow.mjs Precision-SDR10-2160x3840.mkv
node electron/test/render-app-controls.mjs
node electron/test/render-app-faults.mjs
node electron/test/render-app-window.mjs
node electron/test/render-app-soak.mjs 900
```

前提是 M2 固定生成样本及 long-run 样本、已编译宿主和校验过的 DLL/FFI；缺少时应失败，不以用户视频替代。
构建及错误分类单测 2 项通过。组件 harness 34 项通过，只证明 UI/生命周期，不算桌面解码或物理显示。
后端本批未修改，未重复第 18 批完整后端测试。

| 实际 Electron 验收 | `build/` 下报告 |
| --- | --- |
| 首次返回保持暂停/位置、第二次不循环、手动重试与默认引擎不变 | `render-app-faults-handoff-XADaQN/report.json` |
| 12 次切换、3 次立即返回、自然顺序连播、单曲循环不重载源 | `render-app-queue-X8nHEv/report.json` |
| 竖屏五个目标帧像素命中、2160×3840/16-bit PNG、旋转/缩放/全屏/纯净播放 | `render-app-flow-2T6CoD/report.json` |
| 双音轨/字幕、外观/延迟/倍速及记忆恢复 | `render-app-controls-ibtRPs/report.json` 及下述复测 |
| 重载、进程/DLL/初始化失败、真实当前 GPU 设备丢失、锁定/源变化/删除、实际 PQ10 拒绝与释放闭环 | `render-app-faults-pjSfLm/report.json` |
| 实际最小化 7 秒再恢复，隐藏期间不强制探针渲染，同一会话继续且可返回 | `render-app-window-7PZwjz/report.json` |
| 最终构建健康预检 20 秒，不代替长测 | `render-app-soak-KGqg11/report.json` |

音频输入为 48kHz 单声道 AAC，实际 WASAPI 端点输出为 44.1kHz 双声道 float。
分别核查源和设备参数，没有改系统声音设置或建立编码音频转码链路。
静音测试不证明可听声音、bit-perfect 输出或主观音画同步。HDR 拒绝不算 HDR 显示验收。

## 十五分钟应用结果

`build/render-app-soak-PvEjeO/report.json` 及 `checkpoints.jsonl`：

- 实际 AVHub 连续采样 **900,173.6 ms，391 次**；960 秒时间轴来自生成六秒 4K25 SDR10 内容重复封装，非独特长电影。
- 实际 compositor 像素码推进/墙钟 **0.99997786**；采样间隔小于五秒，避免六秒码周期歧义。
- 解码丢帧开始/结束均 0；VO 开始/结束均 **16**，测量段增量 **0**，预算 22。
  启动已有的 16 次仍保留，不能抹掉或声称总丢帧为零。
- 首次 GPU 完成/释放交接约 **1,654 ms**，基线位置约 0.76 秒，提示首帧阶段还有优化空间。
- 后段 Electron 聚合 privateBytes 范围 **44,864 KiB**，低于预设 256 MiB；排除外部宿主，不代表全量 native/GPU 内存。
- 关闭后纹理导入/释放/GPU 完成均 **22,524**，句柄租约 **1/1**；宿主退出及源 lease 释放通过。
  交接次数不冒充精确解码帧数；测试副本哈希/mtime 断言通过，不是物理扫描输出认证。

长测构建为 **4c544bd80123d21f**；最终 **8d3c89cf3b33b9ad** 仅进一步收紧前端失败返回分类，
健康渲染、宿主、GPU 桥及 preload 没有因此改变。最终构建做了真实回退、控件/音频、故障及短时播放复测。
没有把旧报告改写为最终构建的相同二进制 cohort。
宿主 SHA 为 `8bc8bf41bb5d0ea24f6d95c5657cbbd411386b8ab606a06f2b09ab2b25df5dd5`，
DLL SHA 为 `ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74`。

## 保留的返回异常

`build/render-app-controls-WLm2iV/report.json` 在暂停 seek 后点击返回，五秒内未出现媒体库。
现场还在播放页，源暂停于四秒，保存错误为空，已观察纹理 25/25 释放；随后退出可正常回收。
该现场没有点击及关闭分段记录，不能判断是关闭挂起、点击未投递或其他原因；没有通过调大超时冒充修复。

补充观测后 **12 轮带计时、8 轮无计时包装均通过**；计时 48 次 close 为 **97.6–514.3 ms**。
以下后缀均对应 `build/render-app-controls-<后缀>/report.json`：

```text
计时：ibtRPs bIarNZ q51Lfv mo6VsJ LFOuR2 bTkOTn mnYSnF Y7A46V F2sWwI 67lKnL rqTt4e CxEFUi
无包装：So4xy9 vhn8PR bN9ons aweaWg TWfbdM UbWlgS hMjI2Z PO1ZO1
```

报告包含实际点击记录，失败还记录焦点。最小化恢复也通过；**未复现不等同于已定位修复**。
M3 剩余项为对此异常的定向追踪：区分 UI 意图是否收到、关闭是否开始及等待阶段，避免无证据反复或弱化断言。
其他测试自身问题的失败报告也保留，包括错误滑块名称、隐藏控件点击、异步导航断言过早、音频采样率错误写死。

解决最后观察项后才推进 M4：首先验证首次 GPU 就绪前的时钟/VO 行为，再同源同构建比较原画首帧/seek，
补齐原生内存/显存/I/O 和未知诊断字段；不凭提示框或旧数字改 auto。
物理 HDR/混合 DPI 多屏继续按用户决定待办，发行与许可属于 M5。
关闭 D3D11 试验或改现有播放器可回退，无数据格式/源文件变更。
本批仅操作 `build/` 新样本，未访问 `E:\downloads`。版本仍 0.2.16，未打包、提交、推送或发布。
