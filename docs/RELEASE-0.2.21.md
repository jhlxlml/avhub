# AVHub 0.2.21

## 播放体验与可靠性

- 内嵌 MPV 默认通过真实帧就绪通知驱动取帧，GPU 等待移出取帧查询锁，减少状态查询和播放控制被串行等待拖住的机会。旧宿主未发送通知时保留轮询兼容。
- 为 GPU 完成后的纹理引用释放补齐超时保护；释放异常时明确报错并暂停输出，避免无限停留在等待状态。始终等待真实 GPU 与引用释放确认，不提前复用纹理。
- 修正未保存跳播偏好时，设置与两种 MPV 播放入口默认值不一致的问题；保留已保存的精确或智能选择。快速模式仍如实报告关键帧偏差。
- 改善媒体库切换分类和筛选后的滚动定位，同时保留从播放页返回时的位置恢复。
- 构建标识纳入原生 C# 播放源码，前后端使用一致算法，避免原生播放代码不同却显示相同构建编号。

## 验证范围

- 当前源码已覆盖真实 Electron 三种播放路径、实际片源打开与跳播、连续方向键、暂停定位、定位中关闭和跨视频切换；本地便携成品另验收截图、窗口操作、隔离旧库升级、数据目录迁移和退出重开。
- 原画质、分辨率、位深和色彩处理原则保持不变，不自动转码或把 HDR 转为 SDR；独立 MPV 与 Chromium/Hls.js 均保留，默认播放引擎不变。
- 长 GOP 视频精确定位仍需要实际解码；不承诺所有电脑、所有文件均无等待。物理 HDR 色彩、多屏 DPI 和外机未完成本轮新成品验收，不作为视频播放白名单。

## 升级

完全退出旧程序后，将文件夹便携版完整解压到可写目录，运行 AVHub.exe。保留 AVHub-data、自定义数据目录及 avhub-data-location.json。不要只替换一个 EXE，也不要直接在压缩包内运行。

## English

Embedded MPV now requests real frame-ready notifications by default. GPU waiting no longer holds the frame-query lock on this path; older hosts retain polling compatibility. Adds a bounded texture-release wait after GPU completion with an actionable error, while keeping actual GPU and reader-release protection intact.

Aligns unsaved seek-policy defaults across MPV entry points without overriding saved exact/smart preferences, fixes library scroll positioning after category/filter changes, and includes native C# sources in the shared frontend/backend build identity.

Original quality and all three playback paths are retained, with no automatic re-encoding or HDR-to-SDR conversion. Long-GOP exact seeking still has decoding costs. Physical HDR colour, mixed-DPI and other-machine testing of this release package remain unverified.
