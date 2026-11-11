# 短距离快进与原生首帧准备优化

2026-11-08。版本保持 0.2.19，最终构建 3a9aaea9f67940a3，原生候选 render-replayed-candidate-Oyu11n。未打包、提交、推送或升级版本。保留其他工作区修改及用户规划文件。

## 实际修复

### 短快进选择正确方向的关键帧

旧快速路径把请求统一变成 absolute+keyframes。固定 libmpv 的 player/playloop.c 中绝对定位没有 SEEK_FORWARD，而正向 relative+keyframes 带 SEEK_FORWARD。因此指定 VP9 MKV 从 0 快进到 5 秒时，旧路径可能仍选 0 秒关键帧；仅保留连续目标只能让下一次请求推进，第一下仍可能看起来无效。

现在原生 RenderHost、MpvClient 和独立窗口 Lua 在稳定状态用实际时钟换算方向，执行相对关键帧定位。指定文件实际第一次从 0 到 5.072 秒，第二次到 10.143 秒，反向则回到 5.072 秒。仍报告实际落点和偏差，没有伪装精确。

稳定态是必要条件：连续跳播未完成时，中间 time-pos 可能是请求值，不能作为下一条相对命令的基准。三条链路在已有定位未完成时保留绝对目标合并，跳过相对换算；稳定后才读取时钟。复现报告 mpv-seek-paired-k70yGt 中最后目标 23.4 秒误触发 EOF 回退，174 ms 才完成，退出码 1；修复后完整连续矩阵通过。没有降低断言以掩盖这一竞态。

### 文件末段无后续关键帧的真实回退

仅使用正向关键帧会在最后一个 GOP 中到达空 EOF。中间实现在像素测试 render-codec-seek-bd3Z0D 发现目标附近报告 6 秒但实际帧码为 0，FAIL / 1，未交付为完成。

最终实现仅在真实 EOF 被观察到后，保留原请求并发出一次绝对精确定位，等待新的 seek/restart 与实际帧呈现。诊断策略改为 exact，记录 corrections，不把 EOF 重绘当作请求帧。RenderHost 不释放仍有 GPU 读者的已发布表面；独立窗口由 Lua 发固定 fallback 通知，主进程保留原用户时钟并等待新事件。原有精确模式和原画质量不变。

末段目标 4.68 秒最终实际 4.68 秒，25fps 像素帧码 117；独立窗口 6 秒样本快进到 5 秒也实际到 5 秒，策略 exact。帮助文字说明该边界会精确定位，因此极少数末段跳播仍可能需要解码等待，而不会一直停在同一关键帧。

### 首帧 GPU 初始化与加载并行

preload 原来收到首个真实纹理后才请求 WebGPU 设备、配置 F16 canvas 和编译 SDR/PQ/HLG 管线。现在 attachRenderSurface 时启动同一 prepareRenderGpu Promise，与原生宿主/运行库加载重叠。原始 shader、rgba16float、HDR 数值载体、分辨率和色彩计算均未修改。实际尺寸仍由真实 VideoFrame 设置，只有 queue.onSubmittedWorkDone 后才能发出 GPU 完成回执。

设备初始化失败仍传给真实帧处理，未静默降为 8-bit；detach 仍等待工作与设备初始化，释放 context/device。取消打开后再开已实测正常。没有后台常驻新解码器，也未跳过任何 hash/sandbox 校验。

## 首帧对照与限制

三次打开同一隔离索引/指定视频，本机同一 SDR 会话，非操作系统冷启动对照，缓存和驱动状态未全局清空。

| 报告 | 三次实际首帧（main 计时） | UI 输入到观察到首帧（含轮询） |
| --- | --- | --- |
| 修改前 render-startup-profile-nNw07Z | 1300 / 691 / 695 ms | 1471 / 757 / 754 ms |
| GPU 并行后 render-startup-profile-r7H4Bp | 889 / 681 / 694 ms | 1084 / 791 / 771 ms |
| 后续确认 render-startup-profile-g8VbR5 | 1151 / 672 / 649 ms | 1351 / 756 / 729 ms |
| 取消与重开确认 render-startup-profile-jSEYuP | 885 / 699 / 656 ms | 1078 / 789 / 751 ms |

