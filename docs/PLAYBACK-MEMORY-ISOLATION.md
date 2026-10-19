# 播放开关内存隔离诊断

## 目标

延续 [完整小时验收](LIBRARY-LONG-RUN-ACCEPTANCE.md) 后的未结问题：renderer
工作集缓慢上涨，但尚无单向累积的 DOM/原生窗口证据。本轮先控制测量开销，
不把疑似缓存增长直接认定为应用泄漏，不改动生产播放参数或原视频。

## 方法

真实 Electron、正常硬件 GPU、同一个 96 张封面页；只读克隆索引和封面，使用
已授权的 4K MKV（索引 ID 196）。两组顺序运行，保持同样的播放/暂停/准确跳播/
返回媒体库步骤。第一轮仍以原尺寸 PNG 检查实际解码画面变化；结束核对源身份。

```powershell
node electron/test/desktop-cover-stress.mjs D:\AI\codex\avhub\AVHub-data\library.db --seconds=180 --hardware-gpu --phase=scroll --playback-id=196 --playback-every=1 --idle-seconds=60 --network-metrics=off
node electron/test/desktop-cover-stress.mjs D:\AI\codex\avhub\AVHub-data\library.db --seconds=180 --hardware-gpu --phase=scroll --playback-id=196 --playback-every=1 --idle-seconds=60 --network-metrics=on
```

- `off` 只关闭本脚本新增的 CDP Network 统计；Playwright 自身传输仍有诊断开销，
  **不是完全无调试器的生产运行**。HTTP 统计不可用时，摘要输出 null 而非零流量。
- 每轮关闭后记录 renderer 工作集、私有内存、DOM、JS/embedder 堆，单列首次
  初始化与后续暖会话。文档不能仅凭首尾两个数推断每次固定泄漏多少内存。
- 主动操作结束后静置 60 秒，记录自然变化；不 reload、不强制 GC、不清缓存。
  `elapsedMs` 是有效负载时长，`totalElapsedMs` 另含静置（不含最后校验/退出），
  静置不会把一个未达到目标的负载改判通过。
- `firstFrameMs` 为本实现会话创建至 MPV `playback-restart` 的时长，包含叠层
  初始化等步骤，并非纯解码耗时。`openMs` 还包含测试轮询等待，不能混算。
- 全部原始记录保留，旧报告中不存在的新字段输出 null；不将缺失值解释为零。
- 启动前 SHA-256 核对会顺序读取源文件，可能预热系统文件缓存；本实验不清理
  系统缓存，不把首次会话称作冷盘播放，也不由此推导硬盘随机读性能。

## 回归保护

`node electron/test/library-soak-report.mjs` 使用合成报告验证摘要语义，不是性能
验收：未完成负载不会因总时间较长而通过、关闭统计为未知、暖会话剔除首次、
旧报告兼容且不生成空尾时间段。已加入 Windows CI 的无运行库下载测试步骤。

本轮真实结果以各组独立报告为准；单次顺序对照不能排除系统缓存、运行顺序和
首次初始化差异，更不能替代物理多屏或 HDR 验收。

## 真实结果

两组均完成 9 次实际播放/暂停/跳播/关闭，源加载每次为 1、缓存等待事件 0，
正常退出且原文件身份校验通过。构建为 `50a1b82babbf610f`。

| 额外 Network 统计 | 有效负载 / 含静置秒数 | 第二轮关闭后私有内存 | 最后一轮关闭后 | 静置一分钟后 |
| --- | --- | --- | --- | --- |
| 关闭 | 200.160 / 260.180 | 101.6 MiB | 119.9 MiB | 118.7 MiB |
| 开启 | 196.647 / 256.658 | 109.3 MiB | 143.8 MiB | 139.7 MiB |

