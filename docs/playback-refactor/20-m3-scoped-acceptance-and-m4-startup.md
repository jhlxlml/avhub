# M3 限定验收与 M4 首帧同步

2026-10-27。接续 [19](19-m3-handoff-queue-and-application-soak.md)。

## M3 范围决定

在用户已批准的单屏 SDR、开发态、显式开关范围内，M3 软件功能验收通过，开始 M4。
依据第 18/19 批的实际画面、控件、源保护、故障及连续播放结果，以及本批新增的 32 次定向导航矩阵。
新路径仍默认关闭，发行包仍拒绝开放；不是完整物理 HDR/多屏或发行验收通过。

`build/render-app-navigation-8B4gGy/report.json`：32 次真实点击及 32 次完整退出，通过。
覆盖短窗口滚动、seek 后立即返回、纯净播放进退、等待目标实际交接再返回、仅等待媒体时钟再返回。
没有包装主进程方法、强制点击、放宽五秒失败期限或模拟退出；退出时逐项核对源保护、宿主及纹理引用。

单次 `render-app-controls-WLm2iV` 返回事件仍无法追溯根因。此前 20 轮重复及本批 32 组定向场景未复现，
没有建立持续、可复现的代码缺陷证据。因此将它由 M3 开发阻断项改列**发布前观察项**，不宣称已定位修复。
该判断不等于所有问题已消失；如果再次出现，必须利用下面的退出记录追踪，发行评审时仍需复核。

`NativePlayerLaunch.tsx` 增加最多 16 条的退出阶段记录与返回按钮等待状态，
区分等待打开、关闭会话、源已关闭、读取保存状态、切换引擎、导航及错误；不记录路径/标题。
记录只用于定位，不代替实际资源释放。`NativePlayerOverlay.tsx` 的 inline 标题只在纯净模式挂载，
避免初始空快照短暂套用独立窗口标题/拖动区域。稳定常态拖动区重叠假设未被证实，不将此改动当作原事件根因。
初次不成立的 DOM 探针保留于 `build/render-app-header-hit-qVgIxT/`，不算通过的回归证据。

## M4 第一批实现

`electron/src/renderPlayer.ts` 原来在创建 GPU 接收端后、首次交接前即向 libmpv 发送 play。
WebGPU 初始化期间媒体时钟和音频可以提前推进，而首个原生画面仍在等待消费者。

现在保持源暂停，直到第一幅实际解码画面完成 GPU 提交及引用释放确认、原生 ack 后，才按最新用户意图发送 play。
等待期间的 play 只保存意图；pause 可真实保持源暂停。原生实际 pause 属性不伪造，UI 用单独 playIntent 处理等待期间的快捷键。
没有保留旧画面冒充新帧，没有更改提示来伪装性能；无视频/音频重编码、尺寸/位深/色彩策略变化。

新增 `render-app-startup.mjs` 及 `render-startup-comparison.mjs` 实测并核查相同保留样本、相同 native runtime。
新增 `render-app-startup-intent.mjs` 用受控交接延迟验证意图竞态，真实读取 helper 时钟；该延迟测试**不是性能证据**。

## 实际对照

同一生成的 3840×2160、25fps SDR10 源，原 native 宿主/DLL 不变，两个独立应用数据目录各打开五次。
每组首开不是操作系统/显卡驱动缓存重置；只有一个每组首开、四个后续样本，不作普遍统计结论。

| 指标 | 原基线 | 候选 |
| --- | --- | --- |
| 每组首开：首次 GPU 交接时媒体时钟领先该帧 | 640 ms | 40 ms |
| 每组首开：VO 已观察计数 | 16 | 2 |
| 四个后续打开：VO 已观察计数 | 4 / 4 / 3 / 3 | 0 / 0 / 0 / 0 |
| 四个后续打开：首次交接耗时中位数 | 1053.96 ms | 882.80 ms |
| 解码丢帧计数 | 全部 0 | 全部 0 |

