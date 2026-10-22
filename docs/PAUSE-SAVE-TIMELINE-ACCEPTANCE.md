# 暂停保存分段与播放帧计数验收

## 范围

本轮承接 `SCAN-READINESS-ACCEPTANCE.md` 的 385ms 异常。没有改变保存触发、
去重、写入优先级、FULL、checkpoint、扫描并发、解码、播放画质或加载提示。
原始视频未修改；测试只使用工具创建的隔离样本，不涉及 E:\downloads。

详细 HTTP 计时由 `AVHUB_PROFILE_PROGRESS=1` 显式启用，产品默认关闭：

- `X-AVHub-Progress-Http-Ms`：ASGI 中间件入口至响应头发送；含其内部的请求
  解析、工作线程调度、处理、序列化，不含此前 socket/事件循环排队，也不含
  之后的传输、响应体读取和前端调度。
- `X-AVHub-Progress-Handler-Ms`：进入同步保存函数至成功提交后的响应头设置。
  只有实际成功路径设置；失败不会因此变成保存成功。
- 原有 `X-AVHub-Save-Trace` 继续对应真实已提交的数据库操作。SQL/body/状态码
  保持不变。数据库 total 已包含在 handler、HTTP、fetch 计时中，不能相加。
- 默认不注册该中间件，也不采集处理函数的 perf_counter。没有新增持久记录、
  表、每帧 React 状态更新或产品轮询。

`electron/test/playback-timeline.mjs` 是验收工具，不打入应用。只在实际起播后
观察视频事件、有限的帧质量快照、实际 progress fetch 和主线程 longtask；
不拦截响应体，不改变请求参数、返回 Response、失败异常或播放行为。上限为
256 个事件、128 个长任务。工具观察本身仍可能扰动时序，不能宣称零开销。

## 时间线解释

工具分别记录：Node 暂停命令往返、页面实际调用 pause、独立 pause 监听器、
fetch 发出/响应头、服务端 HTTP/handler、数据库以及测试的持久数据复核。
请求通过实际 updated_at 精确匹配，再核对 response scope 与数据库提交。

`observerToFetchSignedMs` 可以为负：React 自己的 pause 处理先于工具附加的
监听器执行，保存请求可能已经发出。这不是负耗时或时钟错误，也不能把工具
监听器当成应用处理函数的入口。可靠的同页边界是 pause-call → fetch-start。
跨 Node/renderer 的 wall-clock 差仅作毫秒级旁证；主要使用各自单调时钟。

## 真实 Electron 结果

正常窗口/GPU/sandbox/backgroundThrottling，600 个真实 FFprobe 导入任务与
原文件直放重叠，然后完成封面生成和增量扫描。样本为工具生成的 H.264 SDR
320×180/12fps；不是用户 4K/HDR、大码率或物理显示验收。所有轮次顺序执行，
没有并行回归负载。A–D 为 build `14f0f8faa7865db6`，E 起为
`8981359af9116e81`；不能把跨构建/采集字段变化当作控制变量性能比较。

证据均位于 `build/bulk-playback-avhub-bulk-playback-*/acceptance.json`：

| 轮次/目录后缀 | 首次扫描 ms | 增量暂停旧总计 ms | 暂停命令往返 ms | fetch 至响应头 ms | 数据库 total ms |
|---|---:|---:|---:|---:|---:|
| A / EBwhmr | 12472 | 27 | 3.3 | 10.7 | 7.479 |
| B / cIuxUC | 12928 | 373 | 351.0 | 10.2 | 7.556 |
| C / fZInLG | 12414 | 341 | 3.0 | 324.8 | 7.996 |
| D / nVRhj8 | 12403 | 24 | 3.6 | 8.5 | 5.559 |
| E / aJ7rVH | 12905 | 26 | 3.1 | 10.4 | 8.325 |
| F / 34wRHv | 12672 | 20 | 3.2 | 5.4 | 3.206 |

