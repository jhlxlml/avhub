# 独立 MPV 接入索引兼容修复与构建验收

日期：2026-11-11。HEAD 仍为 `f3f65dbc321b54541f09be6b1558fb9e4f5eab27`，版本保持 0.2.19；保留既有工作区修改。应用代码构建 `d42b8795c7ff5db4`。本轮没有打包、提交、推送、标签或 Release。

## 实际修改

1. `scripts/build-desktop-mpv.py` 在已校验的 MPV/LuaJIT 源码与依赖上，应用与内嵌库相同的 `ci/patches/mkv-reversed-cues.patch`。校验源码 revision、归档 SHA、补丁 SHA，使用 `patch --fuzz=0`；记录两个源码文件的补丁前后哈希、构建配方、命令和依赖，保留 Lua 控制器支持，不覆盖原运行库。
2. `scripts/stage-desktop-mpv.py` 将补丁、Lua 对应源归档/元数据、许可、实际构建配方和 PE 导入报告随候选保存。仍声明 `distributionReady:false`，没有把开发验收当作已完成的发行审核。
3. `electron/src/independentRuntimeLayout.ts` 与 `main.ts` 支持显式选择项目 `build/mpv-desktop-runtime-xxxxxxxx` 开发候选；打包版忽略此环境覆盖，继续读取自己的 resources/mpv。未增加公开 renderer 文件路径或任意命令接口。
4. `scripts/development-independent-runtime.mjs` 让开发启动器和播放回归共享同一选择逻辑。验收标记绑定精确 manifest SHA 和 EXE SHA；真正启动仍由 `NativeRuntime` 完整验证 EXE、许可和全部动态依赖，未取消 force 校验、sandbox 或发行门禁。
5. 新增/扩展运行库选择契约、同源首次远跳计数、双音轨/字幕像素及重开记忆测试；接触到的经典 API 与独立 UI 测试媒体生成已改为复用统一池。修改测试所需的独立副本原则保持不变。

新源码构建：`build/desktop-mpv-build-utessv1d/`。
新运行库：`build/mpv-desktop-runtime-wn3ju35e/`。
EXE SHA256：`a52839d8e5390be1412490fbab513329d5f98d93d6e5ae60fa679ec96500c559`。
包含 29 个依赖 DLL，Lua 控制器正常运行。旧 bin/mpv 与旧源码构建/报告保留。

## 同源独立窗口性能对照

同一 model #25 4K60 VP9 MKV 内容，对照未修复的同源码 Lua MPV `95dt6r1c` 与新库 `wn3ju35e`。测试通过真实 Electron 应用打开独立窗口，使用同一池内字节快照与同一首次远跳目标 1040 秒。原 E 盘文件前后完整哈希不变。该测试不是 E 盘原路径冷盘测速。

| 指标 | 未修复 Lua MPV | 新 Lua MPV |
| --- | ---: | ---: |
| 命令派发→原生输出确认 | 443.97ms | **23.21ms** |
| native playback-restart | 438.95ms | **18.40ms** |
| 进程读取增量 | 2938037582 B | **99901272 B** |
| 实际关键帧落点 | 1044.81s | 1044.81s |
| 定位误差 | +4.81s，明确报告为 keyframe | +4.81s，明确报告为 keyframe |
| hwdec | d3d11va | d3d11va |
| sourceLoads | 1 | 1 |

证据：`build/mpv-seek-paired-RyTTrR/report.json` → `build/mpv-seek-paired-H6MOKo/report.json`，各含 24 个暂停/播放、精确/关键帧定位样本及相对快进快退回归，PASS / 0。

独立窗口没有 Electron Render API GPU receipt，因此这里明确使用原生 restart/输出时钟确认；`frameMs=null` 保留，不伪造“GPU 呈现时间”。WMI 进程 ReadTransferCount 包含文件和管道，不是物理磁盘吞吐。OS/驱动缓存未受控，不能推广为所有文件均 23ms。消除首次大范围扫描的归因与上一轮同源码内嵌库结果一致；没有降低画质、重新加载视频或改变快模式误差语义。

## 实际验收结果

