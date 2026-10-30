# M2：4K F16、显存预算与异常传播

> Intel灰阶差异的后续定位及修正见 [07报告](07-intel-precision-isolation.md)。本文保留当轮证据与失败项。

2026-10-25。仍处于隔离 M2 PoC，**完整门槛未通过，M3–M5 不启动**。
沿用 M0 的 Git 基线与原有工作区；本轮不更改生产引擎、原画策略、版本号或用户媒体。
所有媒体均为 build/libmpv-render-spike/samples 中明确生成的测试片，未访问 E:\downloads。

## 修改

- source-contract.cjs/test：F16 三表面估算硬上限256MiB，RGBA8仍128MiB，源尺寸不缩小；8K F16继续拒绝。
- SharedSurface.cs：分配前查询当前适配器的 DXGI 进程本地显存预算。
  要求表面估算不超过预算的1/4，剩余额度至少覆盖估算加256MiB余量；无法查询或额度不足即拒绝。
  F16绘制每秒复查，已用量超过预算则停止并报错，不减位深或转码。
  这些是保守 PoC 策略，不是 Windows 保证的保留量，也不涵盖 Electron 独立进程的全部占用。
- 原生初始化失败时释放已分配资源，释放可重复调用；清理锁住的互操作资源。
  未识别GL厂商及同厂商多个适配器拒绝猜测选择；尚未实现精确LUID匹配。
- main.cjs/RenderHost.cs：发现渲染线程错误立即传播至UI并退出宿主，避免画面停住后仍报告正常。
  新增测试专用渲染异常注入，以及测试专用 `AVHUB_RENDER_SOFTWARE_DECODE=1` 解码对照开关。
- preload.cjs：记录实际WebGPU适配器，增加已知灰阶平台取样和单调性测量，防止只用总灰阶数判断精度。
- framecode-fixtures.mjs：新增lossless HEVC10-bit、3840×2160、25fps、6秒合成坡度/帧编号样本。
  独立FFmpeg仍解码原始10-bit值；仅裁两行输出以避免整帧诊断缓冲超限，不缩小播放源。
- 原生预算的8项边界单元检查加入Windows CI；真实GPU验证仍必须在Electron运行，不由这些单元测试替代。
- 共享画布验收不再读取无关前台窗口，只检查本身窗口和子窗口；旧HWND诊断仍需要前台窗口证据。

预算API依据：[QueryVideoMemoryInfo](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/nf-dxgi1_4-idxgiadapter3-queryvideomemoryinfo)、
[预算结构](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/ns-dxgi1_4-dxgi_query_video_memory_info)。
微软说明超过进程预算可能导致分页和卡顿，因此不能仅依据显卡标称显存决定分配。

## 已通过的项目与实际限制

| 验证 | 证据 | 结果 |
| --- | --- | --- |
| 4K F16开发态60次跳播 | evidence-vijXIl | 实际导入像素帧编号误差0，尺寸3840×2160，144/144释放 |
| 灰阶平台补测 | evidence-WBLCAL | 画布总1428值、平台848值、无反向步进；不是完整色彩验收 |
| 关闭硬解对照 | evidence-RGKsbz | hwdec=no，平台仍848；目前不能归因于硬件解码 |
| 渲染线程故障 | evidence-9TARGp | 显示错误、退出宿主、主界面保留，退出约68ms |
| 隔离成品导入故障 | evidence-zqd9TC | 4次目标帧准确、导入故障处理成功，退出约79ms |
| RGBA8最终原生代码回归 | evidence-sNK2yp | 画面、4次目标帧、窗口操作与退出通过 |
| 最终成品60次跳播资源验收 | evidence-hmKFBI | **失败**，句柄增长断言未通过，不能算完整成品通过 |

本轮实际原生和WebGPU均使用Intel UHD770；与上一轮RTX4090结果分别记录，未强制改变系统GPU设置。
合成源有877个平台，Intel画布平台仅848，且最大值约0.99756。总灰阶数1428并不意味着精度更好；
目前只能证明这次输出没有被压成RGB8，不能宣称877个平台全部保留或通用色彩准确。
软件解码对照相同，后续须隔离原生YUV/RGB渲染与共享F16输出环节。

