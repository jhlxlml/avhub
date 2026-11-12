# 默认画面交付与两级释放链路

2026-11-12，继续聚焦真实内嵌播放长等待，不改UI、不打包、不升版本、不提交或推送。保留其他工作区修改；原媒体只读。

## 已知问题与本轮准则

115曾捕获GPU完成约5ms、真实全部引用释放另等约496ms；不能仅凭主CPU样本idle认定Node唤醒就是根因。16ms pulse已因无收益撤回。116 的通知+短锁组合通过五分钟帧率和28项回归，但尚未默认开启，未宣称解决晚释放。

本轮明确区分渲染进程native release开始→同步令牌实际回调，以及主进程收到最后释放通知→native release实际回调；只在真实回调中计时，不替代调用、不提前发ACK。

## 测试接入

`renderer-release-recorder.mjs` 在自有真实Electron中仅于首个预加载回调断点停一次，安装对既有native finishTransfer/release、VideoFrame.close和GPU queue完成Promise的计时包装，随后删除断点并关闭Debugger；播放测量从首帧ready后才开始。无需关闭sandbox或把FFI放入renderer。保持4096事件环、4个最大晚释放窗口；停止后冻结记录。没有逐帧导出IPC或JSON序列化。

主进程 `frame-delivery-recorder.cjs` 增加native release开始/回调时间及textureId，复用既有2048环、4个丢帧增长窗口。分别保留各进程performance.timeOrigin；跨进程差值只作近似对照，负差值不抹平为零。`frame-release-analysis.mjs`只计算已观察到的阶段，缺失值保留null，不把GPU完成当成scanout。

纯契约：记录器4 PASS / 0、跨进程关联2 PASS / 0（完成时间=start+duration，重复事件去重，缺失与负时钟差不伪造成功）。真实60秒接入 `render-concurrent-soak-gZZrlp` PASS / 0：渲染native释放最长1.7ms、主进程最长1.24ms；实际画面、跳播和释放/退出均通过。它只验证接入，不足以否认偶发故障。

十二分钟正式诊断使用同一4K60只读原片、niAbRE宿主、通知开启、共享池扫描样本，没有CPU profiler，不并行GPU测试。若完整验收通过，再评估默认启用组合；不以局部采样冒充完成。


## 十二分钟结果与默认接入决定

`render-concurrent-soak-2pHSuK` 720024ms，64次资源采样、11次跳播、持续扫描与暂停窗口发布封面，PASS / 0。原生frame RPC最长22.347ms、present最长17.711ms；主进程native释放最长2.231ms，渲染进程最长4.3ms；没有>80ms渲染释放窗口，没有原生输出计数增长捕获窗口。稀疏输出/解码增长下界均0，不能将其表述为全程精确计数或所有硬件零丢帧保证。主事件循环未记录>20ms延后，渲染循环一次最长延后33.4ms。

实际38363次imports/releases/GPUcompletions配对，NTlease1/1、时钟请求/释放16/16，宿主退出，源文件租约释放，原视频身份前后相同。早晚中位数本地宿主私有内存+约4.48MiB、句柄+1、原生GPU用量不变；Electron合计私有内存+约120.34MiB（GPU与renderer增长为主，含诊断/CDP），低于既有256MiB预算，但不据此宣称长期无泄漏。原始报告与哈希见 `build/iteration-117-default-admission.json`。

此前voHH3f同为12分钟曾记录输出增长下界62、present501ms，另一次pulse实验79；这些测试仪器与运行时点不同，不能直接据此计算普遍提速百分比。当前证据支持通知+短锁组合通过既定帧率、像素、故障与并发门槛，未支持增加显存开销与协议复杂度更高的多纹理池。

因此 `RenderHostClient` **默认请求真实frame-ready通知**，使当前支持通知的宿主默认走锁外真实GPU等待、锁内原子发布、事件唤醒取帧路径。保留 `AVHUB_RENDER_FRAME_NOTIFICATIONS=0` 诊断回退；旧宿主在实际收到首条通知前始终用旧10ms轮询预算。没有改变默认播放引擎、独立MPV或Chromium/Hls.js路径，也没有绕过真实GPU完成/全部引用释放/ACK保护。

新增默认通知及未收到通知时回退的协议契约；原来显式关闭、退役、重复/迟到通知、错误分类仍验证。最终构建为 `6bdfe17b3a77f1aa`。默认模式将重新运行完整桌面回归与像素窗口验收，不要求用户设置开启变量。


## 默认路径最终验收

`playback-regression-Rt9Tag`：在**未设置**AVHUB_RENDER_FRAME_NOTIFICATIONS情况下运行，28 PASS / 0、无SKIP/未运行项，覆盖独立MPV、内嵌、三路径循环、启动/意图、seek matrix、故障及恢复。build/electron-build PASS / 0，通知/错误/计数/关联契约共22 PASS / 0。

实际默认像素/截图/窗口/控件流 `render-app-flow-7nXfg3` PASS / 0，真实requested=true、received=33；新默认并非只改了开关文案。旧无通知宿主 `render-app-flow-s1Foq9` PASS / 0，requested=true、received=0时正常走原轮询；新宿主显式关闭 `render-app-flow-Zq98je` PASS / 0，requested=false、received=0。三个流均有真实画面、定位、截图与平衡关闭校验。

## 本轮交付范围

现在默认开发版内嵌MPV通过真实就绪通知取帧，不再在GPU等待期间占用查询锁。用户无需开启试验变量；已打包的旧EXE不会被源码修改自动替换。本轮没有生成新成品、更新版本或远程发布。

没有盲目增加多纹理池，也没有把GPU完成冒充全部引用释放。已确认的结构性阻塞得到修复并进入默认路径；本轮十二分钟未复现旧约500ms晚释放，但不能证明所有硬件/文件再无这种偶发事件。新的有界跨进程诊断可用于再次触发时分辨实际环节。新成品、外机、物理HDR/多DPI与更长时间覆盖均未验收，不用旧报告替代。
