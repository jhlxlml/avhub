# 首帧设置恢复与剩余长等待

2026-11-10，HEAD f3f65dbc321b54541f09be6b1558fb9e4f5eab27，保留已有未提交修改，版本保持 0.2.19。延续 95 的真实片源测试；原视频只读，无打包、提交或推送。

## 基线与目标

为 `render-library-seek.mjs` 增加打开分段观测和 open-only/repeats 测试参数。真实 Electron 中拦截原方法做计时，记录原生打开/校验/宿主阶段、设置恢复、快照、真实 GPU 首帧和应用内部 API 请求耗时；不替代实现或提前确认完成。所有源文件仍在每次前后核对完整 SHA256、大小和修改时间。完整 hash 预读会影响 OS 缓存，因此不称为冷盘打开测量。

`render-library-seek-K0JBc7/report.json`：PASS / 0，4 个真实片源（1240 VP9 4K60、2629 VP9 PQ10、774 长 TS、2358 AV1 4K）各打开 3 次。原宿主 aDEW1T，应用构建 983ff28c29433ce8。

- 同机运行库完整校验约 53–59 ms，没有省略哈希。
- D3D 设备与 Render Context 初始化合计约 197–212 ms。
- 原生 open 整体约 341–359 ms（含运行库校验、宿主启动等）。
- 媒体 loadfile 后恢复 volume 约 21–34 ms、mute 约 5–23 ms，串行设置合计约 26–57 ms；rate 小于 1 ms。字幕样式约 1–2 ms。
- 普通暖打开首帧多为约 430–459 ms；新的 SDR/HDR shader 首次使用约 614–629 ms。首帧仍来自实际 GPU 完成，不把控制 ACK 当作首帧。

主要的稳定初始化成本不能仅靠隐藏提示消除。本轮先处理已测得的 loadfile 后串行设置等待，不加入宿主进程池或跳过运行库校验。

## 已撤回的实验

曾尝试让 `RenderPlayer` 将已有音量、静音和倍速随可信打开请求交给 `RenderHostClient`，由 C# 宿主在 renderer ready 后、loadfile 前、仍保持暂停时应用。字段在原生边界核对范围/类型，保留完整设置；不改变默认引擎、字幕、轨道记忆、续播、原始媒体或画质。

宿主返回 initialPlaybackApplied=true 后客户端才认为设置恢复成功；缺少确认会报错，不能静默采用默认值。没有在首帧前提前启动媒体或音频。旧的测试/调用方不传该可选字段时仍保留原来的行为。initialPlaybackMs 单列计时，避免将等待挪到另一阶段后误报提速。

候选 q5QnfL / 构建 e147216dae1ef937，`render-library-seek-fk8qAi/report.json` PASS / 0，12 次打开。设置本身降到约 1 ms，但等待移至 setSubtitleStyle（首例约 58 ms）或快照；暖打开未稳定缩短（例如 TS 约 436→442 ms，AV1 约 440→445 ms），没有将这称为整体提速。首例首帧 1453 ms，其中运行库验证 777 ms，不能把它错误归因于设置优化。

该实验已精确撤回，不保留 initialPlayback 字段、确认协议或提前设置路径。旧实现继续完整恢复偏好。保留测量报告，不用“减少某段耗时”冒充首帧加快。

## 最终保留的修改

Snapshot 的 paused-for-cache 直接使用既有 MPV 专用属性观察事件更新的 cachePaused，同源于缓存等待计时；避免上一轮实测的一次约 20 ms 同步 getter。没有清空真实缓存等待或隐藏错误。

媒体库已显示时，仅在偏好明确选择 MPV 且开启内嵌时后台调用完整 verifyRenderRuntime，不启动播放器、不读取视频、不创建 GPU 宿主，不改变引擎。活动播放或正在打开时不启动额外的准备任务。失败记录为不可用，之后实际打开仍按原逻辑重新校验并显示真实错误。

