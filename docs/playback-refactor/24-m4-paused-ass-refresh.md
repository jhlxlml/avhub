# M4：暂停字幕刷新与播放意图衔接

2026-10-27。本批仍在用户授权的单屏 SDR 开发态范围内。原画路径、默认引擎和发布开关不变。

## 实际发现

新增真实 Electron ASS 验收，使用应用自有的六秒帧码视频，以 stream-copy 封装到 MKV，附带含矢量绘图、位置、旋转动画和卡拉 OK 标记的 ASS。读取 Electron 合成画面的帧码及绿色矢量区域，不能仅凭选中字幕或 time-pos 宣称画面已更新。

`build/render-ass-seek-mZoQWS/report.json` 记录暂停时 sid 已为 1、sub-text 仍为空、画面没有字幕；短暂恢复播放后文本和绿色区域出现。同一测试曾通过，也曾失败，故不是单纯 UI 选中状态或 ASS 文件无效。独立 FFmpeg 参考画面也确认该字幕有效。

首次直接在暂停位置执行 exact seek 的原型产生 0.52→2.0 秒偏移，失败证据 `build/render-ass-seek-kewU7F/report.json` 保留。不能把字幕显示出来、却改变视频位置的实现作为完成。

## 修复方式

- 仅在暂停状态选入字幕时触发当前帧重新解码；正常播放时保持原路径，不打开新源。
- 复用有界的目标位置校正，等待真实帧与 GPU 交接完成。内部字幕定位不生成用户跳播完成编号，用户新跳播可以覆盖内部定位。
- 遇到已有 GPU 读者或用户跳播时延后刷新；刷新期间记录最新播放意图，确认字幕帧后再恢复，连续空格可以取消恢复。
- 刷新尚未完成时禁止截图；进度持久化取已呈现帧的位置，避免保存内部解码器暂时跳到的关键帧。诊断中的原始 time-pos 仍保留。
- UI 的播放按钮和快捷键按用户意图切换；切回现有播放器保留该意图与显示位置。失败与 EOF 不用意图掩盖真实状态。

涉及 `electron/native/render/RenderHost.cs`、`electron/src/renderPlayer.ts`、`frontend/src/NativePlayerOverlay.tsx`、`frontend/src/NativePlayerLaunch.tsx`；没有调整画质、转换许可、源文件或媒体库布局。

Render API 标志语义核对固定运行库的 `build/libmpv-d3d11-input/runtime/include/mpv/render.h`：REDRAW/REPEAT 已包含 PRESENT 语义，未通过放宽有效帧过滤来伪造完成。定位行为参照 [MPV 官方手册](https://mpv.io/manual/stable/)，未使用未经确认的 video-pts 属性。

## 当前候选验收

应用 build `9bfe12f3fda7d68e`，宿主 SHA-256 `1b204ba8ec38e5f3df485d583f586ed3e6e8e0aa783a255784e0c53a63f0776a`；DLL 沿用已核验的 `ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74`。应用 build 不覆盖 C#，必须同时记录宿主哈希。

`build/render-ass-seek-giMsmU/report.json`：二十次目标帧核验、四十次快速字幕切换、字幕与用户跳播交错、刷新期间播放/暂停意图反转、刷新期间显式切回现有播放器全部通过。字幕绿色区域比例为 1，暂停位置保持；切回后从约 4.48 秒继续播放，观测约 4.866 秒。GPU 确认延迟仅为可控并发验收，不作为速度成绩。原源文件哈希保持，原生播放期间 sourceLoads 为 1。

其他当前候选回归：

- `build/m4-native-seek-intent-FnjiOU/report.json`：用户跳播、意图反转、超时恢复通过。
- `build/render-app-controls-hMAKBa/report.json`：音轨、字幕、截图、播放器切换通过。
- `build/render-app-faults-USMEwI/report.json`：进程、GPU 与恢复用例通过。
- `build/render-app-queue-GheC02/report.json`：快速换集、立即返回、自然连播与单集循环通过，退出资源核对通过。
- `node --test electron/test/playback-engine.test.mjs electron/test/mpv-engine.test.mjs electron/test/render-api/resource-convergence.test.cjs`：25 项通过；这是适配器与资源判定单测，不能替代真实解码。
- 前端与 Electron 类型检查及构建通过。未打包、升版本、推送或发布。

`build/m4-seek-matrix-dOAUYq/report.json`：六条路径各二十次，实际目标帧码全部通过。生成短样本 p95（毫秒）：Chromium direct 36.4、indexed-ts 31.6、indexed-remux 63.7；MPV MP4 31.1、TS 275.4、MKV 28.7。MPV 在该 TS 样本没有速度优势，未据此改动 auto 策略。Chromium 每条路径仍只有一次播放源请求。

`build/render-codec-seek-rCETvh/report.json`：4K HEVC MKV、AV1 MKV、SDR10 MKV、HEVC MP4 各二十次目标核验通过，p95 分别为 89.8、162.9、74.3、84.7 毫秒。这些是有帧码的生成素材，不等于所有自然影片。

## 最终候选长测与范围结论

`build/render-app-soak-YRjdQU/report.json` 使用本页上述最终应用与宿主：固定预热 30.012 秒，正式测量 900.162 秒，实际像素/时间比 1.00000147。新增解码丢帧 0、输出丢帧 0，播放源保持 1。

句柄基线 807、活动峰值 814（正向增长 7）、结束暂停 799、空闲范围 0；原生私有内存峰值增长 2,846,720 字节，显存正向增长 0。Electron 后段私有内存范围 37,424 KiB。23,283 次 GPU 导入、完成与释放全部匹配，唯一共享句柄租约关闭，宿主退出、源保护释放，测试源身份与哈希不变。

**原始范围结果仍不通过**：后段句柄范围 19、显存范围 67,174,400 字节，`rawRangePassed:false` 保留。按第 23 批预先固定的预热、峰值正向增长与暂停收敛流程通过；这不能改写冷启动失败，也不证明所有对象均无泄漏。进程 I/O 读 616,951,729 字节、写 16,368,056 字节，含缓存及协议管道，不代表物理硬盘吞吐量；原生进程 CPU 时间 48,937.5 毫秒。

后台无损封装回归 `python scripts/python-runtime.py -m unittest tests.test_indexed_remux tests.test_remux_windows`：22 项通过，TEMP/TMP 指向工作区独立测试目录。未接触用户视频。

M4 在已明确的单屏 SDR、开发态、固定稳态资源判定范围内完成。本结论保留原始范围失败和既往未归类返回事件作为发布观察项；不宣称完整硬件矩阵或生产分发完成。默认引擎不变，新 Render API 仍需显式开启且拒绝打包态。M5 尚未开始，下一步先审查运行库分发路径、依赖完整性与许可材料，再在另行授权的打包验收中验证实际产物。实体 HDR、多屏 DPI 与更多硬件组合仍未验证。

回滚：关闭 `nativeRenderEnabled` 即保留原有播放路径；开发代码回滚应按上述四个产品文件及关联测试的定向差异处理，不能重置整个已有工作树。
