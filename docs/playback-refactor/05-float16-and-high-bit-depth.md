# M2：F16 与 10-bit SDR 实际精度验证

> 后续4K资源验证与未通过项见 [06报告](06-4k-float16-resource-validation.md)。本文128MiB限制为当轮状态。

2026-10-25。继续隔离 Render API PoC，未改动生产播放器，未注册 MpvEngine，未进入 M3–M5。
本报告补充 04；前轮仅支持 SDR8 的限制不再完整描述当前诊断能力，但完整 M2 门槛仍未通过。

## 找到的问题及修正

生成应用自有的 lossless HEVC 10-bit BT.709 SDR 样本，1024×256、25fps、6秒。
其上方包含可独立解码的帧编号，下方灰阶坡度包含 877 个亮度值（64–940）。
独立 FFmpeg 解码读取原始 yuv420p10le 数据，验证源精度，不能用 RGB8 截图证明 10-bit。

| 实际路径 | 原生 FBO 灰阶数 | Electron 画布灰阶数 | 结果 |
| --- | ---: | ---: | --- |
| F16 纹理，MPV 默认中间缓冲与抖动设置 | 256 | 256 | 失败，不能据格式名称宣称保留精度 |
| 显式 rgba16f 中间缓冲，dither-depth=no，Canvas2D float16 | 877 | 256 | 原生段修复，Canvas2D 路径仍失败 |
| 同一原生设置，WebGPU 外部 VideoFrame → rgba16float canvas | 877 | 877 | 本机该合成 SDR10 样本通过 |

失败证据分别保留在 build/libmpv-render-spike/evidence-voVrBP、evidence-eaHxAC。
实际通过报告为 evidence-EMGBCj/acceptance.json；先前首次通过为 evidence-OCEMEr。
Canvas2D 问题的内部精确归因尚未确定，仅确认本机该路径发生量化，不能归咎于所有 Canvas2D 实现。

共享资源为 D3D11 RGBA16_FLOAT，查询 OpenGL 附件 redBits=16。Electron 接收 rgbaf16 VideoFrame，
WebGPU 使用 texture_external 采样并写入 rgba16float 画布；不先转到 Canvas2D。
没有通过 CPU 上传视频：GPU 到 CPU 的三行读取仅用于本次验证，存在同步开销，不能作为性能提升或零拷贝的证据。
当前只验证 BT.709 SDR→sRGB 显示契约，未证明通用颜色准确性或 HDR 输出。

## 实测与回归

- source-contract + M1 engine：18/18 通过。
- 运行库准备测试：10/10；CI 配置测试：12/12。
  CI 测试需使用 `python -m unittest discover -s tests -p test_ci.py`；模块方式运行会缺少同目录辅助导入。
- SDR10 开发态：48 次真实像素帧编号跳播，误差均为 0；普通、菜单、全屏、最小化恢复均通过。
  纹理导入/释放 79/79，最多一个在途；三轮原生句柄 760→876→735，退出约173ms。
  这是短期资源检查，不是长期无泄漏证明。
- SDR8 默认 RGBA8 路径回归：evidence-grJloa，4次跳播帧误差0、32/32释放、退出约179ms。
- 隔离成品：package-20261025T061228276Z/win-unpacked/AVHubRenderSpike.exe，
  evidence-wUh0wg，4次跳播帧误差0，877级保留；注入纹理导入失败后 UI 保留、原生宿主退出，
  导入/释放42/42、退出约70ms，没有残留 RenderHost。此目录不是 AVHub 正式发布包，不可分发。
- 默认拒绝10-bit及PQ样本的实际负向测试通过：quality-guards-Yq0fMa。
  源文件散列不变；本轮未读取或修改 E:\downloads。

复现开发态精度测试：

```powershell
$env:AVHUB_RENDER_SHARED_TEXTURE='1'
$env:AVHUB_RENDER_FP16='1'
$env:AVHUB_RENDER_SDR10='1'
$env:AVHUB_RENDER_SAMPLE='Precision-SDR10-1024x256.mkv'
$env:AVHUB_RENDER_STRESS_SEEKS='12'
$env:AVHUB_RENDER_SEEK_ROUNDS='3'
node electron/test/render-api/spike.mjs
```

这些变量仅影响隔离测试。诊断 SDR10 必须同时显式授权 F16 和 SDR10；HDR 即使有这些标志也仍拒绝。
源尺寸不缩小，三份纹理128MiB预算按F16每像素8字节计，当前4K F16会超限并拒绝。
该预算不是完整显存占用；不可把本次1024×256结果当作4K10-bit验收。

## M2 门槛与下一步

本机 RTX4090、Electron44.9.3、125%缩放、59Hz，Electron报告显示器每通道8-bit。
GPU画布保留877级，不代表最终物理显示877级；没有本机 HDR/10-bit显示能力的通过证据。
没有为通过测试切换系统HDR或降低系统安全设置。

下一步先验证4K F16的资源规划与压力，并建立HDR元数据、目标色彩与显示能力协商；
当前固定BT.709/sRGB设置绝不能接收HDR后冒充原画。随后补实际混合DPI/其他GPU和长时间运行。
同厂商多GPU的精确adapter LUID匹配、通用色彩准确性、发布许可材料也仍需完善。
这些完成前保留 M1 与现有播放路径，M2 gate=false，不开展 M3 正式接入。

本轮未升级版本、未推送或发布；根计划与 package.json 与 M0 留存内容一致，历史网页版归档未改动。