同一路径及同一候选标志的验证只合并**尚未完成**的 Promise；成功或失败后立即删除，不缓存通过结果。打开时若预备验证已结束，必须重跑所有 SHA256；若仍在进行，则等待同一完整校验，不并发读取两遍。宿主、DLL、依赖、源码及 manifest 的原有校验不删不弱化。

`render-verification-SS7SLL/report.json` PASS / 0：真实文件测试证明进行中的校验共享、完成后不复用，改坏依赖/宿主及不合法清单名仍全部拒绝。三个受控服务策略合约 PASS / 0：未明确开启不准备、播放/打开期间不竞争、失败不记为 prepared。策略测试不是播放性能证据。

最终应用构建 25999eb6b34f1857，宿主候选 WV657b（仅额外缓存状态事件读取，DLL pin 不变）。`render-library-seek-wcoVtS/report.json` PASS / 0，四真实片源各三次打开；日志显示首次完整背景校验 776.84 ms，后续打开阶段仍实际校验约 52–64 ms。暖打开仍约 436–466 ms，未证实全面提速；新 shader/设备等首开成本仍存在。后台提前准备改变工作的时机，不表示校验总工作被消除，也不声称受控冷盘性能。

最终跳播、综合回归及画质检查结果完成后补录。没有引入宿主进程池或重新设计播放路径，保留所有既有原画路径和控制功能。

`render-library-seek-K7Zv7z/report.json`：最终源码四个真实片源共 96 次跳播 PASS / 0，原文件不变、真实 GPU 收据、新 seekId、准确/关键帧落点及 sourceLoads=1 断言通过。记录的 trace 没有超过 20 ms 的同步 property 等待。快速最慢分别约 306/64/115/60 ms，精确最慢约 756/625/204/490 ms；没有将真实长 GOP 解码时间伪装消失。

最终综合回归首轮 `playback-regression-lAq8db/report.json` FAIL / 1：pointer-and-intent 的测试实例 3CAVog 等待第一个窗口 30 秒超时。desktop.log 仅到 backend-start，未出现 backend-ready/library-ready，尚未执行新背景准备或打开播放。关闭时日志记录服务没有响应并按原有流程终止拥有的后端。没有 backend.log 错误输出，原因尚未建立。保留失败材料和原超时，不把它算作播放通过；针对性复核与后续结果另记。

## 最终验收

- `render-playback-intent-GpIdMU/report.json`：针对性复核 PASS / 0；后端约 802 ms 就绪，按原有超时完成真实控件/进度条/暂停/EOF 重播检查。该 PASS 不解释 3CAVog 的启动失败。
- `playback-regression-knM8pg/report.json`：17 项全部 PASS / 0，无未执行项。包含新后台准备策略、MPV 请求发送、引擎/会话、缓存保护、真实启动及首帧前输入、受控 GPU 失败、独立窗口截图/退出、三引擎切换、双 MPV 路径跳播矩阵。不是 v0.2.19 旧包或外机验收。
- `render-app-flow-EMx0OW/report.json`：PASS / 0，最终源码/宿主在真实 Electron 中通过 4K SDR10 像素码定位及 3840×2160、16-bit PNG 截图。
- 前后端编译、脚本语法及 diff --check：PASS / 0；没有依赖或版本变化。CI 为每个新增合约命令保留独立失败退出检查，未关闭检查，未查询/推送远程 CI。

本轮未承诺消除所有长等待：约 200 ms 的 D3D 设备/渲染上下文初始化、首次 shader 和长 GOP 精确解码仍存在。新实测没有证明所有暖打开均变快；保留的是明确减少播放关键路径重复工作/同步查询的修改。一次后端启动超时仍待复现定位；缺少外机、实体 HDR 色准等项不改写为通过。原视频全部只读，UI、引擎选择、画质、错误与首帧判定均保持。无打包、提交或推送。