B 的长等待主要位于调用暂停命令的往返；不能据此区分 Playwright 调度、
传输与 renderer 调度。C 则是实际 fetch 等待，并非同一种异常；当时尚无
HTTP 分段，不能追溯归因于工作线程、网络、服务端或页面。两次都不是慢 SQL
提交的证据，不能用“都是测试工具问题”解释。

E 已实测 HTTP 入口计时：首次四次 HTTP 为 4.370/4.507/4.294/4.389ms，
对应 handler 3.221/3.578/3.332/3.547ms；增量 HTTP 8.956ms、handler
8.374ms、数据库 8.325ms。该轮没有复现长请求，不代表 C 已修复。
F 使用最终采集代码且断言实际 HTTP/handler 计时存在、前者包含后者：首次
HTTP 3.944–4.859ms、handler 3.268–3.921ms；增量 HTTP 3.858ms、handler
3.248ms。E/F 均未复现 C 的慢请求，不能声称已找到或修好了它的根因。

### 帧计数不能粉饰

A/B 首次播放中掉帧增量分别为 13/10，增量各 2；暂停和恢复边界为 0。
C 的四段约 750ms 连续播放窗口掉帧为 0/2/0/2，增量窗口为 2；D 为
2/0/0/2，增量为 2；E 为 0/2/0/0，增量为 2。观察窗口中没有 pause、
seeking、waiting、stalled、loadstart，不能把这些计数归于主动暂停。

工具仍未测到具体帧的屏幕呈现间隔，短窗口还可能覆盖刚起播/恢复后的阶段。
因此既不声称“零掉帧”，也不把所有计数直接等同于用户可见卡顿。D/E 的
longtask 列表为空，F 明确核对该观察能力受支持且列表为空。F 首次播放中
掉帧 10、增量 2，连续窗口 0/2/0/2、增量 2；仍不能排除 GPU、调度、合成
或未覆盖的主线程阻塞。

六轮均 completed/cleanExit/sourceUnchanged=true、errors 为空，真实保存与
持久数据核对通过，无源重载，waiting/stalled 为 0，退出无 WAL。这里的功能
断言通过不等于播放质量已验收为零掉帧。

## 下一步

保留逐条原子保存和原画播放策略。优先使用已补齐的 HTTP/handler/数据库
分段捕获同一种请求长尾；另以带预热的持续播放基线与扫描中对照，增加真实
呈现间隔，定位播放中掉帧。不能仅凭累计计数调低画质、关闭 GPU 或隐藏提示。

后续预热对照结果见 `STEADY-PLAYBACK-SCAN-ACCEPTANCE.md`；仍保留本报告
捕获的两种长等待，不以连续播放的短测覆盖历史异常。

复现（回归与性能轮顺序运行）：

```powershell
python scripts/python-runtime.py -m unittest discover -s tests -p test_progress*.py
node --test electron/test/playback-timeline.test.mjs
npm run build
npm run build:electron
node electron/test/bulk-import-playback.mjs --videos=600 --label=pause-http --readiness=off --search-checks
```

本轮不打包、不推送、不升级版本。

## 最终回归

- 完整后端：559 项，558 通过、1 跳过，96.437s。
- 时间线工具单测：3 项通过；入口脚本语法检查通过。
- 显式浏览器组件 harness：library-transitions、progress-save、full-backup、
  shutdown、thumbnail-tasks 共 19 项通过，30.7s；不代替上面的 Electron 验收。
  该轮测试服务日志出现一次 Windows asyncio ConnectionResetError/10054，
  测试断言没有失败；保留该噪声，不能描述成所有日志均无异常。
- 前端与 Electron 编译通过；既有 Vite 配置加载与大 chunk 警告未在本轮处理。
- 最终构建 8981359af9116e81、版本仍为 0.2.14。git diff --check 通过，
  仅既有 build-windows.ps1 的 LF/CRLF 提示。
