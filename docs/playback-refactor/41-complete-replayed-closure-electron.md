# M5：新完整闭包与 Electron 开发态验收

2026-10-28。继续报告 40。版本保持 0.2.16，普通默认库和上一批候选未替换；未打包、推送或发布。E:\downloads 未参与本批测试。

## 新完整闭包

输出 `build/libmpv-chain-replay-1a5jyjem`。从冻结材料 `build/native-source-materials-53nn28ty` 提取 MPV 源码，明确选择此前重建的五个依赖前缀：

- FFmpeg：ffmpeg-source-replay-wesx64x9（其 dav1d／zlib 来自报告 40 的新前缀）；
- libplacebo：libplacebo-source-replay-halz2k13；
- 字幕：subtitle-source-replay-c6vp31en；
- shaderc：shaderc-source-replay-j5155yvv；
- 基础渲染依赖：render-deps-replay-n9lsb7gr。

构建入口核对五项齐备、Windows 验证状态、源归档哈希及实际依赖二进制，不依赖默认 latest 指针选择。各批材料清单因配方演进不同，组合时核对固定源归档身份；没有把不同清单描述成同一次干净环境构建。

实际构建、安装完成。新 libmpv SHA256：`ee574a3359daa225e63e858faf48e5c3c9be46ddcd552b6781b04992f89d5880`。10 项上游核心测试与 4 组 null-VO DLL API／解码检查通过；29 个 DLL 的静态导入闭包核对完成，21 个外部系统导入从 System32 解析。

这覆盖新媒体／渲染／字幕闭包，编译器及其运行库仍复用原固定工具链，不是 GCC 重建或干净机器证明。

## 独立准入与材料

- 新固定记录：ci/replayed-render-runtime.json 与 electron/src/replayedRenderPin.ts；精确固定主 DLL 和 28 个依赖哈希。
- 原生 C# 宿主仅新增这个精确 DLL 哈希；Lua 未编译的既有处理同样限于已固定候选，没有接受任意 DLL。
- 新目录 `build/render-replayed-candidate-Aa7Otl`：85 项文件、21 个源归档记录、来源与许可材料。其 runtime.json 仍为 productionDistributionReady=false。
- 仅显式开发环境候选选择可以使用新目录，发行态拒绝；旧默认路径和 selfbuilt 候选保持独立。没有更改用户播放设置。
- 原前缀／候选指针保留，真实 Electron 还分别回归了普通默认和上一批自建候选。

## 实际 Electron 功能证据

以下均运行真实 AVHub Electron，使用隔离数据库和项目自有生成样本；画面核对来自合成器像素，不是显示器物理扫描或纯 mpv 进程检查。

| 检查 | build 下证据 | 结果 |
| --- | --- | --- |
| H.264、Unicode 多级源路径 | render-app-flow-Kzmqk1/report.json | passed |
| 4K HEVC | render-app-flow-xnQ7HU/report.json | passed |
| 4K 10-bit 横屏 | render-app-flow-kPhDHH/report.json | passed |
| 4K AV1 | render-app-flow-H33lQq/report.json | passed |
| 10-bit 竖屏 | render-app-flow-Cr80nz/report.json | passed |
| 字幕、音轨、延迟、样式、倍速、持久化、播放器切换与下一视频 | render-app-controls-kVO3zG/report.json | passed |
| 真实测试宿主退出、GPU consumer device loss、缺失库及重试等 | render-app-faults-TVN7k6/report.json | passed |
| 原默认路径，新宿主 | render-app-flow-CF4JOV/report.json | passed |
| 原自建候选，原冻结宿主 | render-app-flow-1D4irs/report.json | passed |

五组画面流程核对第 31、52、109、128、10 帧（25 fps）的实际标记，以及播放中跳转／空格、截图、缩放旋转、全屏／纯净窗口、释放及源文件身份。10-bit 样本截图为原尺寸 16-bit PNG。实际加载模块也核对在新目录中，不靠 PATH 里同名库通过。

首次沙箱内工具调用遇到 Electron “Process failed to launch”，未产生 harness report。保留目录 build/render-app-flow-BAAiWZ，并按工具输出单独补记 launch-failure-observation.json（明确标注为人工归档的观察）；随后在授权的桌面执行环境重跑通过，没有据此宣称修复了产品启动问题。没有通过模拟页面代替桌面检查，也没有把启动失败改写为成功。

## 连续播放

已完成 `build/render-app-soak-BKHddA/report.json`：固定 30 秒预热后测量 900.171 秒真实 Electron 4K SDR 10-bit 连续播放。样本为 960 秒时间线、重复六秒内容，不是真实长电影。

- 实际像素推进／墙钟比 1.0000117468，源加载始终 1 次；图像标记／媒体时钟检查通过。
- 测量区间新增解码丢帧 0、输出丢帧 0。启动已有的 1 帧输出丢弃保留，不宣称整个运行绝对零丢帧。
- 既定固定预热、正增长／空闲收敛策略通过：句柄峰值正增长 9、最终正增长 0；宿主 private 峰值正增长 2,519,040 字节；显存峰值正增长 0。没有修改阈值、强制 GC 或等待直到通过。
- 原始范围检查仍为 false：晚期句柄范围 19（旧阈值 16）、显存范围 67,174,400 字节（比 64 MiB 多 65,536 字节）。旧候选的同类观察继续保留，不以收敛通过掩盖原始范围失败，也不把重复观察宣称为根因修复。
- 退出后宿主已结束、源占用已释放；23,290 次纹理导入全部释放，1 个租约全部关闭，源文件身份未变。

结论为当前固定环境下的连续播放与既定收敛策略通过；不外推到其他设备、多任务长时或发行成品。摘要见 build/replayed-closure-acceptance.json。

## 回归与剩余边界

Node 引擎／运行库／门禁相关测试 29 项通过。Python 来源、依赖、重放及实际产物回归共 44 项，通过 43 项、跳过 1 项（已有目录链接测试的环境限制）。前端及 Electron 编译通过，build identity 为 8529cb47ddb8d3aa；既有 Vite 配置和 chunk 提示未作为本次性能修复处理。

当前仅单屏 SDR 开发态。实体 HDR、多屏不同 DPI、干净机器和发行成品验收未完成；音频测试使用静音输出端点，不宣称听感／bit-perfect／完整音画同步通过。此前资源观察保持原始记录，本轮长时结果也必须分别报告原始波动范围与收敛政策，不能改阈值掩盖失败。

M5 尚未整体完成。下一步补齐新闭包的同条件随机跳播对照与分发／本地成品验收配置，复核发行材料和完整应用源码，再按授权进行成品及干净机器验收；不自动切换默认、打包或推送。