60次开发态中，三表面估算199,065,600字节，原生DXGI实际用量约1.24GiB，私有内存约1.38GiB。
最终成品失败报告三轮句柄671→579→726，轮后727，超出原阈值；同期GPU用量约1.338GB、
私有内存约1.487GB。不能仅根据GPU和私有内存接近稳定就忽略句柄断言，也不能断言已经证明句柄泄漏。
这些并非整个应用的总内存，亦不是15分钟或真实高码率媒体压力结果。

首轮 evidence-UJM0gO 因前台窗口证据脚本异常失败；本轮保留报告，修复共享画布不必要的全桌面前台读取后复测。
该次失败成品为 package-20261025T074450893Z/win-unpacked/AVHubRenderSpike.exe，仅用于M2本地验证，不是AVHub发行包。

## 句柄失败的后续定位与修复

未放宽上述原断言。追加暂停且纹理已释放的10次采样后，evidence-3Col8w显示约2秒内句柄
568→705持续增加，纹理导入/释放保持50/50，GPU与私有内存不变。
同代码另一次60跳播 evidence-5emaxC 虽然偶然通过原断言（695→632→796，轮后571），
不能用这次通过抹去失败；这也说明仅在每轮末取一个计数不足以判断稳定性。

源级检查找到高频状态查询的WinForms同步 `Invoke` 调度：每条请求创建框架等待项，
等待资源的释放时机会让短期句柄计数持续上升后下降。
ReadInput改为 `BeginInvoke` 加 `Monitor` 的有界等待，不访问 `AsyncWaitHandle`、不创建每请求内核等待事件，
回调仍在原UI线程执行，保留10秒超时与原错误传播。
没有调用强制GC或修改收敛阈值来通过验收。
参考：[WinForms等待项实现](https://source.dot.net/system.windows.forms/System/Windows/Forms/Control.ThreadMethodEntry.cs.html)。
这是隔离宿主的调度修复，不是对所有驱动或生产播放器作相同归因。

修复后 evidence-pJtQi6 的60次跳播通过，句柄564→569→569、轮后569，
追加2秒10次采样均569；导入/释放150/150，注入渲染线程异常也通过。
原收敛断言继续保留，并新增暂停采样句柄范围≤8、私有内存/GPU末轮增长≤64MiB的检查。
这些为短期回归门槛，不是长期无泄漏或低内存认证。

包含修复的最终隔离成品为 package-20261025T075803799Z/win-unpacked/AVHubRenderSpike.exe，
验收 evidence-Oppz7J：60次实际目标帧误差均0，句柄568→573→573，2秒10次采样均573；
末轮私有内存增401,408字节、GPU用量减131,072字节；导入/释放152/152。
注入导入故障被正确处理、退出约95ms，原生宿主无残留。Intel灰阶平台差异仍存在，完整M2未放行。
调度修复后的最终RGBA8回归 evidence-myje6Y 也通过，原尺寸画面、4次目标帧、全屏进退和退出正常。

此前60次带同步诊断的 example evidence-5emaxC，目标像素帧时间p50约322ms、p95约953ms，
不能声称速度已经优于现有播放器；同源、同GPU、排除诊断读回的正式性能比较尚未完成。

## 测试与后续门槛

- Node源契约与M1引擎：18/18。
- 实际C#预算策略单元检查：8/8；不是实际GPU内存不足模拟。
- Python运行库准备10/10、CI配置12/12；默认拒绝10-bit/HDR负向样本通过（quality-guards-70J5Ho）。
- HDR仍拒绝；8-bit显示器无法证明物理HDR输出。没有用BT.709/sRGB固定设置接收HDR冒充原画。

复现4K资源验收：

```powershell
$env:AVHUB_RENDER_SHARED_TEXTURE='1'
$env:AVHUB_RENDER_FP16='1'
$env:AVHUB_RENDER_SDR10='1'
$env:AVHUB_RENDER_SAMPLE='Precision-SDR10-3840x2160.mkv'
$env:AVHUB_RENDER_STRESS_SEEKS='16'
$env:AVHUB_RENDER_SEEK_ROUNDS='3'
node electron/test/render-api/spike.mjs
```

下一步优先：用独立原生/共享表面灰阶对照定位Intel精度差异，并评估4K F16实际内存与诊断开销。
保留所有失败报告与原阈值，不能以偶然重跑通过掩盖旧问题。
随后才推进HDR输出契约、混合DPI、更多GPU和长时间压力。生产接入继续等待完整M2证据。
