# M5：自建 libmpv 的 Electron 开发态验收

2026-10-28。基线 main / 9678689，版本保持 0.2.16。本批将固定源码构建的 Windows libmpv 接入真实 AVHub Electron 测试，未替换普通启动默认运行库，未打包、推送或发布。历史报告 35 中的 Electron 未验收状态对应其完成时刻；本报告记录后续证据。

## 精确候选与启动修复

- 候选 `selfbuilt-sdr-2cf60d001765`：libmpv SHA256 `2cf60d001765b91cf3f40a7ef115da010385ecc46442d609d8a75d3db3defa88`，28 个动态依赖分别固定 SHA256。完整 DLL 闭包共 29 个文件。
- 主进程编译期记录 `electron/src/selfBuiltRenderPin.ts` 与审核输入 `ci/self-built-render-runtime.json` 一致；原生宿主也固定这一个新 DLL 的哈希。未允许任意 DLL。
- 只允许显式开发候选选择；发行态拒绝该选择。普通启动继续使用旧 DLL 哈希 `ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74`。
- 首次实际启动暴露了 Lua 已编译关闭时 `load-scripts=no`、`ytdl=no` 返回 -5 的问题。宿主仅对这个已固定的新库跳过这两个不存在的功能选项，旧库仍显式禁用；其余选项失败继续报错。依据 `build/selfbuilt-native-options.json`。
- 早期失败报告 `render-app-flow-Ls9woi`（前后端构建身份不一致）与 `render-app-flow-4vzlG3`（以上原生选项失败）保留，没有改写为成功。

## 真实 Electron 证据

以下均使用应用 UI、真实 Render API 和合成器像素检查，媒体为项目自有的固定生成样本，隔离媒体库；不是单独运行 mpv，也没有修改 E:\downloads。

| 内容 | build 下证据 | 结果 |
| --- | --- | --- |
| H.264，Unicode 多级文件路径 | render-app-flow-Z3ZRuz/report.json | passed |
| 4K HEVC | render-app-flow-6zmpIL/report.json | passed |
| 4K SDR 10-bit 横屏 | render-app-flow-gq6zHe/report.json | passed；截图 3840×2160、16-bit PNG |
| 4K AV1 | render-app-flow-l0goy9/report.json | passed |
| SDR 10-bit 竖屏 | render-app-flow-ZZ38H2/report.json | passed |
| 字幕、音轨、倍速、状态持久化、切回旧播放器、下一视频 | render-app-controls-NT85N7/report.json | passed |
| 真正的宿主退出、GPU consumer device loss、缺失运行库、损坏隔离样本与重试 | render-app-faults-Dbx0qM/report.json | passed |
| 不选择候选的旧默认运行库 | render-app-flow-pNaopy/report.json | passed |

五组画面流程都核对第 31、52、109、128、10 帧目标的实际图像标记（25 fps，即 1.24、2.08、4.36、5.12、0.4 秒），并覆盖播放中跳转与空格、旋转缩放、全屏和纯净窗口、退出释放、源文件身份。这是短生成样本的功能与定位精度检查，不是长视频随机跳播速度结论。自建流程还检查实际加载的 libmpv、libplacebo、avcodec、libass、shaderc 模块位于选定目录，没有依赖 PATH 中同名库。

WASAPI 测试观察到真实静音端点输出（44100 Hz、双声道 float），源解码音频为 48000 Hz 单声道 floatp。这是输出端点的混音格式，不是源文件转码；没有据此宣称听感、音画同步或 bit-perfect 通过。图像证据来自 Electron 合成器，不是显示器物理扫描测量。

## 连续播放

已完成 `build/render-app-soak-P8puZ3/report.json`：固定 30 秒预热后，连续 900.163 秒播放自有 4K SDR 10-bit 样本（960 秒连续时间线、六秒内容重复）。

- 实际像素推进／墙钟比 1.0000248654，通过既定 0.99–1.01 阈值；图像标记与媒体时钟误差通过检查，源加载始终 1 次。
- 测量区间解码新增丢帧 0，输出新增丢帧 0。启动阶段已有 1 次输出丢帧，不从日志抹去，也不宣称整个运行绝对零丢帧。
- 固定预热后的正增长/空闲收敛检查通过：句柄峰值正增长 9、最终正增长 0；宿主 private 峰值正增长 3,887,104 字节；显存峰值正增长 0。未强制 GC、未等待“直到通过”、未改变阈值。
- **原始范围检查仍失败**：晚期句柄范围 19（阈值 16）、显存范围 67,174,400 字节（比 64 MiB 多 65,536 字节）。这一结果和已知旧库观察相似，但没有据此宣称新库问题已解决。原始失败与收敛通过分别保留。
- 退出后宿主进程已结束、源文件占用已释放；23,286 次纹理导入全部释放，1 个租约全部关闭。自有源文件身份未变。

结论仅为当前固定环境的连续播放与既定收敛策略通过；原始资源波动观察保留，不等价于其他机器、长时多任务或发行成品验收。

## 来源与分发材料

- 实际测试候选目录 `build/render-selfbuilt-candidate-vcjC9v` 保持冻结；补充材料另生成 `build/render-selfbuilt-candidate-S97Uzy`，其宿主、DLL、FFI 身份相同。后者文件表 85 项、对应 21 个已用源码归档记录。
- `scripts/capture-native-support-materials.py` 离线读取已核对 SHA256 的 Ubuntu .deb，按常规文件成员比对 4 个 GCC/MinGW DLL 与候选哈希，记录精确包版本及成员路径；不安装包，不执行包内脚本，不从 tar 解压路径。
- 收集 GCC copyright（含 Runtime Library Exception）、MinGW copyright 和项目 GPLv3 LICENSE。材料位于 `build/native-support-materials/report.json`，新候选也附带这些文本。
- 这解决的是来源及通知文本的可追踪性；对应源码交付完整性、整个构建的许可证义务及发行审核仍未完成。`distributionReady` 与 `productionDistributionReady` 均保持 false。

## 验证边界与后续

相关 Node 回归 26 项通过：候选身份/材料清单、运行库布局、发行配置隔离、引擎桥接、原生检测和恢复策略。Python 来源/原生契约回归共 19 项，通过 18 项，1 项因环境不允许创建测试目录链接而跳过。首次 Python 测试默认临时目录被沙箱拒绝，改为本项目 build 下隔离临时目录后重跑通过；没有放宽被测来源校验。`git diff --check` 通过，既有换行符提示没有引发归档源码修改。

本次范围仍为当前单屏 SDR、Windows x64、D3D11、开发态固定样本。HDR 实体显示、多屏不同 DPI、其他机器及成品启动退出不在本次通过范围。新库为明确裁剪的 D3D11 候选，不宣称拥有旧库所有可选后端和编码功能。

下一步优先补齐精确对应源码及发行材料审核，并在发行候选上继续复核原始资源波动；再依用户授权进行成品和干净机器验收。不会因为开发态通过就自动切换用户默认或宣布 M5 全部完成。
