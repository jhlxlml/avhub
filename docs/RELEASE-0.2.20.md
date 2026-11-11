# AVHub 0.2.20

## 播放体验

- 改善 MPV 内嵌与独立窗口的跳播调度、连续快进快退、暂停定位及旧请求取消，减少命令排队与状态纠偏造成的等待。
- MPV 默认使用快速关键帧定位，可随时切换智能或精确模式；快速模式可能落在附近关键帧，不将其标记为精确定位。
- 修复部分 MKV 的倒序 Cues 索引标记兼容问题，避免首次远跳无谓顺序扫描大量视频数据；两套 MPV 使用同一源码补丁。
- 优化原生播放启动、缓存复用、输出失败诊断及退出恢复；截图继续保持原始分辨率与位深。
- 保留 Chromium/Hls.js、MPV 独立窗口和 libmpv D3D11 内嵌。默认引擎不变，不自动降画质、重新编码或把 HDR 转为 SDR。

## 可靠性与验证范围

- 增加跳播阶段诊断、统一可复用测试媒体及双运行库源码/补丁/构建材料校验。
- 两条 MPV 路径已有真实 Electron 播放、跳播、字幕、音轨、截图和资源回收回归；0.2.20 候选 EXE 另通过独立窗口、内嵌播放及模式切换验收，最终 EXE/ASAR/运行库与该候选字节一致。
- 文件夹 ZIP 与单文件 EXE 均通过启动、合成旧库升级、数据目录迁移、偏好保留和退出重开验收；后端回归 800 项无失败，2 项因 Windows 不允许创建测试链接而跳过。锁定依赖安全审计无已知漏洞。
- 个别文件、硬件解码器和显示器仍可能有差异。物理 HDR、多屏 DPI 和外机尚未完成本轮最终成品验证，不作为播放准入限制。
- 长时间资源回收有前序测试，不能据此承诺所有电脑、所有文件均无丢帧或等待。特定大文件在 Chromium 中丢帧的问题仍保留后续分析。

## 升级

退出旧程序后完整解压文件夹便携版，运行 AVHub.exe；保留 AVHub-data、自定义数据目录及 avhub-data-location.json。原视频不会因升级而改写。

## English

Improves MPV seek scheduling, repeated seek handling, paused seeks, startup and failure diagnostics. Fast keyframe seeking is the MPV default, with smart and exact modes still available. Fixes malformed reversed Cues references in some MKV files in both embedded and independent MPV runtimes, avoiding unnecessary sequential scanning on the first far seek.

Original quality, bit depth, colour information and all three playback paths are retained. No automatic re-encoding, resolution reduction or HDR-to-SDR conversion. Physical HDR, mixed-DPI and other-machine validation of the final package remain explicitly unverified; these are not playback restrictions.
