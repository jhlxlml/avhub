# M2：按需像素读回与真实 GPU 完成回归

2026-10-25。M2 仍未通过完整门槛，M3–M5 未开始。本轮仅修改隔离的
`electron/test/render-api/` PoC，不改变生产播放器、界面或默认引擎。

## 改动及边界

此前 SDR F16 呈现每帧都复制三行像素到 staging buffer，并执行 `mapAsync`，
用于灰阶及帧号验收。它不是视频的 CPU 上传路径，但增加了诊断开销。

- 默认 `AVHUB_RENDER_READBACK_MODE=on-demand`；`always` 仅作旧路径对照。
- 正常 F16 帧保留 WebGPU 绘制，并等待 `queue.onSubmittedWorkDone()` 后才关闭
  VideoFrame 和释放共享引用；没有取消 GPU 等待或提前释放。
- 可信主进程的 `probeFrame()` 经 preload 确认后请求原生重绘，暂停时无需额外 seek
  或重开源。一个探针在途、请求合并，超时/故障/关闭拒绝等待；不暴露给 React 业务桥。
- 画质及跳播检查显式读取真实像素，对照 FFmpeg 独立解出的源帧号与 877 个灰阶平台。
  正常帧不更新像素探针结果，测试不能把旧 dataset 当成当前画面。
- 指标只保留最近 512 个呈现服务时间；记录真实 GPU 完成、呈现和读回计数。

原生前十次精度读回、GL 完成等待、D3D 复制及主进程轮询仍在。
这不是零拷贝、物理扫描输出或端到端解码 FPS 认证。显式探针会重绘同一源帧，
不能把 presenter 次数当成解码帧数；也不据此声称正式 AVHub 的跳播已经改善。

## 同片短时对照

生成样本 `Precision-SDR10-3840x2160.mkv`，3840×2160、25fps、SDR10。
当前 RTX4090 GL/D3D 精确 LUID 均为 `000000000000BC1E`；F32 内部 FBO 和 F16 输出不变。
每次约 3.5 秒，含四次显式探针。时间为 renderer 单帧服务时间，弃去前五个样本。
所有报告保留在 `build/libmpv-render-spike/`。

| 报告 | 模式 | 呈现 / GPU 完成 | 读回 | p50 / p95 ms |
|---|---|---:|---:|---:|
| evidence-bTq2Bd | always | 78 / 78 | 78 | 4.1 / 5.2 |
| evidence-BFB8Hg | on-demand | 79 / 79 | 4 | 3.6 / 4.8 |
| evidence-6XmaRI | always | 79 / 79 | 79 | 3.9 / 4.9 |
| evidence-GkyPpw | on-demand，独立确认 | 78 / 78 | 4 | 3.5 / 4.9 |
| evidence-UcRffU | always，独立确认 | 78 / 78 | 78 | 4.1 / 5.1 |

首组三次的第二个进程尚未显式等待退出时启动了第三次调度，因此不称其为严格无重叠基准。
后两次独立确认明确等待前一测试结束，并新增测量 UTC 起止：
10:53:20.344–10:53:23.889 与 10:59:07.802–10:59:11.339。
二者实际像素码均为 [25,51,77]，mpv decoder drops 均从 0 到 0。

仅能得出：此样本约 95% 的 renderer 诊断读回被消除，短时单帧服务时间略降。
热缓存短样本不能外推为长视频、4K60、8K、其他设备或整应用 p95 改善。
新 seek 检查含探针握手，与旧的每帧自动读回计时不可直接比较。

## 真实 Electron 回归

| 测试 | 证据与结果 |
|---|---|
| 开发态 4K SDR10，三轮共 60 次 seek | `evidence-9HLwUG`；像素帧误差均 0；877 平台保留，传输灰阶最大差 2.5e-8 |
| 开发态资源与关闭边界 | 导入/释放 231/231；暂停句柄范围 1；末轮私有内存增 376,832 字节、GPU 增 0；挂起帧 233 大于最后导入 232，关闭后零新增；宿主退出约 747ms |
| 私有成品同样 60 次 seek | `evidence-HyGAJZ`；像素误差全 0、877 平台与灰阶差一致；231/231；资源结果一致；关闭约 731ms，无残留 |
| 成品真实纹理导入故障 | `evidence-L4nTbk`；错误上报，成功导入/释放 53/53，故障 1，宿主退出，主 UI 保留；收尾约 74ms |
| 成品原生渲染线程故障 | `evidence-OMCHFV`；错误上报，54/54；宿主退出，主 UI 保留；收尾约 69ms |
| 默认 RGBA8 | `evidence-eHsrfz`；实际像素跳播、React 菜单、全屏和最小化恢复通过 |
| HDR 色块 V2 | `hdr-pixels-GqXONr`；源帧逐字节匹配；离屏 GPU/独立 CPU 最大相对误差约 6.394e-5，9 个负分量保留；12/12，未显示 HDR |
| HDR 灰阶 | `hdr-pixels-Oqj61Y`；离屏数值回归通过；仍不认证实际 HDR 显示 |

私有成品 `package-20261025T110044377Z/win-unpacked/AVHubRenderSpike.exe`
仅用于 M2 要求的隔离 packaged 验证，不是 AVHub 正式发行包，不上传发布。
原生宿主私有内存仍约数 GiB，没有降低 RAM 用量的结论。

Node 引擎/源契约/显示资格/HDR 数学及色彩参考 **34/34**；C# 内存策略 **8/8**；
Python libmpv 暂存 **10/10**、CI 配置 **12/12**。真实编码的拒绝降位深/拒绝 HDR
负向检查 `quality-guards-SJGnR9` 通过；JS 语法通过。这不是重跑生产应用全套测试。

复现开发态压力及关闭边界（使用新 PowerShell 会话，避免遗留故障变量）：

```powershell
$env:AVHUB_RENDER_SHARED_TEXTURE='1'
$env:AVHUB_RENDER_FP16='1'
$env:AVHUB_RENDER_SDR10='1'
$env:AVHUB_RENDER_SAMPLE='Precision-SDR10-3840x2160.mkv'
$env:AVHUB_RENDER_STRESS_SEEKS='16'
$env:AVHUB_RENDER_SEEK_ROUNDS='3'
$env:AVHUB_RENDER_TEST_CLOSE_BOUNDARY='1'
node electron/test/render-api/spike.mjs
```

成品使用独立 `package.mjs` 后运行 `spike.mjs --packaged`，入口校验源码指纹。
性能测量另设 `AVHUB_RENDER_MEASURE_PLAYBACK=1`、`AVHUB_RENDER_READBACK_MODE`，
不要混入故障或关闭边界变量。各 GUI 测试串行运行。

## 未完成门槛与下一步

M2 保持 false：实体 HDR、混合 DPI/多屏和更多 GPU、复杂 ASS/OSD 叠层、
长时间压力及 15 分钟解码帧验收、许可及再分发材料仍未齐备。
当前 SDR 环境不能用离屏数学代替实体 HDR 证据。
下一轮先补隔离 PoC 字幕/OSD 与输入焦点，再推进长时压力；硬件限制保留为阻断，
不改系统 HDR/DPI 设置，不提前接入 M3。

上述固定ASS/OSD、React菜单和焦点验证已推进，见 [12报告](12-subtitle-osd-and-focus.md)。

根 package.json、用户计划保持 M0 摘要；冻结网页版未改动。无版本提升、提交或远程推送。