报告为 TEMP 下 `avhub-cover-stress-ve5mT7/library-soak.json` 和
`avhub-cover-stress-vIfCTL/library-soak.json`。单次顺序对照存在初始状态差异，
不能把两组约 21 MiB 的末尾差值全部归因于采样；但关闭额外采样后仍有暖会话
内存上涨，也不能将“关掉统计”当作应用内存修复。静置只有小幅回落。

因此目前仍未确认泄漏根因，也未修改缓存预算、播放器销毁顺序或解码参数。

## 不依赖 DevTools 的后续采样

现有 MPV 设置面板中的“复制播放诊断”增加 `processMemory`，仅点击时获取，
不增加周期任务。快照最多 32 个 Electron 进程，标识主进程、媒体库 renderer 和
控制层 renderer，明确 KiB、缺失值为 null、GPU 工作集不是显存、MPV 不在范围内。
只导出固定字段，不导出进程名称、命令行、源文件路径或标题。

以后可在正常桌面运行中，完成两次初始化后复制一次诊断，再在多次开关播放后
复制对照，无需启用 CDP Network。仍要区分工作集/私有内存与真实泄漏，不用强制
GC 或清缓存证明“修复”。单元回归覆盖角色、字段白名单、上限和缺失值。

## 本轮交付验证

- `npm run build`、`npm run build:electron` 通过，版本未增加；按需诊断构建为
  `85cef4a14de6546d`。前述对照及小时数据属于原构建 `50a1b82babbf610f`，
  不将其改写成新构建的小时验收。
- `process-diagnostics.mjs` 与 `library-soak-report.mjs` 通过，均加入 CI。
- 真实原生会话验收通过：`build/native-player-${pause}-c4CwQN/acceptance.json`，
  包含内存单位/进程角色及路径、标题排除断言。
- 严格真实嵌入验收通过：`build/native-embedded-JEGRxT/acceptance.json`，
  屏幕图样 `pattern-visible`，媒体库和控制层 renderer 均有有效快照，
  原文件不变，仍为单个 125% 显示器，`physicalMixedDpi:false`。
- 没有修改解码/转码、关闭回收顺序或全局缓存策略；没有打包、推送或发布。

## 下一步

使用下面的不连接调试器对照，区分测试保留开销与实际增长；若仍持续上涨，再按
renderer 的资源类别做更细的堆/图形资源归属诊断。物理多屏 DPI 仍由实机交互
验收完成，不用当前单屏结果替代。

## 不连接调试器的自动化桌面对照

```powershell
node electron/test/desktop-memory-no-inspector.mjs D:\AI\codex\avhub\AVHub-data\library.db --media-id=196 --cycles=12 --idle-seconds=60
```

- 直接启动正常 Electron（硬件 GPU、非 headless、不禁用 sandbox），测试入口
  `app.setAppPath` 指向实际工程并加载原有编译后的主进程。不通过 Playwright、
  CDP 或 Node inspector，也不创建额外生产 IPC。测试入口不在打包白名单中。
- 控制由测试主进程的 `webContents.executeJavaScript` 完成，经现有可信 preload
  播放接口和实际页面返回按钮操作；这是自动化桌面对照，不冒充人工验收。
- SQLite 使用只读连接备份到新建的独立 TEMP，封面只复制索引目录内已有图像，
  克隆中关闭目录写权限和后台封面任务。启动前、退出后校验只读源 SHA/大小/修改
  时间；不写正式数据库、原视频，也不修改正式应用的数据目录配置。
- 每轮同页滚动、原文件播放 10 秒、暂停、准确跳到 30 秒、返回媒体库。第一轮
  核对跳播前后原分辨率 PNG 哈希不同。每轮单源加载、无缓存等待，检查返回后
  只剩一个主窗口且显示器监听归零，文档标识不变；不 reload、清缓存或强制 GC。
- 内存直接取 Electron `app.getAppMetrics()`，角色区分媒体库/控制层。不采集
  DOM/堆的 inspector 计数，不能据此判断具体图形分配类别或 detached DOM。
