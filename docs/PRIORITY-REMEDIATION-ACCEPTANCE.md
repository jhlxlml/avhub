# 优先级修复与发布前复核

日期：2026-10-22。本轮本地迭代版本仍为 0.2.14；经用户另行授权已本地打包
验收，未推送、上传或发布。
冻结网页版归档保持不变，不访问或修改 E:\downloads。

## 1. 构建依赖安全

- npm audit 的已知告警由 11 项（高危 3、中危 8）降至 0。此结果是本次审计
  快照，不代表以后永远没有新披露，也不替代 Python、运行库或成品验收。
- Vite 精确固定 8.3.5；锁文件更新 source-map-js 1.2.2、http-cache-semantics
  4.3.0。Electron 44.4.3、electron-builder 26.16.1、React 19.2.8、hls.js
  1.7.2 未升级或降级，没有改动解码/封装/音视频质量策略。
- 对 @electron/get 的可选 global-agent 定向覆盖为 4.1.3，移除旧 roarr/
  sprintf-js 链；没有使用 audit fix --force 或凭空设置不受支持的修复版本。
- 新增 build-dependency-policy.mjs 验证实际打包下载器的代理初始化、HTTP
  代理路由及 NO_PROXY，只有回环服务器，不对外发送媒体或下载运行库。
  HTTPS CONNECT 与外网下载不属于该测试的已确认范围。

## 2. CI 回归缺口

- 新增 14 个 UI 文件的 CI 覆盖，含目录确认/焦点、深浅主题、窄窗、导航、
  加载/错误重试、队列不重载解码、表单说明和设置滚动。
- 保存屏障、时间线和稳态帧观测 14 项纯逻辑测试进入 CI。
- tests/test_ci.py 同时约束命令和测试源文件存在。verify 总预算为 45 分钟，
  单项断言、保存超时和性能指标没有放宽。main/PR 仍只测试，不自动打包发布。
- npm audit --audit-level=moderate 作为显式 CI 门禁，后续中危及以上告警会
  阻止流程；审计服务不可用不能当作零告警通过。
- 本地 YAML/测试通过不等于 GitHub hosted runner 已经执行；本轮没有触发 Actions。

## 3. 桌面回归发现并修复的焦点竞态

真实 Electron 首轮复测在连续空格切换封面预览时失败。原因是取消目录移除后，
DirectorySettingRow 在 requestAnimationFrame 中恢复菜单触发器焦点；该回调
可能晚于用户已经聚焦其他控件，抢走第二次键盘输入。

改为在 disabled 解除的 layout commit 恢复焦点，不留下延迟抢焦点任务。
目录成功移除后该行卸载，不尝试聚焦不存在的控件；取消/失败仍保留菜单入口。
没有改动目录权限、系统回收或删除行为。组件测试通过延迟 frame 回调验证，
真实 Electron 另保留两次空格及中间焦点断言，不用强制点击绕过。

## 4. 旧样式分模块收敛

目录树和媒体编辑表单的最终样式移回各自特性 CSS，删除 Mira 中对应重复覆盖。
表单旧写死深色、旧珊瑚色按钮改为共享语义 token/按钮体系，保留焦点、错误色、
选中背景、32px 字段及 28px 行内操作。其他特性仍可能存在兼容覆盖；没有宣称
全库 CSS 已消除，也不做无回归保护的整库删除。

## 已执行验证

- 前端及 Electron TypeScript 构建通过。最终应用构建 3bc37be15a38b238。
- 完整后端 564 项：563 通过、1 跳过，107.054 秒。包含 CI 配置回归；预期的
  重复 ZIP 成员/非法端口 fixture 日志不作为产品故障。
- 82 项 UI 组件测试通过；焦点竞态修复后目录设置 8 项再次通过，新增用例
  已包含在 CI 的同一文件中。组件服务仍出现过 Windows 连接重置日志，未声称消除。
- 14 项保存/观测纯逻辑测试及下载器本地代理兼容测试通过。
- 窗口模式：build/window-mode-result-electron-window-mode-pn9kvE.json，
  passed=true，构建 4a32032ecadab19c；真实窗口滚动条、比例、旋转、全屏及恢复
  校验通过。这是焦点竞态修复前的同轮构建，不伪称它是后续最终构建证据。
