# 播放回归入口与打开阶段核查

2026-11-08；版本保持 0.2.19。HEAD 仍为 f3f65dbc321b54541f09be6b1558fb9e4f5eab27，保留已有未提交修改及用户规划文档。本轮不打包、不提交、不推送。当前产品构建标识 16af6d5f9d02f159。

## 可复现入口

- `npm run test:playback`：构建身份、TypeScript、Electron、MPV Client 和两个适配器合约；不代表原生解码或桌面验收。
- `npm run test:playback:desktop`：以上步骤、Vite、完整性预检、真实 Electron 指针/意图、打开/取消重开、独立窗口、三引擎循环及双 MPV 跳播矩阵。串行运行 GPU 用例，失败即停止，保留每步日志、退出码和未运行列表。需要可交互 Windows、项目 FFmpeg/Electron/原生运行库；不自动下载、不关闭 sandbox/hash 检查。
- 桌面运行库可显式指定 `AVHUB_RENDER_RUNTIME_CANDIDATE`，否则读取现有 staging 指针并执行原有验证。没有准备的运行库不能被视为通过。
- 默认生成隔离 MP4、H.264 TS 和 960 秒 4K 10-bit HEVC MKV。长样本由生成的 6 秒 HEVC 流复制拼接，只有生成媒体被编码，不能作为真实电影长片内容/色彩验收。
- `playback-fixtures.mjs` 供四个既有测试和组合测试复用；不再读取旧 `build/libmpv-render-spike` 或随机旧 SQLite 目录。可显式提供 `AVHUB_TEST_BASIC_SOURCE`、`AVHUB_TEST_HEVC_SOURCE`；短样本结构必须满足片尾用例的 6 秒、2 秒关键帧、无音轨前提。矩阵另有含音轨 MP4/TS/HEVC。样本生成在自有 build 目录，不改原片。
- 打开性能脚本独立建库、扫描复制样本，仍包装实际调用计时，不伪造就绪/呈现。

## 真实失败及处理

1. 新入口第一次未生成构建身份，实际前端/服务版本检查拒绝启动：`playback-regression-fViPg5`，FAIL / 1。已把身份生成放在编译前，未关闭一致性检查。
2. 最初生成短样本结构与历史无音轨帧码样本不同，独立窗口的“必须发生末段精确回退”断言失败：`playback-regression-dQNCm4`、`NuHsfn`，FAIL / 1。报告实际关键帧落点约 5.013 秒且无纠偏，不能认作发生了精确回退。FFprobe 对照后按既有明确结构生成短样本；含音轨覆盖保留在矩阵中，没有放宽原断言。不同音轨/解复用结构可能改变 keyframe seek 行为，不能以此证明所有文件尾部行为一致。
3. 新组合测试最初错误地把内嵌请求发给独立窗口接口，又曾绕过独立 Lua 所有权调用主窗口控制，均被真实 IPC 拒绝。另有未等待截图完成、只发 range input 未发 Chromium 的提交事件等测试编排失败。保留 `playback-path-cycle-lE1Dpm/C4GbW2/rSfAqA/483Bs9/DwY1Z6` 失败报告；最终改用正确 UI 处理器/真实鼠标、独立 MPV 私有管道与原有 Lua 消息，并等待真实保存及就绪。不修改生产权限来迁就测试。

## 打开阶段与小范围调整

`RenderHostClient.startupTimings` 新增实际完整性验证及宿主打开耗时。验证每次照常执行，不缓存或绕过 hash。`render-startup-profile.mjs` 记录这两个阶段及既有控制/显示/首帧耗时。

指定只读 4K VP9 MKV 的同会话三次打开对照：

| 报告 | 主进程实际首帧 ms | UI 点击至观察到首帧 ms |
| --- | --- | --- |
| 调整前 `render-startup-profile-5VdWvr` | 727.41 / 635.74 / 636.68 | 1138.10 / 696.01 / 696.55 |
| 调整后 `render-startup-profile-J6SEgs` | 767.80 / 649.08 / 648.99 | 937.31 / 737.90 / 738.96 |