首次交接耗时同时包含探测、加载和 GPU 初始化；不能推断所有片源打开都快 171 ms。
40 ms 是该 25fps 样本一帧。时钟领先量不是物理音画同步证书；VO 计数不是精确解码帧总数。
候选仍有首开 2 次 VO 计数，不声称总丢帧为零。

原始报告：

- 基线 `build/render-app-startup-yyXows/report.json`，构建 `440af7b1a6a0c451`。
- 候选 `build/render-app-startup-fpqqBn/report.json`，构建 `1a1af6fbb6d6a1e4`。
- 保留源哈希及 runtime 一致性复核 `build/render-startup-comparison-qAy5HA/report.json`。
- 两组均在运行中断言副本哈希/mtime 不变；比较脚本另外明确标记为运行后保留副本哈希核查，没有倒填原始报告。

## 测试与命令

```powershell
npm run build
npm run build:electron
node electron/test/render-app-navigation.mjs
node electron/test/render-app-startup.mjs baseline 5  # 修改启动顺序前运行
node electron/test/render-app-startup.mjs candidate 5
node electron/test/render-startup-comparison.mjs build/render-app-startup-yyXows build/render-app-startup-fpqqBn
node electron/test/render-app-startup-intent.mjs
node electron/test/render-app-flow.mjs Precision-SDR10-3840x2160.mkv
node electron/test/render-app-controls.mjs
node electron/test/render-app-queue.mjs
node electron/test/render-app-faults.mjs
node electron/test/render-app-soak.mjs 20
npx playwright test tests/ui/native-player-controls.spec.ts tests/ui/native-launch-lifecycle.spec.ts tests/ui/native-runtime-settings.spec.ts --workers=1
node electron/test/native-app-flow.mjs
```

baseline 标签不自动切换代码版本，应先保存旧构建再修改，不能用新代码冒充基线。
构建及上述实际 Electron 测试通过；组件 harness **34 通过**，单独归类，不能替代桌面画面验收。
服务关闭期间有既有 Proactor ConnectionResetError 10054 日志，未造成测试失败。

| 实际报告 | 结果 |
| --- | --- |
| `render-app-startup-intent-Q6oqGM` | 交接等待中的暂停/播放/再暂停，实际源时钟保持暂停，首帧后保持暂停，显式播放后推进 |
| `render-app-flow-QylKvc` | 五目标像素跳转、播放中 seek、3840×2160/16-bit PNG、缩放/旋转/全屏/纯净播放 |
| `render-app-controls-HKlzeJ` | 音轨字幕、记忆与暂停双向交接、WASAPI 实际参数 |
| `render-app-queue-Q5DWkC` | 快速切换、立即离开、自然连播及单曲循环 |
| `render-app-faults-5sMdTl` | 实际进程/GPU/加载故障、源异常/HDR 拒绝与释放闭环 |
| `render-app-soak-7CFXaN` | 候选 20 秒健康预检；不是候选十五分钟验收 |
| `native-app-flow-TQ0JNF` | 旧播放路径真实应用回归通过 |

上表路径均在 `build/<名称>/report.json`；旧路径为 `acceptance.json`。
第 19 批 900 秒报告保留为旧构建证据，**不改写为当前候选的长测**。

## M4 后续与回退

M4 尚未整体完成：需进一步分解首帧耗时，同条件对照原画 direct/indexed-ts/indexed-remux/MPV seek，
补齐诊断字段及 native/GPU/I/O 观测，并对最终候选重复长时验收；有实际收益才改调度或 auto。
本批不改变默认选择策略。M5 再分发、许可、成品与实体显示待验收项不提前认定完成。

退出观察项继续保留，测试样本/数据均在 build 内，未访问 E:\downloads。
关闭 D3D11 试验或选现有播放器可立即绕回新链路，不需要迁移数据或改写媒体。
版本保持 0.2.16，未打包、提交、推送或发布。