| 项目 | PASS / FAIL / SKIP 与退出码 | 证据 |
| --- | --- | --- |
| MPV/LuaJIT 源码构建 | PASS / 0 | `build/desktop-mpv-build-utessv1d/report.json`、各构建日志 |
| PE 静态依赖、Windows 系统导入解析 | 30 个 EXE/DLL、21 个外部系统导入 PASS / 0 | 同目录 `import-audit.json`；动态导入/外机并非由静态审计证明 |
| 同源独立窗口远跳对照 | 两轮 PASS / 0 | RyTTrR、H6MOKo，见上 |
| 显式双新运行库完整 Electron 回归 | 23 项 PASS / 0，无 unrun | `build/playback-regression-IuHDsd/report.json` |
| 不设置环境覆盖的默认完整回归 | 23 项 PASS / 0，无 unrun，自动选择同一 wn3ju35e / 76Rvvi | `build/playback-regression-4CiR2j/report.json` |
| 开发/打包路径、运行库哈希/依赖、共享选择契约 | 合计 11 项 PASS / 0，已加入以后回归的对应契约步骤 | `build/independent-index-final-runtime-contracts.log` |
| 原生 Lua 控件/保存退出完整流程 | PASS / 0：置顶、设置、倍速、字幕延迟、全屏、拖动一次提交、截图、自然连播、保存失败恢复/明确放弃、原生退出与应用退出 | `build/native-independent-pwjuQD/acceptance.json` |
| 双音轨、字幕像素、重开选择记忆 | PASS / 0；选择第二音轨、启用字幕；同一暂停画面的“video”与“subtitles”截图相差 2775 个 RGB 像素；重开恢复相同 aid/sid，源和共享池未修改 | `build/independent-tracks-yzsGmh/report.json` |
| 新增音轨测试初次运行 | **FAIL / 1**：异步窗口尚未打开就读取 snapshot，未进入轨道测试；修正仅针对明确“窗口尚未打开”的等待，其他异常仍抛出 | `build/independent-tracks-YwCkkI/report.json` 保留 |
| 经典 Windows libmpv API/解码验收待办 | PASS / 0：上游 10 项核心测试 + H.264/HEVC/SDR10/AV1 四样本与 Unicode 路径；四样本均强制并确认 d3d11va-copy，无软件解码冒充硬解 | `build/mkv-index-candidate-ov5n3y7s/windows-tests.json` |
| 开发入口自动选择与全字节校验 | `node scripts/start-electron-dev.mjs --check` PASS / 0，选择 wn3ju35e 与内嵌 76Rvvi | 本轮本地执行 |
| 格式检查 | `git diff --check` PASS / 0，archive 无改动 | 本地执行 |
| 新成品、外机、物理输入/多屏/HDR 色彩、全天稳定性 | SKIP：未执行 | 不由本轮回归自动放行 |

23 步完整回归中的独立窗口重开还确认 640×360 H.264 PNG8 与 3840×2160 HEVC PNG16 截图，MP4/MKV/TS 源完整性及进程正常退出。音轨测试验证解码选择和记忆，不是声学听音认证。原生 UI 测试通过 MPV IPC 注入坐标并隔离物理指针事件，是控制器逻辑证据；生产 `input-cursor` 选项未改变，不能称为真实 OS 鼠标/DPI 验收。

完整回归先前一条命令因自动审批服务额度限制未执行；本轮恢复后按正常审批重试，成功执行。没有绕过审核。首次已通过的 23 步后又发现默认回归可能选择旧 EXE，因此抽出共享选择逻辑，再实际执行无环境覆盖的第二轮 23 步，不把显式测试结果冒充默认入口结果。最终新增共享选择契约单独与已有契约合并跑过 11 项；第二轮原 23 步的运行库契约日志为修改前 7 项，未伪改历史日志。

经典 API 验收是 null-VO 元数据/控制/硬件解码测试，不等于实际 GPU 呈现。其之前待办的 `windowsTestsPassed:false` 已在实际整套脚本成功后更新为 true；实际 Electron 证据单独列出。原构建/旧报告的历史结论不反向改写。

## 现在如何使用与回滚

在本项目执行 `npm run dev`，开发启动器会读取本机 `build/independent-mkv-runtime-acceptance.json`，并校验它绑定的清单/EXE；主进程再次做完整运行库检查。用户原来的播放引擎与窗口偏好保持不变，选择独立 MPV 时使用新库；内嵌 MPV 继续使用上一轮已验收的索引兼容库。回归入口使用相同选择器并将实际候选写入报告。

显式 `AVHUB_MPV_RUNTIME_CANDIDATE` 优先，用于前后对照。打包版忽略该开发环境变量。旧已发布/已下载 EXE 不因本轮源码测试自动更新。

独立窗口回滚只需停用本机独立验收标记、取消显式覆盖，便回到未改动的 bin/mpv；不需删除原视频或改用户数据。内嵌库回滚仍按 103 的两步操作。新源码补丁、构建证据和旧运行库保留，便于复核。

下一步是统一两套运行库的发行来源材料与发布校验输入，核对正式成品入口确实使用同一补丁，并在用户授权打包时做成品验收。本轮只完成了源码构建接入和本机开发采用，没有把 source-built-candidate 或 distributionReady:false 偷改为正式发行通过。