- 最终真实 Electron UI/播放流程：build/electron-library-refinement-4MXq0A/。
  真实解码/错误重试、深浅和窄窗、目录/片单/确认/设置回归通过，页面错误为空，
  生成样本哈希及修改时间不变。文件变更仅测试生成数据，不修改用户视频。

## 尚不能关闭的验收项

1. 历史后台提交与保存长尾需以本轮组合负载的实际结果继续归因；未复现不等于
   已修复。保持 FULL、原子提交、活动读者保护和成功响应语义，不以隐藏提示、
   提前确认或降低同步级别掩盖等待。
2. 历史 CSS 后续继续逐模块收敛，当前只关闭本轮上述两个模块的重复规则。
3. MPV 原生物理画面/混合 DPI/HDR 验收和分发 gate 不因本次改动自动通过。

## 最终组合负载结果

证据：build/desktop-usage-avhub-desktop-usage-zkf1xu/soak.json，构建
3bc37be15a38b238。真实 Electron 正常 GPU/sandbox/backgroundThrottling，
系统报告 60Hz、175% 缩放，窗口适应工作区。使用 600 个生成的 320×180、
12fps H.264 SDR 视频；不是用户原视频、高码率/4K/HDR 或无调试器验收。
初次扫描与封面排空后开始计时，再穿插增量扫描与封面重试；不是持续强制
并发封面解码，也不是上万视频的长期验收。性能段没有并行编译或回归测试。

工作段 307.264 秒、28 轮、84 次真实解码预览。56 次暂停/返回保存均对应实际
committed 操作：fetch 最长 62.1ms、服务 HTTP 最长 60.528ms、数据库 total
最长 59.765ms，其中 commit 最长 58.420ms。实际返回 click 到媒体库 DOM
最长 63.9ms；工具观测返回总计最长 110ms，不把两者混为同一延迟。

整个运行（含初次扫描/封面）后台 serialized commit 最长仍为 145.368ms，
对应 cover-publish，总计 145.990ms；不能据进度保存正常就称后台长尾消失。
历史 341–385ms 请求或秒级等待本轮未复现，仍未关闭。

工作段 activeFrames=1393、activeDropped=116、readyDropped=0、waiting=1、
stalled=0、unexpectedReloads=0。一次 waiting 在该轮起播约 0.4 秒处，约
2.6ms 后 playing；掉帧并非全为起播计数，必须保留，不能将流程通过标成
“无掉帧/无缓冲”。另做同一 Electron 中应用/最简页逐秒对照以检查环境边界。

renderer 工作集采样 187656–360752 KiB，末轮返回 344388 KiB；五分钟且反复
开页/解码的采样不能证明没有长期内存泄漏。completed/cleanExit/
sourceUnchanged=true，errors 为空，私有 SQLite verified=true，退出 WAL=0。
源校验为代表生成样本哈希/大小/mtime，不是每个副本逐一哈希或用户媒体验收。

最终安全审计仍为 0，CI 配置 9 项及代理兼容测试再次通过。没有为改善数字
修改画质、GPU 参数、播放速率、持久化同步策略或产品加载提示。

## 同一 Electron 的呈现对照

首轮 frame-probe-heQ0k0 使用固定 1440×900 DIP，超过当前高 DPI 工作区，
不将其当作代表性窗口对比。修正验收脚本后保留产品工作区适配尺寸，并新增
withinWorkArea 断言；没有为测试改动产品窗口或解码策略。

修正后报告：build/frame-probe-avhub-frame-probe-h1lY7t/frames.json，构建
3bc37be15a38b238，窗口 1436×748、工作区 1463×775、175%/60Hz。每轮约
12 秒，生成 640×360 H.264 SDR；同源地址、同一 Electron、正常 GPU/sandbox，
依次比较应用页和没有 React/控件/变换的最简文档。最简文档仅存在于验收 route，
不是恢复浏览器产品。Playwright 附着，固定顺序，不是随机多轮物理呈现测量。

