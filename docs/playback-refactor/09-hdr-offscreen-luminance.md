# M2：HDR离屏亮度尺度与显式数值转换

> 后续饱和色、独立色度参考与关闭准入边界修复见 [10报告](10-hdr-colors-and-close-boundary.md)。HDR实体显示仍未认证。

2026-10-25。**仍处于M2；HDR显示未通过，M3–M5不启动。**
本轮只验证生成测试片的离屏数值，不向当前SDR屏幕呈现HDR画面。
生产引擎、播放器UI、默认原画策略不变；未读取E:\downloads，未升级版本、推送或发布。

## 实施与验证边界

- `hdr-math.cjs/test`：PQ绝对亮度公式与固定生成样本契约；名义PQ输入仍严格限定0–1。
  独立、受限的诊断外推处理原生浮点小幅超界分量，不放宽生产源契约。
- `framecode-fixtures.mjs`：增加1024×256、25fps、2秒的lossless HEVC10-bit PQ测试片。
  十个区域分别编码0、1、10、80、100、203、400、1000、4000、10000nits；
  这是按PQ公式构造的真实信号，不能用“给SDR画面改标签”替代。
  独立FFmpeg解码原始10-bit Y值并核对每区数字值、限定范围与元数据。
  复用现有原子发布、缓存容量、空闲空间、取消超时与不覆盖规则。
- `hdr-pixel-spike.mjs`：启动真实Electron，经过真实libmpv Render API、F16共享纹理、
  VideoFrame及WebGPU RGBA32F离屏附件读取数值；明确断言页面没有视频canvas。
  CPU参考读取原生RGB值，独立计算PQ解码、矩阵和绝对亮度尺度。
- `main/preload/RenderHost`：新增仅开发态、仅固定生成样本的HDR诊断分支，
  packaged模式明确禁止打开此分支。没有向生产preload提供HDR权限或任意路径/命令。
  普通源契约继续拒绝HDR，不会以BT.709/sRGB固定输出或隐式转码冒充HDR原画。
- 每次运行创建独立日志目录，路径写入runtime报告，避免共享旧日志造成误诊。