首开样本有改善，后续重开差异较小，不能宣称每次都减少 400 ms。新编译宿主的首次装载仍曾有更高波动，没有足够证据归因或保证所有冷启动都落在此范围。最后的稳定态 seek 防护只改定位分支，不改上表启动路径。

曾尝试把音量、静音和倍速前移到原生初始化选项，等待转移到下一条设置，温启动首帧仍为 693/713 ms；新宿主首次约 2894 ms，未获稳定提速。该试验的新增 open 参数、ACK 与初始化选项已全部撤回，不进入最终实现。报告 render-startup-profile-aVwCnT 保留。

## 验收

| 验收 | 结果 | 退出码 | 报告/命令 |
| --- | --- | --- | --- |
| MP4、长 GOP TS、4K HEVC MKV，两条 MPV 精确/快速/连续/暂停/远跳/智能模式 | PASS | 0 | build/mpv-seek-paired-QT4ZcY/report.json |
| 指定 3.6GB VP9 MKV，最终内嵌短快进、反向与连续跳播 | PASS | 0 | build/mpv-seek-paired-8t8LoP/report.json |
| 最终 4K HEVC 40 次精确及快速末段回退像素验证 | PASS | 0 | build/render-codec-seek-65VJ15/report.json |
| 独立窗口末段回退、三格式打开与原生控件 | PASS | 0 | build/mpv-independent-reopen-A4Q1Ru/report.json |
| 最终首帧前播放意图/真实时钟 | PASS | 0 | build/render-app-startup-intent-84UrD0/report.json |
| GPU 并行后的真实 HDR 片源连续播放/呈现 | PASS | 0 | build/hdr-real-media-BAVQoc/report.json |
| GPU 并行后的复杂暂停 ASS 与 20 次像素定位 | PASS | 0 | build/render-ass-seek-AOFRdK/report.json |
| MPV Client 含未完成定位禁止相对基准、EOF 回退等合约 | PASS | 0 | node electron/test/mpv-client.mjs |
| 前端/Electron/宿主编译与发行同系本地 staging | PASS | 0 | 构建与 stage 脚本 |
| 开发启动运行库核验 | PASS | 0 | node scripts/start-electron-dev.mjs --check |
| 差异空白检查 | PASS | 0 | git diff --check |

最后两项 HDR/ASS 记录在相同 GPU 初始化实现落地后执行，后续只增加快速连续状态和 EOF 防护；未把旧版测试伪装成新版本发布结论。最终 4K 像素报告不作为独占性能对照，另有完整单独运行的配对矩阵计时。

指定文件最终内嵌快速中位数/P95 为 45.04/71.18 ms，第一次 +5 实际 5.072 秒、约 46.8 ms，第二次实际 10.143 秒、约 44.2 ms，反向回到 5.072 秒、约 46.4 ms。原文件与副本 SHA256 前后一致，源加载始终 1，保持硬解。数值是本机样本，不保证所有视频/设备相同。

测试的智能精度保护改为主动执行一次真实 18.4 秒远跳产生 >2 秒偏差后再断言精确回退，而非沿用旧“向前总取前一关键帧”的错误假设。测试仍要求真实观测、真实落点与相同严格策略。最初 Client 单元测试因仍断言旧 absolute 命令而退出 1，已改为同时核对实际时钟查询与正确的 relative 命令差值，未放宽落点验证。

所有原始视频只读；当前 SDR 会话不代替物理 HDR、多屏或外机验收。未隐藏加载提示、保留旧画面冒充新帧、降低画质、静默转码或关闭硬件加速。需要回滚时恢复本轮 preload GPU 初始化时机与三条快速命令/EOF 防护，其他未提交改动保留。
