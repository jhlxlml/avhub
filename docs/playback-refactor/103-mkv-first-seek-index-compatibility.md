# MKV 首次远跳：索引异常定位与原生兼容修复

日期：2026-11-10。版本保持 0.2.19，HEAD 保持 `f3f65dbc321b54541f09be6b1558fb9e4f5eab27`；保留已有改动，不提交/推送/打包。最终 JS 构建 `ee63e3cff5f5f087`，本轮本地内嵌候选 `render-replayed-candidate-76Rvvi`。

## 实际原因

只读复测 id1240，即用户提供的 Chinese Model #25 4K60 VP9 MKV。原生进程 `GetProcessIoCounters` 包含文件和管道读取，不是物理磁盘字节计数；因此不能称为硬盘测速。但首次跳播增量约 **2.95GB**，后续同位置增量约 **99MB**，且管道响应量只有数十 KB，足以定位大范围文件扫描。

`build/render-frame-cadence-fTiuDk/report.json`：首次请求 1040 秒，实际关键帧 1044.827 秒，input→GPU **428.1ms**，native restart **401.1ms**，进程读取增量 **2951128969 B**；重复同目标约 47.4ms。没有缓存暂停或 libmpv 渲染超时记录；不能仅据此把 restart 延迟称为 GPU 慢或硬解码暖机。

进一步只读解析头部，`SeekHead` 中的 Cues SeekID 为 `6b bb 53 1c`，应为 `1c 53 bb 6b`。它指向 Segment 数据起点 59 + 相对位置 `0xd623edd1`，即绝对位置 **3592678924**；那里确实存在正常 Cues 元素，原文件总大小 3592684148 字节。头部证据：`build/mkv-first-seek-header.json`。

固定源码 `demux/ebml.c` 会拒绝该非法 EBML ID 长度，`demux_mkv.c` 得不到有效 Cue 项，再在首次远跳 `create_index_until` 顺序读取块建立索引。解析日志确认写入器为 `IDMmkvlib0.1`，同时出现 `ebml_id broken value` / `Invalid SeekHead entry` / `creating index until ...`。这是**这份源文件的索引头兼容问题与播放器解析行为共同造成**，不是所有 MKV 无索引，更不是画质问题。

## 尝试过但未采用的方案

1. 两次解复用对照在进入播放前 FAIL / 1：遗漏完整前端构建导致版本一致性检查拒绝启动。日志 lPGIa1 等保留；随后完整构建修正，没有放宽启动期限或关闭版本检查。
2. 切换 FFmpeg/lavf：全局选项试验 x13sGK，以及按文件选项且确认 `current-demuxer=lavf` 的 ItqlMV，仍读取约 2.97GB、首跳约 477ms。无收益，桥接选项与 C# 强制 demuxer 逻辑已完整撤销。
3. 只修改 MKV SeekHead 读取的首版库 b986b2…：真实 Electron xfXhqE 功能 PASS / 0，但仍 445ms / 2.95GB，**性能目标 FAIL**。解析日志显示 EBML 层先拒绝数据，后置分支未触达。该版本未被默认采用。

## 最终实现

补丁 `ci/patches/mkv-reversed-cues.patch`，只改两个位置：

- EBML 层仅识别 SeekID 字段中长度为 4 且字节恰为 `6b bb 53 1c` 的已知反序标识，保留给 MKV 层核验；其他非法值仍按原规则拒绝。
- MKV 层验证广告位置在可表示范围内，并只在该位置的真实元素 ID 确为 Cues 时采用标准 Cues ID。核验后恢复原读取位置；无效目标仍走原有回退。只在内存中解释，不修改文件头、压缩包、字幕或视频像素。

构建脚本 `scripts/build-mkv-index-candidate.py` 从已校验源码归档重新解包，`patch --fuzz=0`，复用已验明的编译工具链/依赖，保存两文件补丁前后哈希、补丁 SHA、命令和日志。最终构建 `build/mkv-index-candidate-ov5n3y7s/report.json`，DLL SHA256：

`5b45550f85ace0822f14d17deb7777c76d229e33c572f94a2f66580e631b42b1`

新的精确 pin 位于 `ci/mkv-index-render-runtime.json` / `electron/src/mkvIndexRenderPin.ts`；原有 pin 仍保留。主进程按明确 cohort 选择对应已知哈希，原生宿主也验证该新增精确哈希，没有接受任意 DLL。`scripts/stage-mkv-index-runtime.mjs` 验证源、宿主、依赖、补丁哈希及目录归属后生成独立候选，并附本轮来源材料；现有声明仍为 `distributionReady:false`。

