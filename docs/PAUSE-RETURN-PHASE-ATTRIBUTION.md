# 暂停与返回等待：正文、调度、提交和 DOM 分段

## 本轮决定

继续定位历史 341–385ms 等待，不把未复现称为修复。没有改变播放/保存触发、
重试、SQLite 写队列、FULL/checkpoint、解码、GPU、画质或文件权限策略。
版本仍为 0.2.14，不打包、不推送、不发布。

本轮主要补齐归因和重复操作验收。旧总计混合了测试命令、页面执行、服务
处理和测试轮询，不能据一个大数就降低持久化安全性或增加并发。

## 新增分段（默认关闭）

沿用 `AVHUB_PROFILE_PROGRESS=1`，默认不注册该中间件：

- X-AVHub-Progress-Body-Ms：本中间件入口至应用收到最后一个正文分片。
  包括应用读取前的调度，不是纯网络传输耗时，也不是 JSON 解析 CPU 耗时。
- X-AVHub-Progress-Dispatch-Ms：正文收到至同步保存函数入口，包含解析、
  验证、依赖及工作线程调度；不能单独当作 AnyIO 线程池排队时间。
- 原 HTTP 总计、handler 总计、已提交数据库 scope 继续保留。handler 包含
  数据库，HTTP 又包含 handler，不能相加；body+dispatch+handler 也不含全部
  序列化/框架剩余处理，不强行让它们刚好等于 HTTP 总计。

中间件只转发原消息，不额外读取或缓存正文，不改变 body/status。正文没有
被读取或保存函数没有执行时，不制造相应的 0ms。分块正文只标记最终完成。
Request 注入用于关联本次 ASGI scope，不是新增 JSON 字段或请求参数。
计时值、trace 本身均不是成功确认；成功仍以实际提交后的响应为准。

## 测试工具修正

`playback-timeline.mjs` 新增真实返回按钮 click 与媒体库 DOM 提交标记，区分
页面事件与 Playwright 动作/轮询。DOM 标记不是已绘制到屏幕，也不保证所有
封面图片解码完成。

为重复打开播放器补齐 stop()：恢复自身 fetch、删除视频及文档监听器、断开
长任务/DOM observer，重复 stop 不清理后装的采集器。每轮确认 restored=true，
避免在同一 SPA 中不断叠加 fetch 包装而把测量开销当作产品问题。
事件/长任务仍分别限 256/128，不新增产品日常采样或轮询。

## 真实 Electron 组合验收

证据：`build/desktop-usage-avhub-desktop-usage-UrAMnu/soak.json`，构建
6ec41f1ad12cb49d。正常 GPU/sandbox/contextIsolation/backgroundThrottling，
窗口 1408×820，工作区 1440×852，系统报告 32Hz/scale=2。Playwright 附着，
不是无调试器对照或物理显示验收。使用 192 个生成的 H.264 SDR 320×180/12fps
视频，不涉及 E:\downloads、4K/HDR 或已搁置的真实问题视频。

目标 180 秒，实际工作段 188.325 秒，17 轮；51 次真实解码预览，穿插页切换、
原文件播放、暂停让封面继续、增量扫描和封面重试。每轮约 4 秒播放后暂停
约 2.5 秒，再实际点击返回。不是 20 分钟长测，也不是最大规模媒体库压力测试。
性能轮与编译/回归分开顺序运行。

共关联 34 笔真实提交，每笔响应 scope 均映射已提交操作：

| 观测 | 中位 ms | 最大 ms | 含义 |
|---|---:|---:|---|
| 正文就绪 | 0.297 | 1.995 | 中间件入口到最后正文分片 |
| 正文后启动处理 | 0.245 | 1.012 | 解析/验证/依赖/线程调度组合 |
| 保存函数 | 3.693 | 5.823 | 含数据库及函数开销 |
| 数据库 total | 3.636 | 5.780 | 实际对应的串行操作 |
| HTTP 总计 | 4.439 | 8.197 | 本中间件范围，不含之前排队和之后传输 |
| 前端 fetch 至响应头 | 10.2 | 30.1 | 两种操作混合，详见下文 |
| 返回点击到媒体库 DOM | 62.3 | 76.0 | 实际页面 click 到 DOM 提交 |
| 测试返回总计 | 130 | 146 | 包括 click 调度、可见性与轮询 |

分开操作后，17 笔暂停 fetch 为 5.4–10.2ms、中位 6.8ms；17 笔返回 fetch
为 26.2–30.1ms、中位 29ms，但返回的 HTTP 中位仅 4.186ms、数据库中位
3.474ms。不能把差额归给数据库；也不能据此断定都是网络，因为前端任务
调度及响应回调执行亦包含其中。本轮没有追溯确定这部分差额的唯一来源。

17 次暂停命令往返为 2.807–7.350ms；本轮没有捕获历史数百毫秒的命令或
请求长尾。已观察到工具总计与页面 DOM 标记的区别，但**不能用它解释历史
全部异常**，特别是此前确实记录过约 325ms 的实际 fetch 等待。

后台串行 commit 最大仍为 224.774ms、total 最大 225.362ms。快速的进度采样
不等于所有后台提交都快；本轮没有修改或证明修复 SQLite 提交长尾。

工作段累计 activeFrames=822、activeDropped=0、readyDropped=0，waiting/
stalled/意外源重载均为 0，仅适用于本轮低帧率生成源。longtask 列表为空，
不代表没有 GPU/调度问题。completed/cleanExit/sourceUnchanged=true，errors
为空，私有 SQLite verified=true，退出 WAL 为 0 字节。源校验是代表生成样本
的哈希/大小/修改时间，不是全部副本逐个哈希，也不是用户媒体全量验收。

## 回归结果

后端完整回归 562 项：561 通过、1 跳过（125.258 秒）。进度、播放记忆与退出
组件 harness 共 12 项通过（21.6 秒），这是隔离的浏览器组件测试，不代替上述
真实 Electron 验收。共享保存确认、时间线与帧统计纯逻辑测试共 14 项通过。
组件测试期间出现 Windows asyncio 连接重置日志，但没有测试失败；保留该日志，
不将其当作已经定位的产品异常。Node 类型剥离实验性功能警告仍在。

前端与 Electron 编译通过，验收构建为 6ec41f1ad12cb49d；没有改变画质、保存
优先级、SQLite 同步策略或应用版本。本轮不打包、不推送、不发布。

## 后续

保留历史长尾为未解决项。现有分段能在下次发生时区分正文前后、服务处理、
数据库、前端与测试观察范围，不依据本轮正常数据盲目更改队列或同步级别。
正常高刷新率桌面的代表性原视频验收仍需单独进行，不用 32Hz 结果代替。

```powershell
npm run build
npm run build:electron
node electron/test/desktop-usage-soak.mjs --seconds=180 --videos=192
python scripts/python-runtime.py -m unittest discover -s tests -p test_progress*.py
node --test --test-timeout=10000 electron/test/playback-timeline.test.mjs
```