| 源 fps | 文档 | 预览先行 | totalVideoFrames 增量 | droppedVideoFrames 增量 |
| --- | --- | --- | ---: | ---: |
| 12 | 应用 | 否 | 150 | 11 |
| 60 | 应用 | 否 | 734 | 109 |
| 12 | 应用 | 是 | 149 | 11 |
| 60 | 应用 | 是 | 733 | 94 |
| 12 | 最简 | 否 | 148 | 10 |
| 60 | 最简 | 否 | 728 | 107 |

全部有真实视频帧回调，意外重载为 0，源哈希不变、页面错误为空。最简文档也
持续掉帧，不能据此判定本轮 UI 引入独有回退；也不能声称已确定全部掉帧根因、
已修复或两者性能严格等同。totalVideoFrames 包含丢弃帧，不能把它们全部称为
实际呈现帧。未隐藏 waiting、保留旧帧作假或降低质量。

## 本地冻结成品验收

用户授权“允许本地打包验收，不发布”后，使用新目录：
build/local-package-acceptance-20261022-3bc37be15a38b238/。
没有覆盖 dist/electron 中历史 EXE、ZIP、清单或 AVHub-data；原有包大小及
修改时间保持。后端经 PyInstaller 收集，并确认仅一个固定 SQLite DLL。

folder-portable.py 新增显式 --directory；portable-release.mjs 新增
--artifacts-dir，默认 CI 路径不变。候选目录隔离/解压测试通过，旧输出 sentinel
保持；避免仅为本地验收而移动用户数据或覆盖已发布同版本包。

另修正旧的验收盲点：过去先调用当前 bootstrap() 建空库，无法证明冻结后端
可以升级旧结构。现在由 seed-legacy-library.py 创建缺少 progress_updated_at、
video_color、manual_watched、片单 revision 和新索引/任务表的合成旧库，
只允许 build 内新数据库，已有库拒绝覆盖；连接显式关闭。不是读取用户备份。
两种实际 EXE 均由冻结后端升级，并在三次启动中断言原标题、收藏、评分、标签、
42 秒进度及片单成员保留。第二次启动实际迁移数据目录，旧数据保留。

| 成品 | 字节 | SHA-256 |
| --- | ---: | --- |
| 单文件 EXE | 186378178 | 8bf707d693a2353ff4e189d8377de15f961127e7bed59efa3d41ef5f84aada16 |
| 文件夹 ZIP | 266157378 | 38374fa3e5da11fe44dddd437cc2ad8487a88bbb9fdc2be1e631c496f984477f |

单文件报告 build/portable-release-test-DUxo2R/startup-timings.json，媒体库可
操作总计 10159/10056/10147ms；应用内部 library-ready 为 1284/1371/1243ms。
ZIP 报告 build/folder-release-test-tYJrFE/startup-timings.json，总计
2332/1169/900ms，内部 2004/1091/805ms。未清 OS 缓存，轮询粒度最长 250ms，
第二次含数据目录迁移，headless 验收标志及调试连接会影响结果，不称受控冷启动。

两种包均验证 frozen=true、SQLite 3.54.1 verified=true、内置 FFmpeg/FFprobe、
默认同级数据位置、合成旧结构升级、偏好与片单保留、重启及正常退出；检查更新
仅由主动点击触发，使用模拟 GitHub 结果，不联网发布。生成 H.264 640×360
样本的真实首帧分别在 910/861ms 观察到（含导航/自动化），源哈希不变。
不将此当作真实 MKV/HDR/随机跳播或无调试器性能验收。

这些是本地未发布候选包，同为 0.2.14 但 build_id 与历史公开包不同，不能作为
覆盖已公开版本的上传文件；后续正式标签需按规则另行准备版本与 Release 说明。

## 最后一次完整回归

最终源码与同一应用构建上：后端 567 项，566 通过、1 跳过（121.583 秒）；
83 项 UI 组件用例全部通过（1.4 分钟）。两组回归在成品启动计时结束后执行，
不将它们的耗时或并发负载混入上述呈现/启动对照。CI 的目录设置文件包含新增
焦点竞态用例，后端自动发现新增的候选目录与旧结构样本安全测试。

git diff --check 通过，仅保留既有 build-windows.ps1 换行符提示；冻结归档无
改动。当前可以进入本地候选包人工试用，但不把历史长尾、呈现掉帧或整库样式
兼容层称为全部关闭，也没有代替用户推送正式标签。