## 同源前后结果

| 同一原文件、首次请求 1040 秒 | 原库 fTiuDk | 最终库 iwnjoS |
| --- | ---: | ---: |
| input→真实 GPU 完成 | 428.1ms | **40.6ms** |
| native restart | 401.1ms | **21.7ms** |
| 进程读取增量，含管道 | 2951128969 B | **98994811 B** |
| 实际关键帧位置 | 1044.827s | 1044.827s |
| 原生源加载次数 | 1 | 1 |
| 硬件解码 | d3d11va | d3d11va |

最终库同位置精确定位 74.6ms，实际 1040.039s；回跳 218 秒的快速定位 40.2ms，仍真实报告约 -4.937s 关键帧偏差；重复远跳约 43.2ms。改善来自避免顺序扫描，不是隐藏加载提示、降低画质或把近似位置报成精确成功。OS/驱动缓存未受控；这是有限单机同源实测，不保证所有文件/磁盘均达到该速度。文件大小、mtime、完整 SHA256 前后相同。

## 验收

| 项目 | 结果 / 退出码 | 证据 |
| --- | --- | --- |
| WSL 新源码 configure/build/install | PASS / 0；新构建未覆盖原库 | `build/mkv-index-candidate-ov5n3y7s/` |
| Windows 上游 10 项核心测试 | PASS / 0 | `windows-core-tests.json`，同上目录 |
| 实际 Electron 同源远跳/精确/重复定位 | 4 段各 10s，PASS / 0 | `build/render-frame-cadence-iwnjoS/report.json` |
| 正常 Cues、反序 Cues、错误目标 | 3 类、9 次精确像素定位，PASS / 0；错误目标回退可播放，源与池哈希未变、GPU/源租约释放平衡 | `build/render-mkv-index-j9wQxi/report.json` |
| 完整实际 Electron 回归 | 22 项 PASS / 0，无 unrun | `build/playback-regression-nmsIEw/report.json` |
| 4K SDR10 像素、PNG16、控件 | PASS / 0 | `build/render-app-flow-I9gOdL/report.json` |
| ASS 20 次像素定位/轨道刷新 | PASS / 0，报告绑定实际新 DLL | `build/render-ass-seek-Xkb9iz/report.json` |
| HDR 原片画面与截图路径 | PASS / 0；不等于物理 HDR 色彩验收 | `build/hdr-real-media-EOsPGK/report.json` |
| 4K AV1 像素精确/关键帧 | 40 次精确定位与关键帧像素核对 PASS / 0 | `build/render-codec-seek-DyYPIf/report.json` |
| 开发入口真实运行库校验 | `start-electron-dev.mjs --check` PASS / 0，选中 76Rvvi | 本地执行 |

HDR 测试也改接统一媒体池，原片只独立导入一次，后续测试复用池内只读别名；哈希使用流式读取。错误索引测试所需副本是显式的独立可写小样本，不触碰原视频或共享池内容。

## 当前启用与边界

本机开发环境的 `build/mkv-index-runtime-acceptance.json` 登记已执行的本地验收。开发入口在 pin 一致时选择该运行库，后续仅重编译 C# 时可重新组合相同已知 DLL；`build/replayed-render-staging.json` 反映实际开发选择。**没有改变用户默认播放引擎**，只有使用内嵌 MPV 时受益。

独立窗口 MPV EXE 仍保留原 Lua 版本，完整回归证明其原有流程继续可用，**未宣称它已获得此兼容修复**。下一步需要把同一补丁纳入 Lua EXE 与正式来源材料流水线。新库原有完整 Windows null-VO API 验收脚本尚未整套迁移执行，构建报告 `windowsTestsPassed:false` 仍保留；本轮另行记录的上游核心测试、实际 Electron 验收不能伪装成那份旧命名脚本已运行。

外机、物理 HDR 色彩、多屏、全天稳定性及新成品验收本轮未执行。没有更新已下载/已发布 EXE。发行 cohort/打包入口仍不承认该实验 cohort，本地通过不等于已满足发布门槛。

回滚时停用本机兼容验收标记，并把开发 staging 描述恢复为 `render-replayed-candidate-qsCvhd/layout.json` 对应原库；两个原始 pin、原库文件和报告仍保留。不能只删除验收标记而忽略 staging 描述。源码回滚仅撤销新增兼容 pin、补丁与开发选择逻辑，保留之前的播放修复及用户修改；无需修改或删除任何原视频。
