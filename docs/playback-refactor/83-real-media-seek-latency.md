# 本机真实视频跳播长等待专项排查

2026-11-08，承接 78 的同步属性优化与后续播放功能修复。保持生产配置与版本 0.2.19，不打包、提交或推送。

## 执行与样本

扩展 electron/test/mpv-seek-paired.mjs，支持 AVHUB_MPV_REAL_HDR=1 或 AVHUB_TEST_SEEK_SOURCE（仅允许 E:/downloads 下绝对路径）进行只读副本配对。两条 MPV 路径各执行精确/关键帧、暂停/播放状态配对，并保留连续跳播及智能/短跳回归。原始视频与隔离副本 SHA256 前后一致。

- VP9 4K PQ MKV：The World in HDR in 4K (ULTRA HD).mkv。build/mpv-seek-paired-VaLlnl/report.json PASS，退出码 0。
- AV1 3840x2160 + AAC，321.294512 秒 MP4：4-model-tina-bikini-2-at-busqueen.mp4。build/mpv-seek-paired-zTPlz7/report.json PASS，退出码 0。

以上为真实 Electron 应用的操作链路、真实 MPV 解码时钟与原生 GPU 确认证据。当前 SDR 环境不宣称物理 HDR 输出、外机或 PotPlayer 同条件端到端表现。独立 EXE 无 GPU 呈现回执，完成时间仅为真实 MPV 状态确认，不与内嵌回执混同。

| 文件/链路 | 精确中位数 / P95 | 关键帧中位数 / P95 |
| --- | --- | --- |
| VP9 HDR，内嵌 | 387.62 / 492.19 ms | 44.10 / 67.18 ms |
| VP9 HDR，独立 EXE | 397.89 / 520.39 ms | 42.87 / 121.45 ms |
| AV1 MP4，内嵌 | 569.18 / 574.44 ms | 45.08 / 54.06 ms |
| AV1 MP4，独立 EXE | 537.60 / 656.19 ms | 50.78 / 166.09 ms |

均为每种策略 12 次样本，统计含队列和状态完成；缓存未全局清空，不作为冷硬盘 I/O 试验。内嵌 AV1 的最长精确样本：命令排队 0.588 ms，seek 事件 3.91 ms，restart 532.58 ms，GPU 确认 570.55 ms，状态完成 573.85 ms。保持 d3d11va，sourceLoads=1，cacheWaitMs=0，未观察到 >=20 ms 的受限同步属性慢调用。没有证据把这批半秒等待归为新的 React 提示或纹理 ACK 阻塞；主要时间位于 restart 之前的 MPV 解码恢复阶段。

## 关键帧与精确解码工作量

使用 ffprobe 的 packet flags/PTS 读取关键帧，而非把所有解码帧当作关键帧：HDR 文件共 50 个关键帧。5 秒的前置关键帧为 0 秒，38 秒为 35.302 秒，73 秒为 71.972 秒。按约 59.94 fps 估算分别需要处理约 300、162、62 帧的前置内容，精确耗时约 0.49、0.39、0.16 秒，趋势相符。关键帧定位快，但这几个目标的实际偏差明显；不能把精度降低称为精确跳播提速。

最初尝试 ffprobe -skip_frame nokey 时，当前 VP9 解码输出仍含连续普通帧及色彩 side-data，且产生过量输出，已中止，退出码 1；不采用该结果。后改为只读 show_packets/flags 分析，退出码 0，无视频解码和源修改。

## 参数试验与处理

测试工具可通过 AVHUB_TEST_MPV_EXTRA_FRAMES=6/16/32 显式指定独立 MPV 硬解额外表面队列，仅在隔离测试进程注入，不进入应用配置。

HDR 独立 EXE 16 帧试验 build/mpv-seek-paired-AukscM/report.json PASS，退出码 0；精确中位数/P95 为 402.36/535.36 ms，默认为 397.89/520.39 ms；关键帧亦未变快。增加硬解表面消耗显存却无实测收益，拒绝推广，生产参数未改动。

核对固定本地 libmpv 源码 options/options.c 和 DOCS/man/options.rst，hr-seek-framedrop 默认已启用；重复显式开启没有新增优化。不得通过 vd-lavc-fast、跳过环路滤波、关闭硬件解码、静默转码或伪造呈现完成绕过等待。本轮没有安全且可证实有效的生产提速参数，因此不声称完成新一轮提速。

## 待定位范围

本轮两份真实片源的测量窗口未复现数秒或 15 秒定位超时。已向用户询问具体慢文件、内嵌/独立模式和起止时间，以区分这批数百毫秒精确解码成本与其他异常阻塞。需在相同位置复现后再调整，不能根据当前结果断定所有视频的长等待都是正常解码。

当前继续使用现有精确/快速/智能选项，默认不变。用户显式选快速模式时只改变定位精度，原始画质不变。回滚本轮仅涉及测试脚本参数与本记录，无生产播放行为变更。git diff --check 退出码 0。
