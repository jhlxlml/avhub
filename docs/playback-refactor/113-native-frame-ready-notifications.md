# 原生帧就绪通知：默认关闭的实验接入

2026-11-11。延续 112，保留全部已有工作区改动及用户规划文件。未打包、升版本、提交、推送或发布。最终应用源码构建 `df38ffeb01e51f70`，本地宿主候选 `render-replayed-candidate-8WuV8I`，宿主 SHA256 `34aee774fc0ca6b0ba8df49198dfeb50f59c64ede2a99418219c7643e403450b`；解码 DLL 仍为既有 `5b45550f85ace0822f14d17deb7777c76d229e33c572f94a2f66580e631b42b1`。

## 实施范围

- `RenderHost.cs`：仅在私有 open 请求明确启用时，在原有真实 GPU 等待成功、同锁原子发布 serial/epoch/content/readiness **之后**输出 `frame-ready` 提示。保留 112 回退后的锁和 GPU 检查。每个 JSON 行通过 Console.Out 同步写入，不与命令响应混写；通知不携带视频路径。
- `renderHostClient.ts`：`AVHUB_RENDER_FRAME_NOTIFICATIONS=1` 才请求通知，默认关闭。严格验证事件类型、字段和安全整数 serial；按宿主进程内递增 serial 去重，退休客户端不再唤醒。通知不完成 pending command，也不是 GPU 呈现凭证。只有实际收到过通知，`frameNotificationsActive` 才成立。
- `renderPlayer.ts`：通知只触发同一个已有 pump；忙时合并为一个待处理标记，已经取到的帧提示忽略。取消原等待定时器后唤醒，关闭、错误或旧会话一律忽略。取帧、GPU 完成、读者释放、ACK 和 seek 代次校验全部保留。
- 最终调度：只有当前宿主实际发过通知，正常可见播放的兜底预算才放宽至 50ms，正常帧由通知及时唤醒；旧宿主、未启用通知仍用原 10ms，暂停/隐藏仍用原节奏。首帧/错误检查仍有定时兜底，不要求所有宿主都支持新事件。
- 新增 `render-frame-notifications.test.mjs` 控制协议/调度契约，并接入现有播放回归；真实 Electron 的 app-flow 和 cadence 报告保存实际通知计数。

没有替换 Chromium/Hls.js、独立 MPV、MpvEngine/UI/偏好路径；不改变分辨率、位深、色彩、硬解或转码权限。通知只是可取帧提示，真实完成仍以原先 GPU 工作与资源释放验证为准。

## 逐步测量与调整

第一版通知仍叠加 10ms 轮询，`render-frame-cadence-vPPL5T` 300 秒 PASS / 0：交付速率保持 59.91/s，但 frame 查询增至 34811，存在重复空查询。基于这个实际开销，才增加“收到通知后放宽兜底”的最终调整。

同一原始只读 4K60 VP9 MKV、快速模式 1040s、每段 300 秒、冻结采样并暂停后导出：

| 指标 | 既有方案 17sz5V | 通知 + 10ms vPPL5T | 最终通知 TC8QR7 |
| --- | --- | --- | --- |
| GPU 完成确认数 / 秒 | 59.92 | 59.91 | 59.91 |
| Frame 查询数 | 27140 | 34811 | 17974 |
| GPU 确认间隔 P95 / max ms | 22.20 / 43.02 | 20.24 / 37.53 | 20.31 / 30.13 |
| 输出计数观测增量下界 | 3 | 6 | 9 |
| 解码计数观测增量下界 | 0 | 0 | 0 |

最终窗口 `build/render-frame-cadence-TC8QR7/report.json` PASS / 0，明确的 57/s 门槛通过，收到 18009 次提示，17973 次 GPU 完成确认。提示含启动/重绘等情况，不能将提示数直接作为解码或呈现帧数。源加载一次、d3d11va、原文件大小/mtime/SHA256 不变。三份原报告 SHA256 与同源对照另存 `build/iteration-113-notification-comparison.json`，不改写旧报告。

