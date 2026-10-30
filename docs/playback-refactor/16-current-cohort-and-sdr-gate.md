# M2：当前构建证据闭环与 SDR 范围放行

2026-10-26。本文取代此前报告中的“尚不能进入 M3”状态，保留旧报告作为历史。

用户明确同意：**限定 SDR 范围放行，再推进 M3**。实体 HDR、混合 DPI 和多屏继续待办；
不是把未验证项目改成通过。根目录原始架构计划保持原文，不覆写用户文档。

## 放行范围

- Windows x64、实测 Intel UHD 770 / 单屏 SDR / 100% 缩放组合。
- 固定原尺寸 H.264、HEVC、AV1 和 BT.709 SDR / 10-bit 经 RGBA16F 的生成样本。
- D3D11 Render API → Electron shared texture → WebGPU F16 组合器；React 控件真实叠层。
- 不包含实体 HDR、Dolby Vision、非方形像素、未验证旋转元数据、更多 GPU/驱动/刷新率组合。
- 自动选择策略和正式发行资格没有随此决定开放；主播放器默认仍走原有路径。

## 当前源码和运行资源绑定

源码指纹：`e2d89fd82f888dd98750708a07b12de8ec4956c33b90e4c94e8cfaf7ee6c424d`。
DLL 固定 SHA-256：`ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74`。

`build/libmpv-render-spike/cohort-20261026.json` 绑定十份实测报告：

| 项目 | 报告目录 |
| --- | --- |
| 连续十五分钟 SDR10 / 4K | `evidence-usvMO2` |
| 4K AV1 | `evidence-xhHIKX` |
| SDR10 / 4K 竖屏 | `evidence-d6NWpo` |
| 原生进程异常 | `evidence-yWy7oa` |
| WebGPU 设备丢失 | `evidence-skbEXT` |
| 帧交接中的故障边界 | `evidence-iancmT` |
| 纹理导入失败 | `evidence-itSQkx` |
| 渲染线程失败 | `evidence-pRvpty` |
| 控制管道失败 | `evidence-aeS94D` |
| 初始化失败 | `startup-fault-QWu9PY` |

每个私有成品的实际运行目录均逐文件核对大小和 SHA-256，包含 JS、DLL、辅助程序和生成视频。
不只比对 EXE 哈希。允许变动的仅为指定日志和 Electron 用户缓存目录。
例如长播成品有 107 个不可变文件，共 1,164,311,959 字节。
这是构建一致性校验，不是代码签名；校验会预热文件，不能据此声称冷启动性能。

验收器进一步拒绝缺少实际像素值的 seek 记录，避免 `undefined === undefined` 意外放行。
重新审计全部成品后的结果为 `softwareCohortPassed=true`，`fullM2GatePassed=false`。

## 十五分钟数据

- 连续播放 900,080 ms，960 秒连续时间轴，无短文件循环代替长播。
- 解码丢帧计数增量 0；VO 增量 12，低于已声明的 25fps 样本预算 22。
- 实际像素码推进 / 墙钟比约 0.999982，无采样歧义；不是全帧计数或实体屏幕扫描认证。
- 原生与导入后均保留 877 个灰阶平台；60 次 seek 的目标像素误差为 0。
- 22,716 次导入和释放匹配；父进程共享句柄 1 次创建 / 1 次关闭，结束后无存活租约。
- 原生退出码 0，没有强杀；关闭记录 164 ms。
- 排空基线后的句柄正向峰值增长 1，收敛后增长 0；原生私有内存正向峰值增长 282,624 字节。

样本为自建测试内容，不是自然电影，也不代表高码率实片、所有驱动或音频输出质量。
源视频均未修改；本轮没有访问 `E:\downloads`。

## 复核命令与阶段决定

```powershell
node --test electron/test/render-api/runtime-attestation.test.cjs electron/test/render-api/cohort-evidence.test.cjs
node electron/test/render-api/verify-cohort.mjs D:\AI\codex\avhub\build\libmpv-render-spike\cohort-20261026.json
```

上述复核通过。据用户明确授权，**M2 SDR 子范围放行，M3 开始**；完整物理显示矩阵继续标记未验证。
M2 的私有 PoC 成品不是 AVHub 正式 EXE/ZIP，不会作为 Release 发布。
新 DLL 的完整再分发来源材料、依赖许可和对应构建资料仍是 M5 的交付条件。

M3 限定验收及 M4 首帧同步见 [20](20-m3-scoped-acceptance-and-m4-startup.md)。
