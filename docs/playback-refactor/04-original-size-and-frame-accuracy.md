# M2：原始尺寸、实际目标帧与资源验证

> 后续 F16/10-bit SDR 精度验证见 [05 报告](05-float16-and-high-bit-depth.md)。完整 M2 仍未放行。

2026-10-25。本轮继续隔离 PoC，**未接入生产 MpvEngine、未进入 M3–M5**。
保留原应用、默认引擎与原有工作区修改。仅生成并读取应用 build 目录中的测试片，未访问或修改用户视频。

## 实施内容与实际修复

1. 共享纹理改为按源的原始尺寸创建；视频窗口调整、全屏不改变纹理/canvas像素尺寸。
   NativeHost二次校验尺寸，三份RGBA表面的估算预算上限128MiB；超限拒绝，禁止以缩小分辨率通过。
   这是表面预算，不是全部显存或进程内存上限。当前支持每个单源进程的初始尺寸，流中途变尺寸拒绝，
   不是已经实现通用分辨率切换。
2. 增加独立源契约：仅允许明确的8-bit BT.709 SDR、已支持像素格式/比例/旋转。10-bit、HDR、未知
   或冲突色彩、未验证旋转/PAR全部拒绝，不自动转码、降位深、缩小或HDR→SDR。
   显式保留输入色彩信息；正常SDR显示输出声明RGB / BT.709原色 / sRGB传递 / full range，
   MPV也使用相应SDR显示目标。这是显示转换，未修改原片，不等于已完成色准认证。
3. FFprobe流级信息可能没有原色/传递函数；本轮实际发现H.264 VUI和解码首帧有BT.709证据。
   现在合并流与首帧信息，冲突时拒绝，不能把未知值猜成SDR。AV1初版生成样本标签也不足，
   已保留旧样本，通过应用自产测试片的stream-copy生成带明确标签的新版本；未放宽入口。
4. 视频每帧的顶部编码16位帧编号。测试从实际VideoFrame导入后的canvas像素读取编号，
   并对照另一条FFmpeg源解码结果，不能用time-pos、ACK或绘制计数冒充到达目标。
   该校验发现并修复了上一轮PoC的上下翻转：默认窗口FBO与共享纹理的flip_y规则需要区分。
5. 纹理导入异常时撤销未产生GPU对象的引用屏障，防止关闭时留下无意义的5秒等待；补故障注入。
   另发现信号退出后exitCode可能仍为空，现改为按实际exit事件确认宿主退出，避免再等2秒。
6. 修复PoC源信息IPC注册顺序，防止React初始化时抢先请求尚未注册的handler。
   增加导入/释放、单个在途纹理和原生资源采样，异常不能通过隐藏画面/提示来伪装正常。
7. 生成样本使用独占锁、空间/容量限制、验证后的原子无覆盖发布、有限编码超时与临时文件清理；
   原有生成样本不覆盖。打包指针绑定运行时代码摘要，过期PoC不得充当最新源码验收。

## 实测结果

均为真实Electron、正常D3D11/GPU和沙箱；RTX4090、125%单屏。新方案的视频和React控件在
同一个Electron合成页面；没有可见的原生视频子窗口或弹出播放器。测试图像取自实际Electron合成画面，
不是物理显示器扫描或HDR显示认证。样本均为6秒、25fps、SDR生成片，不外推到长电影/VFR/60fps。

报告前缀：`build/libmpv-render-spike/`。

| 项目 | 结果和原始报告 |
|---|---|
| 640×360 H.264 | 源/纹理/canvas尺寸一致，4次像素帧编号通过；`evidence-NlIYO3/acceptance.json` |
| 1920×1080 H.264 | 原始尺寸、方向、4次目标帧及窗口生命周期通过；`evidence-G6xrQk/acceptance.json` |
| 3840×2160 H.264 | 三轮同序列共132次，全部实际帧误差0；`evidence-cPiUOw/acceptance.json` |
| 3840×2160 HEVC | 三轮132次，全部实际帧误差0；`evidence-5pl7x1/acceptance.json` |
| 1920×1080 AV1 | 三轮132次，全部实际帧误差0；`evidence-MmpPVm/acceptance.json` |
| 真实编码10-bit SDR/PQ元数据负例 | 在进入8-bit纹理路径前拒绝，源摘要不变；`quality-guards-ca43A2/acceptance.json`。不是HDR播放通过 |
| 最新打包态4K + 导入失败注入 | 原始3840×2160、4次目标帧误差0、界面/菜单可用、宿主退出确认、无孤儿进程；`evidence-9QzcJu/acceptance.json` |
| 依赖准备单测 | 10/10；`stage4-prepare-tests.log` |
| 源契约 / M1控制契约 | 7/7 + 9/9；`stage4-contract-tests.log` |
| CI契约 | 12/12；`stage4-ci-tests.log`。首次受沙箱临时目录权限阻止，正常权限重跑通过，未运行远程CI |
| 新缓存实际生成/原子发布 | `fixture-atomic-3Iv2lr/acceptance.json`；独立源解码编号0/31/52/109/128正确，无残留lock/part文件 |
| TSX/JS/C#与差异 | TSX独立类型检查、JS语法、实际C#编译通过；diff检查无错误，存在先前文件的行尾提示 |

