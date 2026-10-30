# M2：15 分钟循环验收及计数边界

2026-10-25。本轮完成真实 Electron 的 900 秒压力运行，**原验收结果为 FAIL**，
不是播放架构整体交付。M2 仍未放行，M3–M5 不实施；生产播放路径未改变。

## 实现与计数语义

- 原生宿主新增 `mpv_render_context_get_info(NEXT_FRAME_INFO)` 读数，按
  PRESENT / REDRAW / REPEAT 区分调度、重绘与重复；没有关闭视频定时、跳过绘制或取消 GPU 完成等待。
- `scheduledFrames` 只表示 Render API 报告的新帧调度，不等于精确解码总数或实体屏幕显示数。
  `decodedFrameCount` 明确保留 null，不能把旧 `frames` 或诊断重绘次数当解码 FPS。
- 采集 mpv decoder / VO / delayed 计数、原生 CPU 时间、句柄、私有内存、DXGI 本进程预算/占用、
  进程 I/O，以及 Electron 各进程 CPU/内存。进程 I/O 包括管道和缓存读，不是物理磁盘吞吐。
- 新增固定循环命令仅供可信主进程测试，不对 React 业务 IPC 开放。只使用 build 目录内生成样本。
- `soak-summary.cjs` 对缺失及回落计数保留不确定性；重置或采样缺口时只报告观察下界，不能得出零丢帧。
  3 个边界单测进入 CI；没有要求云端具备真实 GPU，也没有自动推送。

