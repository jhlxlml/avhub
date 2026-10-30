# M0 当前架构、工作区与测试基线

日期：2026-10-25。输入规范：根目录 `AVHub_Playback_Architecture_Refactor_Plan.md`，保留原文。

## Git 与环境

- HEAD `9678689eb67cbd2ec19cf4fe503a5a4478c07de1`，分支 `main`，应用 0.2.16。
- M0 开始时有 117 个已修改/未跟踪文件；完整状态、SHA-256、大小记录与源码副本分别在
  `build/playback-refactor-20261025/m0-working-tree.json`、`original-sources/`。
  包括先前主题、备份、清理、MPV/候选准备等修改，本轮不能用 git reset/checkout 覆盖。
- Node 24.22.1、Python 3.13.11、Electron 44.9.3；没有独立 lint 脚本，构建内执行 TS 检查。
- 正常 Electron 实测当前一个显示器，125% 缩放、59 Hz、逻辑尺寸 2048×1152。
  GPU/驱动信息在真实基线报告 `hardware.gpu`；CIM 查询在受限环境不可用，不据此编造硬件型号。
- 可找到 dotnet 启动器，但 `dotnet --list-sdks` 无输出；PATH 未找到 cl/clang/gcc/cmake/rustc。
  这只是当前环境盘点，不能据此声称已编译 libmpv render host。

## 实际调用与边界

| 路径 | 实际源码与职责 |
|---|---|
| 启动/宿主 | `electron/src/main.ts` 启动带会话鉴权的 loopback FastAPI；配置窗口/退出与 NativePlayer |
| preload | `electron/src/preload.ts` contextBridge；主进程校验 native IPC 的 sender、会话及参数 |
| 播放页 | `frontend/src/main.tsx` 按媒体 ID key 挂载 `Player`；`Player.tsx` 根据旧 `playerEngine` 选择现有两种实现 |
| Chromium | `Player.tsx` 的 ChromiumPlayer 直接持有 video、Hls.js、API token、seek、字幕及队列逻辑，尚无 PlaybackEngine 抽象 |
| HTML5 API | `app/main.py` POST `/api/media/{id}/playback`；direct URL `/media/{id}/file` 或 prepared，GET/HEAD 支持 Range |
| indexed TS/remux | `app/playback.py` 与索引模块；HLS URL `/media/hls/{token}/index.m3u8`，按需原文件范围或 FFmpeg stream-copy |
| 质量保护 | 原路径保留 direct、indexed-ts、indexed-remux；有损转换须明确许可，禁止以性能优化自动降画质 |
| token 生命周期 | `Player.tsx` 的跨挂载 creation/retirement 队列、客户端 token 与 DELETE 退休；不能仅 abort POST 遗失后端所有权 |
| MPV 控制 | `electron/src/mpvClient.ts` 随机命名管道、限定命令/属性、ACK 与真实 seek restart 区分；直接原文件解码 |
| 原生权限 | `app/native_playback.py` 和 `/native-read`，可信媒体 ID、原文件读取租约、SDR/8-bit 色彩门槛 |
| MPV 内嵌 | `nativePlayer.ts`、`nativeEmbedding.ts`、`app/native_window.py`：原生视频 HWND 子窗口 + owned 透明 Electron 控件窗；不是 libmpv Render API |
| MPV 独立 | `independentPlayer.ts`、`independentController.ts`：MPV 自己的窗口与 Lua ASS 控件；可用但不计为本规范 M2 嵌入成功 |
| 字幕/记忆 | HTML5 SRT/VTT/ASS 转换与延迟；`mediaPlaybackState.ts`、`app/media_playback_state.py`、`nativeTrackMemory.ts` 保存源身份关联轨道记忆 |
| 进度/队列 | `/api/media/{id}/progress`、siblings/random/playlists API；SQLite 偏好与退出保存屏障仍保留 |

现有运行库为源码试用的固定开发 EXE；0.41.0 候选在 build 内含 EXE+23 DLL，仅供测试钩子验证。
主运行库未替换，分发准备状态仍 false；既有 Windows 打包配置不会自动提供 MPV。

## 与规范历史描述的差异

1. MPV 已接入两种窗口模式，不能删除后重新声称首次接入。新 M1 flag 只控制新增 HTML5
   Controller，不覆盖旧 `playerEngine` 的显式 MPV 偏好。
2. 已有真实 HWND 嵌入，但透明浮层/多屏/DPI/颜色/打包边界仍存在；旧测试有部分使用
   `--no-sandbox`、headless 环境或仅窗口属性验证，不能替代 M2 正常安全设置的完整验收。
3. 不能通过容器后缀猜测引擎能力：同一个 H.264 MKV 在当前 Chromium 可直接播放。
4. 索引、封装、所有权取消与缓存已有大量实现，M1 不改调度、不统一扩大切片常量。
5. 不增加 Cinema OS，不更改布局/主题，不自动回退到有损转码。

## 已执行测试

| 命令 | M0 结果 |
|---|---|
| `npm run build`、`npm run build:electron` | PASS，构建 `24525a95ed86f041`；既有 Vite 配置与大 chunk 警告，无 TS 错误 |
| `npm run test:backend` | 总计 665 项，664 PASS、1 SKIP；168.216 秒。日志 `build/playback-refactor-20261025/m0-backend.log` |
| Playwright：playback-lifecycle / playback-upgrade / seek-feedback / media-playback-memory / native-launch-lifecycle / native-player-controls | 57 项 PASS；renderer harness，非桌面合成验收。日志 `m0-renderer.log` |
| Node：mpv-client / native-coordination / independent-coordination | PASS，控制、保存、占用、退出与 seek 观察 |
| Node test：playback-timeline / native-runtime | 7 项 PASS |

完整片源矩阵与新的真实 Electron 性能数据记录在 `benchmarks.md`。旧发布版比较、HDR/10-bit、
物理多屏、长时间丢帧不因短测被标为通过。M0 采样脚本的早期失败报告保留，不作为播放器失败。

## 回滚

M0 仅新增报告与基线脚本，不改生产路径。后续回滚应按阶段 flag 或对照本轮源码副本，
保留原有用户修改；不使用仓库 HEAD 覆盖整个 Player。无提交、推送、版本升级或打包动作。