实际收益是减少 Frame 查询约三分之一、缩短本次交付间隔尾部；**未证明输出丢帧下降**。三轮是温热、顺序、单机观测，OS/驱动缓存和系统负载未做统计控制，也不是屏幕 scanout 或全系统功耗测试。主进程/宿主 CPU 等效单核占用也有观测下降，但不能外推为固定比例收益。首次单目标跳播延迟同样不能当作统计充分的提速结论；长 GOP 精确解码成本仍在。

## 功能与兼容验收

| 场景 | 结果 / 退出码 | 证据 |
| --- | --- | --- |
| 原生编译/暂存、前端/Electron 构建 | PASS / 0 | iteration-113-*-build.log，运行库保留所有 hash 校验 |
| 最终新宿主 + 通知启用，像素/截图/窗口/关闭 | PASS / 0 | render-app-flow-XXxQdK，实际提示 36 |
| 4K 10-bit 样本像素及截图 | PASS / 0 | render-app-flow-NNnC91，3840×2160、PNG 16-bit，实际提示 36 |
| 新客户端 + 旧宿主，通知请求无人支持 | PASS / 0 | render-app-flow-JYsI56，requested:true/received:0，回退正常 |
| 新宿主 + 关闭通知 | PASS / 0 | render-app-flow-2lB97w，requested:false/received:0 |
| 协议、重复/旧提示、关闭、单 pump、错误与计数契约 | 12 PASS / 0 | iteration-113-final-contracts.log；受控单元测试，不冒充 GPU 验收 |

上述四个应用流程 helper 均实际退出，源 lease 释放，纹理 imports/releases、句柄 leases/closedLeases 平衡。新旧协议回退和正常模式均使用真实 Electron；没有强制通过隐藏控件或跳过错误。

最终其余回归：

| 场景 | 结果 / 退出码 | 证据 |
| --- | --- | --- |
| 4K HEVC MKV/MP4、AV1、SDR10，160 次精确暂停定位及独立像素编码校验 | PASS / 0 | render-codec-seek-q5I2dn，复用既有 SJZqkf 校验样本，40 次/样本 |
| ASS 向量/动画/卡拉 OK 字幕及暂停定位 | PASS / 0 | render-ass-seek-iqHMcV，20 次像素校验 |
| 六个原始只读文件，144 次快速/精确定位 | PASS / 0 | render-library-seek-UXAH23，MKV/MP4/TS、VP9/H.264/HEVC/AV1、4K/8K，全部源文件身份不变 |
| MKV/TS 连续跳播、暂停/播放切换、pending seek 中关闭 | PASS / 0 | render-library-seek-zmwHxB，12 个突发组及额外 48 次普通定位；两次关闭时 pending 均为 true，返回耗时约 140/257ms，源文件不变 |
| 完整桌面播放回归 | 26 PASS / 0，无 SKIP/unrun | playback-regression-l7vZsi，包含独立 MPV、引擎切换/恢复、故障和 seek 矩阵 |
| 最终脚本语法及 diff --check | PASS / 0 | iteration-113-diff-check.log |

真实六文件本次快速定位 GPU 确认最大约 56–95ms，精确定位在长 GOP 的 VP9 仍达约 781/877ms，AV1 8K 约 1103ms；样本/缓存未经严格控制，不能将其与旧版数字直接算作统一提速，也没有取消精确定位或虚报落点。

新外机/HDR 实屏/多 DPI/新成品和新 20 分钟并发验收本轮未做，记为 SKIP；不得将旧发行报告改名成当前源码验收。默认关闭的实验范围不等于正式放行。

## 使用与回滚

默认行为不变。只在测试终端设置 `AVHUB_RENDER_FRAME_NOTIFICATIONS=1` 后运行 `npm run dev` 试用；设为 `0` 或移除该环境变量即可回到原轮询，不改媒体库设置。当前开发启动器会按已有规则选择匹配当前宿主源码的运行库；直接启动旧正式 EXE 不会因此获得新功能。

继续保留默认关闭，待更多片源与长期实测后评估扩围。112 的短锁负优化仍保持回退，本轮没有将它与通知方案捆绑采用。
