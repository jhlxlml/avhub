# AVHub 0.2.19

## HDR 播放修复

- 修复内嵌 libmpv D3D11 播放 PQ HDR 时可能出现的画面过亮、对比度异常。
- 修复 HLG 的隐式亮度转换，采用明确的 GPU 色彩转换，保留浮点精度、广色域分量与 HDR 高光；不把 HDR 自动转为 SDR。
- 调整内嵌播放的帧拉取周期，将处理耗时计入原有调度预算，增加高帧率播放的调度余量；暂停、隐藏和原有资源回收逻辑保持不变。
- 缓存各色彩管线的绑定布局，减少逐帧重复创建 GPU 包装对象的开销。
- 恢复播放前提前启用所属播放时钟，并在播放／暂停后读取真实状态，减少过期暂停状态对首轮调度和控件反馈的影响。
- 保留 Chromium／Hls.js、MPV 独立窗口和内嵌播放，默认引擎及播放会话协调层的默认关闭状态不变。

## 验证与已知范围

- 本轮源码回归覆盖播放状态与时钟竞态、截图、全屏恢复、SDR 播放与 Chromium 回切，并完成真实 VP9 HDR 五分钟播放／跳播检查；生成 HLG 样本另做实际画面帧编号与资源检查。
- PQ／HLG 数值与双屏／不同 DPI 已有前序源码验证；本轮成品的双屏 HDR 复测因当前仅有单屏而暂缓，不将旧构建结果当作新成品验收。
- 真实 HEVC HDR、AV1 HDR、HLG 片源、其他电脑和显示器实际亮度／色域精度仍有未验证项。生成样本通过不代表所有真实片源或显示设备已认证，不新增播放白名单。
- 长时测试的资源回收与收敛检查通过，运行期间 GPU／句柄原始波动仍有超阈记录；个别数据库持久化长尾延迟继续保留观察。

## 升级

退出旧程序后完整解压文件夹 ZIP，保留原有 AVHub-data 或自定义数据目录。单文件 EXE 启动需要自解压。原视频不会因本次修复被改写或重新编码。

## English

Fixes excessive brightness and contrast errors in embedded libmpv D3D11 PQ HDR playback, and corrects HLG transfer conversion. Explicit GPU colour management retains floating-point precision, wide-gamut components and HDR highlights without automatic HDR-to-SDR tone mapping. Embedded frame polling now includes processing time in its existing cadence budget, giving high-frame-rate playback more scheduling headroom while retaining paused/hidden timing and resource cleanup.

Pipeline binding layouts are cached per colour pipeline to avoid redundant per-frame GPU-wrapper allocations. Resuming playback primes its owned clock before unpausing; play/pause commands read back the real native state before publishing it. Chromium/Hls.js, independent MPV and embedded playback remain available. Engine defaults and the disabled-by-default session coordinator are unchanged. Current source regression covers clock/state races, screenshots, fullscreen restoration, SDR playback and Chromium handoff, including a five-minute real VP9 HDR playback/seek run and generated HLG pixel/resource checks. PQ/HLG numerical and mixed-DPI SDR/HDR checks have earlier source evidence; fresh packaged dual-display HDR acceptance is deferred because the current session exposes one screen. Earlier builds do not certify the new package.

Real HEVC HDR, AV1 HDR and HLG footage, other-device compatibility and physical colour accuracy remain partly unverified. Generated charts do not certify real footage. Resource cleanup/convergence passed, while raw GPU/handle range exceptions and occasional durable-write tails remain recorded. Exit the old app, extract the entire folder ZIP and preserve your data directory. Original media is not rewritten or re-encoded.
