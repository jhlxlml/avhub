# MPV 连续定位：真实应用性能对照

## 实施与参考

本轮构建 `8e01e170ffca5362`，版本未增加，未打包或推送。

- 连续定位只等待上一条指令 ACK，合并为最新目标，不再等待过时目标完成解码。指令确认仍不等于定位成功；成功必须经过 `playback-restart` 与实际时间戳校验。
- 官方可写 `time-pos` 属性使用绝对定位队列，避免普通 `seek` 输入指令的连续操作延迟。显式设置 `--hr-seek=yes`，保持精确定位；纠偏、超时、暂停状态、文件保护不撤销。
- 没有添加固定 33ms 合并延时，没有改用关键帧粗略定位，没有改动解码画质、分辨率、位深、色彩或 HDR 参数。
- 启动时并行读取媒体占用预约、设置与播放记忆。保留原来的失败取消 tombstone 和进程退出确认；尚未保留或复用解码进程。

参考而非搬运：

- [MPV 输入指令与属性处理](https://github.com/mpv-player/mpv/blob/master/player/command.c)：普通 `seek` 带延迟标记，`time-pos` 属性写入走绝对定位队列。
- [MPV 连续定位队列](https://github.com/mpv-player/mpv/blob/master/player/playloop.c)：内部会合并请求，输入指令还有中间帧等待策略，外层不宜再等待每个过时目标。
- [IINA PlayerCore](https://github.com/iina/iina/blob/develop/iina/PlayerCore.swift)：定位意图直接交给播放引擎并区分定位模式。没有采用它根据耗时自动放宽定位精度的策略。
- [MPV 属性与精确定位手册](https://mpv.io/manual/stable/#options-hr-seek)：精确定位仍需从关键帧解码，不能承诺每个高分辨率长 GOP 文件都瞬时完成。

## 对照方法

新增 `electron/test/native-app-performance.mjs`。只读复制索引到隔离目录，清空目录文件变更权限；从可见 Electron 的媒体库封面进入，通过实际按钮、滑块和渲染器按键输入进行定位，不使用直接 native open/seek 调用替代 UI 验收。

三个真实样本各重复打开三次；暂停点击三个远距离位置，再以 40ms 间隔连续快进三次，每次 5 秒。检查最终实际时间戳、首帧、真实硬解、源加载次数、缓存暂停和源文件大小/修改时间。

这不是物理按键到显示器光子延迟，也不是冷盘、统计学或多机器基准。进度时间不能单独证明已解码，定位完成仍依赖客户端真实重启帧事件及查询校验。

### 完整基线 → 最终生产方案

| 实际样本 | 连续快进最后一次意图至目标帧确认，中位数 | 单次点击定位，中位数 | 打开至首帧可确认，中位数 |
| --- | --- | --- | --- |
| 4K VP9 MKV，ID 1 | 192 → 71 ms | 305 → 305 ms | 843 → 868 ms |
| 4K H.264 TS，ID 62 | 162 → 69 ms | 47 → 48 ms | 838 → 832 ms |
| 4K AV1 MP4，ID 2358 | 225 → 111 ms | 173 → 171 ms | 845 → 797 ms |

“最后一次意图”不是整个按键序列的耗时。首个键至最终帧确认，中位数分别约 309→199、278→202、341→218 ms。打开耗时变化小、没有稳定收益证据，不宣称启动优化已完成。

报告：

- 完整基线：`build/native-app-performance-Ea3dPI/acceptance.json`。
- 仅 ACK 调度实验：`build/native-app-performance-2yMVAy/acceptance.json`。没有明显收益，因此不能单独将该实验宣称为提速。
- 最终方案：`build/native-app-performance-JJVQhF/acceptance.json`。

所有对照样本使用 `d3d11va`；每会话一次原文件加载、缓存暂停次数 0、纠偏次数 0，分辨率与索引一致。缓存暂停为 0 不代表定位耗时为 0。

### 播放中连续快进再反向快退

另做三轮 `+5、+5、-5`，验证最终位置与随后时间推进。为隔离 `time-pos` 的影响，测试进程支持 `AVHUB_PERF_COMMAND=legacy`，仅临时将定位传输替换回 `seek absolute+exact`，不改生产文件；两组都使用新的 ACK 调度，因此这不是完整旧版本对照。

最后一次意图至目标确认，中位数：MKV 1066→846 ms、TS 189→134 ms、MP4 320→70 ms。MKV 的这个位置仍慢，不能仅凭其他位置的结果宣称解决所有卡顿。

- 旧指令传输：`build/native-app-performance-ztkvtB/acceptance.json`。
- 最终生产方案与 I/O：`build/native-app-performance-LF0n25/acceptance.json`。

`AVHUB_PERF_IO=1` 读取实际 Electron 主进程拥有的 MPV 进程计数。该轮暂停定位序列的进程读取量约为 MKV 464MB、TS 354MB、MP4 198MB；包含预读和系统缓存命中，不是物理磁盘吞吐量。进程写入计数包含 IPC 等，不能解释为源文件写入。本轮没有同条件完整旧版本 I/O 对照，不宣称减少了 I/O。

## 正确性回归

- MPV 队列单元：ACK 前合并、ACK 后无需旧帧即可发最新目标、ACK 不视为完成、陈旧重启事件、失败归属、目标精度、启动取消、片尾与慢查询，通过。
- `native-startup-failure.mjs` 明确断言 `--hr-seek=yes`，进程退出保护通过。
- `native-coordination.mjs` 保存队列、截图协调、退出顺序与布局重试，通过。
- 真实 Electron `native-player.mjs` 截图、字幕音轨、重复启停、窗口与只读保护，通过。
- 真实 Electron `native-startup-recovery.mjs` 故障重试与占用保护，通过。
- 真实 Electron `native-app-flow.mjs` 暂停定位片尾不连播、自然结束 A→B 连播、回到媒体库，通过。修正测试夹具为明确选择 A，避免默认添加时间排序偶尔从 B 开始。
- 明确标记的控制栏/启动生命周期组件测试，共 19 项通过；不代替原生桌面性能验收。

## 后续重点

1. 打开耗时仍需优化。下一阶段单独设计有界资源复用，必须验证关闭旧源、文件占用释放、会话隔离和退出恢复，再考虑保留宿主或解码器。
2. 继续定位长 GOP MKV 的单次精确定位成本；不自动放宽精度，不改变原画。
3. 真实物理键盘焦点、混合 DPI、HDR/10-bit 和长 HEVC 的交互验收仍保留。