调整前完整性校验约 67–73 ms、宿主打开约 311–323 ms、显示诊断约 15 ms。将只写日志的 display 查询移至首帧真实完成之后，异步保留成功/失败日志；它不参与宿主逐帧的输出色彩决策。未修改解码、HDR、位深、硬解、加载提示或完成判定。

**没有证实整体打开提速。** 调整后完整性校验约 71–95 ms、宿主约 313–326 ms；首帧波动足以盖过这约 15 ms 的诊断等待。不能用首个 UI 数值下降宣称统一性能提升，也不应继续盲目调轮询、预热常驻进程或跳过检查。仍需进一步拆解宿主初始化/解码/首帧阶段，基于稳定基准再动生产代码。两个 profile 都通过取消打开后重开断言，退出码 0。

## 验收证据

- 基础合约入口 `playback-regression-jre7OH/report.json`：PASS / 0。
- 首次完整桌面入口（加入组合用例前）`playback-regression-uH0JNj/report.json`：PASS / 0；双 MPV、三个格式、精确/快速/智能、连续/暂停/远跳及 4K 573.4 秒远跳报告 `mpv-seek-paired-0kgvw9/report.json`，6 行、144 个配对样本并含附加场景。
- 三路径组合 `playback-path-cycle-wymFNt/report.json`：PASS / 0。内嵌 → 独立 → Chromium，共两轮；真实播放时钟、暂停跳播、截图共六张、最小化恢复、关闭两类 native active 状态及移除 canvas。MPV 每次 sourceLoads=1、hwdec=d3d11va。生成源 SHA256 不变。短循环不等于长期无泄漏证明。
- 最终统一入口 `build/playback-regression-JWfJVe/report.json`：PASS / 0，12 个步骤全部通过，unrun/skipped 均为空。两个适配器共 25 个合约断言通过。真实指针报告 `render-playback-intent-SXUVUc`、打开 `render-startup-profile-Cenpcv`、组合 `playback-path-cycle-AF81vP`、矩阵 `mpv-seek-paired-E52rxC`。每步日志及退出码均在入口报告中；持续播放结果另在下方补充。历史成品报告不代替本轮源码结果。

回滚只需移除本轮 RenderHostClient 阶段计时字段，以及把 display 诊断调用移回 start 的原位置。测试工具和入口可独立撤销。不要整体还原文件，避免丢失此前播放修复。

## 最终持续播放与资源观察

`build/hdr-real-media-5geMWF/report.json`：PASS / 0，实际运行 180.028 秒；真实只读 VP9/PQ HDR 片源。60、121 秒处各有一次真实精确跳播，耗时约 902、889 ms。该用例默认精确模式，不用于声称快速跳播同样需要此时长。

- 呈现序号推进 10,744，sourceLoads=1；最终及测量窗口观察到的解码/输出丢帧最大值均为 0。
- 原始片源 SHA256 与 mtime 前后一致。
- 原生句柄 877→876；私有内存 919,552,000→931,737,600 字节，中间有升降；GPU CurrentUsage 897,826,816→761,774,080 字节。这是三分钟观察，没有足够依据宣称长期无泄漏。
- 实际关闭日志确认 helperAlive=false、sourceLeaseReleased=true、clock requests/releases=3/3，imports/released/gpuCompletions=10758/10758/10758，NT leases/closedLeases=1/1。
- 这次 Electron 枚举两屏，缩放 125% / 175%；原生输出查询检测到 SDR 主屏和启用 HDR 的 10-bit 副屏。既有真实 HDR 用例将窗口分别移到两个显示器、核对 devicePixelRatio 并采集实际 compositor 图像。本轮环境已经不同于此前单屏 SDR 会话，不沿用旧环境描述。
- 显示拓扑及 compositor 图像不等于物理 HDR 色彩准确性证明。未做外机、真实 HEVC HDR/AV1 HDR/HLG 片源验收或最新成品打包验收。

下一步应继续拆解宿主约 0.3 秒初始化与解码到首次纹理的耗时，并对重复打开/关闭延长资源观察；当前数据不支持为了速度跳过完整性校验、常驻额外解码进程或降低画质。统一入口可直接复用本轮回归，避免再依赖旧测试目录。
