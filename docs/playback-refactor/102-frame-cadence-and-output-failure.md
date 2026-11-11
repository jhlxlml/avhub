# 原片定点帧节奏与输出故障分类

日期：2026-11-10。HEAD 仍为 `f3f65dbc321b54541f09be6b1558fb9e4f5eab27`，版本 0.2.19，保留此前未提交修改；不打包/发布。原生宿主仍是 `render-replayed-candidate-wgp7hX`，本轮未修改 C#、解码参数、纹理所有权或用户画质偏好。

## 证据与范围

上一轮 20 分钟并发中，输出丢帧计数在 1043–1044 秒和 222 秒附近出现少量增加。它不能证明持续卡顿，也不能把最后一次计数为零当作全程零丢帧。本轮新增 `electron/test/render-frame-cadence.mjs`，在真实 Electron 中只读引用原片、克隆索引，复用原测试文件，不生成视频副本。

测试包装现有 `frame / snapshot / acknowledge / present` 方法，记录真实耗时、GPU 完成回执与位置，不增加逐帧查询 IPC，也不伪造完成。每段 trace 上限 20000 条并断言未截断；停止播放后核对原文件完整 SHA256/大小/修改时间。统计为应用与 GPU 完成，不是物理 scanout。封面 worker 暂停，因此不能冒充并发压力验收。

改动前代码构建 `f74c72f3f1e6380b`：`build/render-frame-cadence-LavuKp/report.json`，三段各 18 秒，PASS / 0。

| 模式/请求位置 | 实际落点 | input→GPU | seek→restart | 稳态回执数 | GPU 间隔 p95 / 最大值 |
| --- | ---: | ---: | ---: | ---: | ---: |
| fast / 1040 s | 1044.827 s | 406.4 ms | 382.5 ms | 1080 | 22.90 / 25.70 ms |
| exact / 1040 s | 1040.039 s | 89.8 ms | 79.6 ms | 1079 | 22.46 / 41.19 ms |
| fast / 218 s | 213.063 s | 47.5 ms | 32.8 ms | 1079 | 22.34 / 24.77 ms |

第一段长等待主要发生于原生 restart 之前，而不是 JavaScript 命令排队（约 0.07 ms）或管道：该段 frame 查询最大 8.50 ms、snapshot 最大 0.41 ms、GPU present 最大 9.68 ms。后续热状态不能当作首段的同条件对照，不能据此声称精确模式总比快速模式快。

三个窗口均未观测到 >100 ms 的稳态 GPU 完成间隔或缓存暂停；精确段输出计数由 0 增至 1，解码丢帧计数仍为 0，其余两段输出计数维持 0。**不是零丢帧认证，也未宣告偶发长等待根因已解决。** 因此没有重新调整全局 poll 间隔、帧丢弃策略或缓存量。先前节流实验未体现稳定收益，不能重复当作修复。

## 确定的问题与实际修复

`electron/src/renderPlayer.ts` 的输出 pump 使用无参数 catch，所有错误均折叠成“原生画面输出异常”。这会隐藏已存在的 30 秒首帧超时诊断，以及 GPU 提交、原生解码、状态读取等区别。

现在 pump 在原生取帧、GPU 提交/释放、ACK、状态读取、恢复播放、首帧期限等阶段标记位置；失败时记录 `render-output-failure`，包含阶段、分类、单次 pump 耗时、代次、是否处于 seek、是否已见首帧。只保留白名单原生错误代码，不记录任意错误字符串中的原视频路径。界面保留已有宿主/seek 超时优先消息，并提供对应 GPU、解码/读取及首帧超时说明。原有暂停、重试、源占用和 GPU 释放保护保持不变。

这是可诊断性和失败处理修复，**不是减少实际解码等待的性能优化**。没有隐藏加载提示、伪造 GPU 完成、自动转码或强制释放未完成的 GPU 读者。

## 验收

- `npm run build`、`npm run build:electron`：PASS / 0，构建 `8ae4929a7dbd59f0`。保留既有 Vite 配置及大 chunk 警告，没有关闭检查。
- `node --test electron/test/render-output-failure.test.mjs`：3 项 PASS / 0，控制型服务测试，覆盖首帧超时原诊断、GPU 错误分类/路径隐私、原生读超时与解码错误；不是硬件故障或性能实测。
- 完整实际 Electron 回归 `build/playback-regression-b4OAKH/report.json`：22 项 PASS / 0，无 unrun。含真实 Electron 受控 GPU 初始化失败，断言对应提示/阶段日志、重试恢复与源/GPU 释放；此类注入不是自然驱动故障证据。
- 改动后三份原片定点窗口：全部 PASS / 0，汇总 `build/frame-cadence-followup-5ef5ac/final-summary.json`。

| 原片/编码 | 时长 | 三次 input→GPU | 稳态最大 GPU 间隔 | 报告 |
| --- | --- | --- | --- | --- |
| id 1240 / VP9 4K60 | 3×18 s | 397.1 / 73.7 / 58.1 ms | 26.65 ms | `build/render-frame-cadence-az2Yj6/report.json` |
| id 704 / H.264 4K60 | 3×10 s | 45.1 / 40.0 / 43.2 ms | 31.63 ms | `build/render-frame-cadence-dxhwVk/report.json` |
| id 495 / AV1 4K24 | 3×10 s | 60.4 / 30.7 / 89.6 ms | 54.53 ms | `build/render-frame-cadence-CIkDyt/report.json` |

三份均 sourceLoads=1、d3d11va，窗口内没有缓存暂停，源大小/修改时间/SHA256 前后相同；九段末次解码/输出丢帧计数均为 0，仍不能据此认证全帧零丢失。24fps 的 AV1 约 41.7ms 基础帧间隔不能与 60fps 的约 16.7ms 混为同一标准。

初始跟进批次 `build/frame-cadence-followup-5ef5ac/report.json` 在 id55 **FAIL / 1**，原始失败报告 `build/render-frame-cadence-Bus3Y6/report.json` 保留：源文件实际存在（19.6 GiB），索引 missing=1，卡片隐藏，找不到播放按钮，未进入播放。前后完整哈希相同。这不是解码失败证据，也没有擅自改真实索引。测试新增可用状态前置断言，避免先读取巨大文件再等待不存在的 UI；改用正常入库的 id704 通过。最终成功汇总不覆盖初始失败记录。

本轮没有成对的同条件性能改动，不能拿 406→397ms 的波动声称提速；首次 VP9 seek 的 restart 仍约 381ms。只修复确定存在的错误泛化问题。

未进行成品、外机、实体 HDR 色彩或全天验收，不能从上述结果推出这些项目已通过。回滚仅撤销本轮 pump 阶段标记/分类、对应测试和 runner 增项，保留此前播放修复及样本池。没有需要回滚的原视频修改。

下一步针对首次跳播的 restart 阶段，继续区分真实解码暖机、索引读取与缓存等待；GPU 读者释放回调缺失仍属未自然复现风险，不能凭静态可能性宣告其为本次慢跳播根因，也不能以提前 ACK 或关闭加速解决。