语义依据固定运行库的 `include/mpv/render.h` 和
[mpv 官方属性说明](https://mpv.io/manual/master/#property-list)：解码丢帧与 VO 丢帧不是同一项，
调度和估计值也不能证明逐帧扫描输出。

## 15 分钟运行

报告：`build/libmpv-render-spike/evidence-UvRbaa/`，包括
`soak-acceptance.json`、411 条 `soak-checkpoints.jsonl`、独立生成的 `soak-summary.json`。
输入摘要 `soak-inputs.json` 在运行中只读补采，并未伪称启动时证明。

- 起止 UTC：11:45:29–12:00:29；实际播放计时 900,047.74ms。
- 生成的 3840×2160、25fps、HEVC SDR10 精度片段（6 秒）由 mpv 循环；NVDEC，内部 F32、输出 F16。
- 真实 Electron、同窗口合成；没有调用生产 AVHub、独立 mpv.exe 或修改 `E:\downloads`。
- 这是**短片循环的持续解码/合成/资源压力**，不是 15 分钟独特内容、4K60、8K、音画同步或实体显示验收。
  宿主音频原本就关闭，因此 decoder drops=0 也不能证明所有真实音视频场景都不丢帧。

| 项目 | 实测 |
|---|---|
| 像素采样 | 411 次，均得到真实编码帧号；对当时原生位置的最大环形误差 3 帧，预设限 5 帧；无采样停帧断言失败 |
| 调度与重绘 | 新帧调度增 21,177；REDRAW 增 1；无新帧标志的绘制增 70；不将其称为解码总数 |
| decoder 丢帧属性 | 样本中无缺失、无回落、观察增量 0 |
| VO 丢帧属性 | 22 次计数回落，观察增量下界 49；不能用首尾差得出零丢帧，也不能证明实际总数只有 49 |
| delayed 估计属性 | 观察增量 0，仍为估计值 |
| 像素源时间 / 墙钟 | 有效采样间隔约 897.86 秒，源帧号累计推进 21,280，约 0.948；包含循环重新定位开销，不等同连续长文件解码 FPS |
| 原生 CPU | 累计约 161,781ms；是 CPU 时间，不是跨平台 CPU 利用率对照 |
| 60 秒后原生私有内存 | 范围约 3.41 MiB；约 2.65 GiB 的绝对占用仍偏高，不能称内存已优化 |
| 60 秒后原生 GPU 占用 | 从 2,559,582,208 降至 2,492,604,416 字节，范围约 63.88 MiB；是回落，不是持续增长 |
| 60 秒后原生句柄 | 697–715，范围 **18**；预设门槛 **16**，所以原验收 FAIL；首个晚期值 707，末值 703，范围超限本身不能证明泄漏 |

原报告保留错误 `Late native handles do not remain bounded` 和 `completed=false`。
没有因差 2 个句柄而改为通过，也没有删除失败样本。后续错误文案改为准确表达
“活跃句柄波动超过预设噪声预算”，阈值仍为 16。

### Electron 内存仍需归因

Electron GPU 进程私有内存从晚期首样本约 238 MiB 到末样本约 413 MiB，最高约 421 MiB。
按分钟中位数，第 1 分钟约 271 MiB，第 4 分钟约 411 MiB，第 5–14 分钟约 409–417 MiB。
这表现为早期抬升后暂时平台，可能涉及 Chromium/驱动资源缓存，但**未证明原因，也未证明不存在泄漏**。
Tab 私有内存晚期约 36–54 MiB，Browser 约 39–46 MiB；不能只看原生宿主就宣称全应用内存稳定。
长测判定失败后按异常路径关闭 Electron；本轮没有将未执行到的正常关闭断言写为通过。

## 后续观测补充及针对性回归

补上暂停、GPU 引用排空后的前/后资源采样，再以新实例进行 12 秒机制试验：
`evidence-ULZALs`。前置 15 次句柄采样为 700–701，后置 15 次均为 707，
所有采样导入等于释放；短试验通过，但**不能替代原 900 秒失败或证明同一长测进程暂停后收敛**。
新的观测代码保留原活跃范围门槛，没有用强制 GC 使报告通过。

Node 引擎/源契约/显示/HDR/色彩参考及新计数边界 **37/37**；C# 预算策略 **8/8**；
Python CI 配置 **12/12**。JS 语法通过。未重跑生产应用全套验收，也没有重新生成正式 AVHub 包。

复现（新 PowerShell 会话，其他 GUI 验收不能并行）：

```powershell
$env:AVHUB_RENDER_SHARED_TEXTURE='1'
$env:AVHUB_RENDER_FP16='1'
$env:AVHUB_RENDER_SDR10='1'
$env:AVHUB_RENDER_SAMPLE='Precision-SDR10-3840x2160.mkv'
$env:AVHUB_RENDER_SOAK_SECONDS='900'
node electron/test/render-api/spike.mjs
```

## 依赖来源补查

[固定发布页](https://github.com/zhongfly/mpv-winbuild/releases/tag/2026-10-14-7c4f662c08)
关联的 [构建记录](https://github.com/zhongfly/mpv-winbuild/actions/runs/38602995704)
可读到成功状态及 builder 提交 `8a39c5134b8e16f104ee56a5d85e36a592ad9477`。
[该提交的工作流](https://raw.githubusercontent.com/zhongfly/mpv-winbuild/8a39c5134b8e16f104ee56a5d85e36a592ad9477/.github/workflows/mpv.yml)
仍从独立 toolchain 仓库检出并使用缓存；仅固定 mpv 提交和 DLL 摘要不足以证明已收齐对应依赖源码、补丁及通知。
本轮不把公开构建链接当作完整材料，不修改 `distributionReady=false`。

## 下一步与门槛

1. 用带暂停/排空采样的新测试复核长时句柄；区分活跃噪声、稳定增量和空闲残留，保留旧失败。
2. 归因 Electron GPU 进程早期内存抬升；不能只通过扩大阈值、隐藏缓存提示或强制 GC 声称修复。
3. 使用连续时间轴的较长样本分离循环边界开销，并核对 VO 计数回落；当前 0.948 比例不足以评价真实长文件流畅度。
4. 再补最新观测代码的隔离成品回归。实体 HDR、混合 DPI/多屏、更多 GPU 与许可材料仍待完成。

M2 完整门槛仍为 false，不实施正式 MpvEngine。根 package.json、用户计划及冻结网页版保持原状；
未升级版本、提交、推送或发布。

连续样本与资源判定语义修正已推进，见 [14报告](14-continuous-timeline-and-resource-convergence.md)。
本报告原900秒FAIL保持不变。