H.264/HEVC/AV1均实际使用NVDEC。目标允许误差原设为1帧（40ms），上述三轮测试396次观测均为0，
没有通过扩大误差通过测试。测试包含GPU像素读回与轮询开销，不能当作播放时延/性能提升基准。

## 资源增长没有被忽略

最初44次H.264跳播，原生句柄801→831，触发8个增长预算而失败；记录保留于
`evidence-3IBn4O/acceptance.json`，没有删除失败或简单扩大阈值。
随后重复完全相同序列三轮，在各轮末采样，检查稳定阶段，单轮功能测试仅记录预热结果，不冒充收敛验收：

| 样本 | 三轮末句柄 | 纹理导入 / 释放 | 最大在途 |
|---|---|---|---|
| H.264 4K | 780 → 793 → 787 | 258 / 258 | 1 |
| HEVC 4K | 966 → 857 → 775 | 205 / 205 | 1 |
| AV1 1080p | 858 → 913 → 682 | 163 / 163 | 1 |

句柄并未持续逐轮增长，末两轮仍使用原8个增长阈值；结果支持短测资源能回落/收敛。
这不是完成根因归类或证明不存在长期泄漏，仍需长时间实测；驱动缓存/运行时回收尚未精确归因。
报告同时保留working set和private bytes，不能把这些进程指标当成显存。

导入异常先前一次关闭约2076ms；修正exit事件判断后，最新打包态4K异常关闭约78ms。
两次都是隔离PoC观测，不是正式AVHub退出性能比较。最新导入36/释放36、失败1，
`nativeExitConfirmedBeforeClose=true`；退出前没有悬空引用等待。

## 本地打包范围与复现

最新本地隔离程序：
`build/libmpv-render-spike/package-20261025T053644405Z/win-unpacked/AVHubRenderSpike.exe`。
此为私有M2测试程序、版本0.0.0，不是AVHub发布版。主项目仍为原版本，未推送、未上传。
成品DLL/宿主从resources/spike加载，源契约、样本摘要和运行时代码摘要均受校验。

```powershell
$env:AVHUB_RENDER_SHARED_TEXTURE='1'
$env:AVHUB_RENDER_SAMPLE='Framecode-v2-3840x2160-hevc.mkv'
$env:AVHUB_RENDER_STRESS_SEEKS='40'
$env:AVHUB_RENDER_SEEK_ROUNDS='3'
node electron/test/render-api/spike.mjs
node electron/test/render-api/quality-guards.mjs
# 按需进行隔离本地PoC目录打包，不调用AVHub正式发布脚本
node electron/test/render-api/package.mjs
node electron/test/render-api/spike.mjs --packaged
```

其他样本名参见`framecode-fixtures.mjs`。测试结束后清除相应环境变量；正式应用不读取这些PoC开关。
`AVHUB_RENDER_INJECT_IMPORT=1`用于明确的导入失败注入，不能与正常播放表现混为一谈。

## 阶段决定和下一步

原始尺寸、实际目标帧和短测资源证据已补齐，**M2完整门槛仍不宣布通过**，不提前注册生产MpvEngine。
仍缺少高位深/HDR输出、精确颜色验证、其他显卡/同厂商多GPU的LUID匹配、设备丢失、物理混合DPI/
多屏，以及完整现有播放器控件/字幕业务的共享纹理验证。当前高位深是安全拒绝，不是已支持。

下一步优先：独立验证RGBA16F及HDR/10-bit显示契约 → 补适配器能力和设备异常 → 根据可用硬件
完成实际显示验收，重新评审M2。不得为尽快进入M3而把未验证输入自动降成RGBA8。

本轮文件：`source-contract.cjs`及其测试、`framecode-fixtures.mjs`、`quality-guards.mjs`；
`SharedSurface.cs`、`RenderHost.cs`、`main.cjs`、`preload.cjs`、`controls.tsx`、`spike.mjs`、
`package.mjs`均位于`electron/test/render-api/`。CI只新增纯源契约测试，不在无GPU云端模拟原生通过。
03报告追加阶段链接。生产播放器、用户媒体、主版本号和归档没有本轮修改。

回滚：不运行隔离PoC即可维持原应用；若撤销本阶段，只撤销这些PoC/测试/文档增量，
保留前轮M1和用户修改，禁止整树reset。
