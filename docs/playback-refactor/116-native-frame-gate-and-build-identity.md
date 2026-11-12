# 原生取帧锁与构建身份核查

2026-11-12，延续 115。用户要求继续解决偶发播放长等待。未打包、升版本、提交、推送或发布，保留用户及之前未提交修改。所有真实媒体只读，隔离扫描样本复用媒体池。

## 已有证据与边界

115 真实长测记录过 frame RPC 约226ms、GPU完成后真实释放通知约496ms；后者仍没有唯一根因。已否决的16ms Node pulse不重新加入。不能把取帧锁问题等同于全部释放等待。

`RenderHost.RenderLoop` 等待 `D3dSurface.UnlockAfterDraw` 的GPU查询期间持有 frameGate；`Frame()` 需要同一把锁，查询请求可被GPU等待阻塞。112 已证实单独把等待移出锁会在旧固定轮询下从约60降到52GPU回执/秒，那个候选仍被否决。

本次只对已明确请求 frameNotifications 的路径拆分 GPU等待与锁内发布：先真实完成GPU查询，再在锁内一起发布 serial/epoch/content/readiness，随后发送既有就绪提示。未请求通知的路径保留原来的等待/锁次序。没有提前发布、ACK、释放引用或并行写入被读表面；默认通知仍关闭。实验需要实际帧率与精确像素检验才能保留。

候选 `render-replayed-candidate-niAbRE`，宿主 SHA256 `cef48433ddaab6c5d574037b79eabcb6946309b35635bd85f9a4f268304c10a1`；DLL仍为固定MKV索引修复版 `5b45550f85ace0822f14d17deb7777c76d229e33c572f94a2f66580e631b42b1`。构建/哈希校验/候选生成 PASS / 0。原staging材料保存在 `build/iteration-116-prior-staging.json`。

实际 Electron `render-app-flow-N37Llt` PASS / 0，覆盖画面码/暂停精确跳播/截图/控件菜单与窗口关闭；该运行沿用旧 JS 构建标识 `474c072471ba0d90`，必须同时按新宿主哈希区分，不能据同一build ID说它是旧宿主。

## 修复构建身份遗漏

`write-build-info.mjs` 原先仅包含 Python、前端和 Electron TypeScript，原生宿主 C# 改变时仍产生相同build_id。已纳入 `electron/native/**/*.cs` 及指纹脚本本身；不纳入生成EXE、缓存或时间戳。版本不变。这修正可追溯性，不代表播放提速。

新增隔离小型源码夹具契约 `build-native-identity.test.mjs`：只改C#时ID改变，生成EXE与built_at改变不影响ID，还原源码恢复原ID；1 PASS / 0。不修改项目真实源码来做断言。

## 验收与处理决定

待真实测试结果填写，未用旧版验收代替本轮结果。


### 五分钟真实帧交付

`render-frame-cadence-8cWUUn` 300 秒 PASS / 0，17982 次真实GPU回执、59.937/s（门槛57/s），1435次原生采样输出/解码增长下界均0。GPU间隔P95/max20.452/30.012ms，frameRPC P95/max0.194/5.683ms；单源加载、d3d11va、原文件尺寸/mtime/SHA256前后校验通过。快速定位实际落点1044.827s（目标1040s，误差+4.827s），如实报告关键帧偏差。

历史通知版 TC8QR7（未拆锁）同为300秒：59.907/s、输出增长下界9、GPU间隔P95/max20.312/30.131ms、frameRPC P95/max0.234/6.451ms。两次不是随机交叉配对，不能把9→0算作已证实的普遍提速或零丢帧承诺。112 的52fps退化本次未复现；本次只能证明该样本下通知+短锁维持帧率且未出现长查询。

只修改Node指纹算法时的临时源码标识为 `54df26dda5d4a09e`。五分钟报告仍保留原生成时旧标识474c072471ba0d90及候选/宿主哈希，不修改历史报告去冒充新构建。后续回归使用新标识。


### 回归发现并修复两端指纹不一致

首次完整回归 `playback-regression-fy5DUb` FAIL / 1，停在 seek-default-settings，后续未运行；原始日志保留。实际页面明确拒绝启动：网页54df26dda5d4a09e / 服务474c072471ba0d90，并非原生解码失败。原因是开发服务 `app/build_info.py` 会自行计算源码指纹，之前只同步了Node算法。已同步Python端的原生C#与指纹脚本输入；没有关闭版本匹配检查或延长等待掩盖错误。

扩展既有 `tests/test_build_fingerprint.py`，在同一隔离源码中对比Node生成值与Python实际加载值，覆盖C#及指纹脚本修改、生成EXE排除；1 PASS / 0。新增Node契约继续作为纯Node入口的独立验证。重新构建后才重跑完整桌面回归，初次失败不改写为通过。


## 回滚与未完成项

短锁候选只在原有 `AVHUB_RENDER_FRAME_NOTIFICATIONS=1` 明确启用时执行；移除该变量或设0，当前宿主立即使用旧的锁内GPU等待路径，不改变用户媒体库偏好。要回看原二进制可在测试终端显式选择 `AVHUB_RENDER_RUNTIME_CANDIDATE=render-replayed-candidate-8WuV8I`，该目录保留自有源码与哈希。不要用reset覆盖本地其他修改。

构建身份修复应保留且Node/Python必须一起变更；恢复旧算法也必须两端同时恢复并重新build，不能绕过前后端检查。原生等待/发布仍使用同一F16目标、GPU完成查询、serial/epoch一致性与引用释放保护，原视频不修改。

默认开启、更新成品、外机/HDR/多屏以及新的20分钟并发验收本轮尚未完成；本次不会将旧报告作为新结论。纹理释放晚回调仍需专门长测，短锁并没有绕过或宣布解决它。


### 最终结果

Node/Python同步后的最终构建 `da29d50a65232199`。build、electron-build PASS / 0。完整真实桌面 `playback-regression-ItAxPd` **28 PASS / 0，无SKIP或未运行项**，包含三路径循环、独立MPV、恢复、释放回调超时故障、GPU初始化故障、seek matrix与构建指纹契约。

复用共享池 `render-codec-seek-SJZqkf`：`render-codec-seek-rnl7sr` 完成160次真实精确像素定位（4K HEVC MKV/MP4、AV1、4K 10-bit），PASS / 0；ASS `render-ass-seek-aLm5gu` 20次定位 PASS / 0。它们是生成片源的精确画面/字幕验证，不是所有真实长GOP文件的速度承诺。

新宿主默认通知关闭路径的实际画面/截图/窗口验收也 PASS / 0，详见 `build/iteration-116-default-flow.log` 指向的原始报告。默认行为保留；候选短锁只在通知试验显式启用时使用，尚未扩围。

保留方案的理由是已消除通知路径中GPU等待占用状态查询锁的结构性阻塞，且真实五分钟60fps门槛、160精确像素定位和28项桌面回归均通过。没有承诺这会解决GPU完成后的全部晚释放。历史对比及哈希写入 `build/iteration-116-frame-gate-comparison.json`。语法、diff检查 PASS / 0。没有新的成品、外机、HDR、多DPI或20分钟并发验收；未发布。
