# MPV 进度条指针提交修复

日期：2026-11-08。版本仍为 0.2.19；HEAD 为 f3f65dbc321b54541f09be6b1558fb9e4f5eab27。本轮未提交、推送或打包。前端构建标识：d9a1cdc125237411。

## 问题与证据

`frontend/src/NativePlayerOverlay.tsx` 的 pointerdown 原来把 range 当前值直接记为待提交目标；pointerup 即使没有发生 input，也会调用 seek。原地按下并松开滑块，因此多发一次真实跳播。range 的 0.01 秒步长还可能对实际帧时间取整，快速模式下可能改变关键帧落点。

真实 Electron 修复前报告 `build/render-playback-intent-RfVh9G/report.json`：FAIL，退出码 1。鼠标确实没有产生 input，但 seekId 从 1 变成 2，触发 stationary-thumb 断言。这不是仅靠推测或模拟状态得出的结论。

## 修改

- pointerdown 清空待提交目标，只在真正的 input 发生时记录目标。
- pointerup 仅在有新目标时提交，保留已有的取消指针、快捷键和单次提交逻辑。
- 不改解码、渲染确认、加载提示、画质或快速/精确模式策略。

这是消除多余 seek，不是声称已经缩短解码耗时。未重新给出性能百分比。

## 验收

`electron/test/render-playback-intent.mjs` 增加真实鼠标操作断言：原地按下松开没有 input、没有新 seek；点击轨道正常提交；实际拖动过程中不提交，松手提交最终 input 位置，随后原生 change 不重复提交；之后空格恢复真实播放时钟。

| 检查 | 结果 | 退出码 | 证据 |
| --- | --- | --- | --- |
| 前端 TypeScript/Vite 构建 | PASS | 0 | `npm run build` |
| Electron TypeScript 构建 | PASS | 0 | `npm run build:electron` |
| 真实 Electron、用户 HDR MKV | PASS | 0 | `build/render-playback-intent-JxGGyF/report.json` |
| 真实 Electron、生成 MP4 | PASS | 0 | `build/render-playback-intent-HMydCF/report.json` |
| 差异空白检查 | PASS | 0 | `git diff --check`，仅已有 CRLF 提示 |

HDR MKV 点击目标 42 秒、实际 42.009 秒；拖动目标 46 秒、实际 45.996 秒。两次操作使用精确模式验证目标提交。原地松开在快速模式验证，seekId 保持 1，位置保持约 38.005 秒。测试也覆盖快速暂停切换、连续音量输入、暂停跳播、片尾重播和片尾选择位置后恢复。源文件 SHA256 与 mtime 前后相同；诊断 sourceLoads 为 1，hwdec 为 d3d11va。

本轮使用既有 `render-replayed-candidate-Oyu11n`，未修改原生宿主。HDR 文件用于输入和真实帧链路回归；当前 SDR 会话结果不等于实体 HDR 显示验收。未测试外机和双屏，本轮没有更改它们的验收结论。

## 回滚

若需单独撤销本轮，可恢复 pointerdown 记录当前 range 值，以及 finishTimeline 的原目标回退及无条件 commit 分支；相应移除新增指针测试。不要整体还原该文件，以免丢失此前暂停、音量等未提交修复。
