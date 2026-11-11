# 独立 MPV 截图位深修复

2026-11-09。版本保持 0.2.19，HEAD 仍为 f3f65dbc321b54541f09be6b1558fb9e4f5eab27，保留其他修改。最终源码构建 b131a7803dba1dc9；原生 libmpv/宿主及 preload GPU 数学未改，仍为 KhYHON。未打包、提交或推送。

## 实际问题与过程

MPV EXE 启动参数原为 `--screenshot-high-bit-depth=no`。实际独立窗口的生成 4K 10-bit HEVC 源，经应用自己的截图/发布服务保存的 PNG 只有 8-bit。

- `mpv-independent-reopen-dcmniR`：FAIL / 1，源 3840×2160、10-bit，实际 PNG bitDepth=8，未通过期望 16 的断言。
- 第一版改为启动默认 high-bit-depth=yes；`mpv-independent-reopen-LYB0It` PASS / 0，4K PNG 变为 16-bit。
- 随后补查普通 8-bit 源，`mpv-independent-reopen-uZAaTj` FAIL / 1，实际也变为 16-bit。它没有丢失精度，但不符合普通源截图保持 8-bit、避免额外体积的目标，因此没有以该尝试作为最终方案。

## 最终实现

`MpvClient.prepareScreenshot()` 在截图前读取实际 MPV `video-params`。优先使用硬件子格式，例如 nv12 / p010；只对明确已知的 8-bit 格式（如 NV12、YUV420P、RGB24 等）选择 8-bit PNG，其余高位深或未知格式保守保留高位深。不依据时长、扩展名、标题或不完整色彩标签猜测位深，不限制任何格式播放。

共享 `nativeCapture.ts` 仅在客户端具备该准备方法时调用；MPV EXE 两类窗口复用，原生 Render API 的 FP16 截图实现不变。默认启动仍保守允许高位深，但每次应用截图都会按实时格式设置。没有改变解码器、播放画质、分辨率、色彩策略或 PNG 的无损压缩级别/滤镜。

## 验收

- 前端、Electron 构建：PASS / 0。
- `mpv-independent-reopen-7VAnQy/report.json`：真实 Electron / 独立 MPV 三格式播放、暂停跳播、截图、关闭，PASS / 0。实际保存 Small.mp4 为 640×360、8-bit PNG；HEVC4K.mkv 为 3840×2160、16-bit PNG。Transport.ts 正常播放/退出。
- 三次正常退出均记录 pipeClosed=true、exited=true、exitCode=0、signal=null；源 fixture SHA256 前后一致。
- `node electron/test/mpv-client.mjs`：控制队列、真实目标、错误/退出保护及 seek 合约 PASS / 0。
- 文档 92 中的 GPU/SDR/PQ/HLG 及 15 步综合结果属于前一构建 932a263a92727ce1；本次只变更 EXE 截图位深准备与参数，不能把前一构建的成品或物理色彩验收冒充本次新包结论。本轮未打包。

高位深 PNG 可能比此前错误的 8-bit 输出更大，是保留精度的合理代价；已知普通 8-bit 格式没有一律扩为 16-bit。截图仍是 RGB 图像，不声称与源 YUV 压缩码流逐比特相同，也不声称所有 HDR 查看器的显示效果一致。

文档 92 的一次独立 MPV 连接中断仍未解释。本修复与新增退出日志都不构成对该问题已修复的声明。