- 原子写入 `memory.json`。`completed` 只表示全部轮次及静置结束；外层进程
  必须等实际退出、核对原视频且无所属 MPV 残留，才设置 `cleanExit`。有异常
  不把中间检查点升级为完成。默认不加入 CI：需要明确授权的真实大库和样本。
- 此控制使用正常可见窗口及默认后台节流，旧 Playwright 压测还调整了测试窗口
  节流/激活方式，采样频率也不同。两者用于判断增长是否可复现，不是严格只改
  一个变量的因果实验；不能将差值全部解释为 Playwright/CDP 保留。

### 2026-10-18 短时控制结果

构建 `85cef4a14de6546d`，报告：
`C:\Users\liu\AppData\Local\Temp\avhub-no-inspector-r2MBJL\memory.json`。
使用同一个 ID 196 的 3840×2160 原文件、同页 96 条媒体卡片和索引现有封面；12 轮有效操作
200.974 秒，另静置 60.004 秒。正常退出、所属 MPV 无残留，源 SHA/大小/修改
时间一致，错误数组为空。第一轮跳播前后 3840×2160 PNG 哈希不同。

| 阶段 | 媒体库 renderer 私有内存 | 工作集 |
| --- | --- | --- |
| 第一次关闭后 | 118.7 MiB | 183.6 MiB |
| 第二次关闭后 | 140.6 MiB | 204.8 MiB |
| 第三至十二次关闭后范围 | 72.7–86.1 MiB | 141.9–153.9 MiB |
| 最后一次关闭后 | 83.0 MiB | 151.0 MiB |
| 静置一分钟后 | 76.3 MiB | 145.4 MiB |

- 所有轮次 `sourceLoads:1`、`bufferingEvents:0`，采样的丢帧/解码丢帧为 0；
  准确跳播完成 134–190 ms。首次画面事件 0.72–3.23 秒，包含本实现窗口叠层
  等初始化，不作为纯解码时延，也不据此声称启动性能已经优化。
- 每轮返回后 BrowserWindow/BaseWindow 均为 1，显示器监听为 0；主文档标识
  始终相同，没有通过页面重载、清缓存或强制 GC 压低曲线。
- 本组没有复现同页暖会话持续上涨；正常内存自然回落，不能再把每次开关直接
  等同于固定泄漏。但仅约四分钟、单页单样本，**不推翻此前跨页小时实验**，
  不代表已定位/修复增长根因，也不能证明全应用无泄漏。

随后补强了测试入口：拒绝调试端口/管道开关，每次内存采样检查没有打开
DevTools 或附加 debugger，异常报告必须保持未完成。两轮短回归报告为
`C:\Users\liu\AppData\Local\Temp\avhub-no-inspector-SJv8JS\memory.json`，上述断言
通过，正常退出、源文件不变。此两轮仅验证入口保护，不额外算作稳定性长测。
诊断字段白名单和旧报告语义两组单元回归、两个新脚本语法检查、`git diff --check`
均通过。本轮仅修改测试与验收文档，未改变生产播放逻辑、版本，也没有打包发布。

后续优先用此无调试器入口扩展跨页、较长时长和不同文件的重复对照。只有确认
增长仍存在且定位到资源类别后，才调整资源生命周期；不降低解码质量、不先改
全局缓存上限，也不通过隐藏缓冲提示改善数字。

### 2026-10-19 跨页小时补测

已使用无调试器入口完成 2,178 条索引、23 页、237 轮、约 60.22 分钟有效负载，
另静置一分钟并核对实际退出及源文件身份。当前封面解码另行断言，结果与限制见
[按播放模式的帮助与跨页内存复测](HELP-AND-CROSS-PAGE-ACCEPTANCE.md#完整小时结果)。
本轮未复现历史大幅持续上涨，但样本、窗口可见性及诊断方式不同，不是严格单变量
对照；不能宣布旧增长根因已定位或全应用无泄漏。历史结果及失败报告保留，未盲目
改变生产缓存、节流或画质策略。