PQ参考：[ITU BT.2100公式](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.2100-1-201706-S%21%21PDF-E.pdf)、
[W3C HDR颜色参考](https://www.w3.org/TR/2026/WD-css-color-hdr-1-20260728/)。
公式锚点包括100nits约0.50807842、1000nits约0.75182710；没有把SDR白色当作绝对HDR亮度。

## 实际失败与处理

| 路径 | 实测 | 决定 |
| --- | --- | --- |
| 原生BT.2020/PQ，VideoFrame标记PQ，隐式导入sRGB | 原生PQ码最大误差约0.000919；导入后反推的参考白随区域大幅变化，约6.56–9997nits | 不满足统一绝对尺度，拒绝 |
| MPV请求scrgb，VideoFrame标记scrgb-linear-80-nits | 本配置原生10000nits区域值为1；不能直接推定它等于80nits。导入结果30个RGB分量全部非有限，VideoFrame transfer为null | 拒绝，不将接口名称视为支持证明 |
| 原生PQ作为明确的私有原始数值载荷，显式WGSL转换 | 与独立CPU参考的最大相对误差约0.0061%，保留负分量及超过1的线性高亮值 | 只通过该灰阶样本的离屏数值对照 |

前两项是当前Electron/libmpv/GPU组合下的观测，未定位到Chromium内部的具体责任代码，
不能推广成“所有浏览器HDR都错误”或“MPV不支持scRGB”。
最终负向证据分别为 `hdr-pixels-wRFKiz`、`hdr-pixels-TPf9mc`，均确认源不变、宿主无残留。

显式候选的私有载荷仍保存原生PQ数字值，传输标签仅用于避免隐式HDR颜色处理；
契约另行保留真实BT.2020/PQ源语义，并声明这些标签不是呈现色彩参数。
WGSL明确撤销载荷的sRGB包装，执行PQ解码、BT.2020→线性BT.709矩阵并按80nits归一。
输出是未夹紧的线性RGB数值，不是SDR视频；不存在把此私有载荷直接显示的权限。
仅凭本次灰阶对照不能证明饱和BT.2020颜色、完整宽色域或实体显示正确。

### 不忽略浮点超界

初版数值对照 `hdr-pixels-HbFt1R` 的CPU/GPU参考均含名义范围截断，结果不能作为“不截断”证明。
补充范围检查后 `hdr-explicit-final.log` 对照明确失败，发现原生分量约-0.0004587。
随后同时去掉CPU/GPU的静默截断，为这种小幅浮点值建立明确、对称且受限的诊断外推，
再进行对照。它**不是BT.2100对超出名义区间的标准定义**，也不是生产HDR许可。
名义PQ数学函数及普通源拒绝规则均保持严格。

## 最终离屏结果

`build/libmpv-render-spike/hdr-pixels-AxtEFU/acceptance.json`：

- `numericalTransportPassed=true`，`hdrPlaybackCertified=false`、`hdrDisplayAcceptancePassed=false`、`m2GatePassed=false`。
- 原生输出PQ码R通道最大误差0.0009188652，小于沿用的2/876门槛；不是位流到RGB数学无误差证明。
- 实际GPU与独立CPU的最大相对差6.0628×10⁻⁵，归一计算的分母下限0.0001，避免零附近虚假比例；
  此指标描述GPU转换一致性，不是对源HDR色彩准确性的完整认证。
- 10000nits区域离屏RGB约125.34、124.35、125.06，保留扩展范围；没有截成1。
  RGB差异来自原生转换输入，不能当作理想灰色校准已通过。
- 导入/释放10/10，最多一个在途引用，源散列不变，无残留RenderHost。

复现显式候选：

```powershell
$env:AVHUB_RENDER_HDR_RAW_CARRIER='1'
node electron/test/render-api/hdr-pixel-spike.mjs
```

不设该开关会运行直接PQ隐式导入反例，预期失败；`AVHUB_RENDER_HDR_LINEAR_PROBE=1`运行scRGB反例。
诊断不可在发行包里打开，不会更改Windows HDR开关。

## SDR回归与检查

- 开发态 `evidence-IWws1X`：4K SDR10、877平台、60次跳播目标帧误差0，渲染故障处理通过。
- 最终隔离SDR成品 `evidence-aaTKjO`：60次实际像素跳播在既定±1帧容差内，877平台保留；
  93/93释放，暂停句柄范围1，注入导入故障后退出约86ms。
- 默认RGBA8 `evidence-RSsIRW`：显示、4次目标帧、窗口生命周期通过。
- 成品为 `package-20261025T095127309Z/win-unpacked/AVHubRenderSpike.exe`，仅为本地M2验证目录。
  本次HDR数值候选是开发态验证，未将它伪称为HDR成品通过。
- Node源契约/M1/显示资格/HDR数学31/31，C#预算策略8/8，Python运行库10/10、CI配置12/12。
  数学边界测试加入CI，真实GPU/窗口实验未作为云端无GPU测试替代。
  普通模式拒绝HDR的实际负向样本仍通过：quality-guards-qm71KI；语法检查通过。

## 后续门槛

下一步优先补饱和色与负线性分量对照，再将诊断读回与真实播放路径分开测量开销。
目前SDR F16路径仍每帧读回诊断行并等待GPU，不能拿这些seek数值宣称最快的正式播放性能。
HDR的实体输出、SDR白电平协商、字幕/OSD亮度、混合DPI、长期压力与发布许可仍需完成。
当前活动显示路径仍不具备已验证的HDR实体输出条件，保持M2未放行，生产引擎不切换。
package.json、用户架构计划与M0内容一致，历史网页版归档未改动。
