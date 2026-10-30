# M5 双 MPV 桌面候选与退出竞态修复

2026-10-30。用户明确要求正式包保留 MPV 独立窗口。本轮将独立 MPV EXE 与 Render API/libmpv 一并纳入本地桌面候选，保留旧窗口代码和设置偏好；不修改默认播放引擎，不升级版本，不推送或发布。

## 当前候选

`build/m5-desktop-dual-mpv-fixed-20261030/win-unpacked/AVHub.exe`，保留整个目录直接运行，无需验收脚本。

- 应用构建：35d280b2e4ba7efa，版本仍为 0.2.16。
- 内嵌：resources/native-render，沿用已固定的 render-replayed-candidate-3bupPu。
- 独立窗口：resources/mpv/mpv.exe、LICENSE.GPL、BUILD-INFO.json；EXE SHA256 b294a778f57b2d706e9a3c65a912130e3f5544a8b34708b67a47b59a6cbb6ff2，与 electron/mpv-runtime.json 一致。
- 构建配置：electron/desktop-render.builder.cjs，在完整的内嵌运行库预检之外，增加 NativeRuntime 的独立 EXE / 许可校验。候选仍禁止 tag 发布、publish:null。
- 后端独立冻结重建：build/application-build-replay-mqE9oh，源快照 build/application-source-review-q2unrdng；实际受控 CLI 后端 build/m5-controlled-backend-xe744h3z/AVHubServer。
- 成品文件核验：M5-DUAL-MPV-AUDIT.json。8 个关键 ASAR JS 模块与实际编译输出、21 个前端交付文件逐字节一致；独立 EXE 和许可哈希一致。

## 退出竞态

真实成品交叉测试发现，刚点击返回媒体库即退出应用时，后台已经开始关闭原生会话，退出监听器却再次 flush 同一关闭中的会话，导致误报保存失败并停在确认框。

NativePlayerLaunch 的 stop 现在复用同一个进行中任务；退出监听器等待正在关闭的任务完成，不再同时 flush。真实保存错误仍返回失败，不跳过文件租约和解码进程退出保护。没有通过吞掉全部错误或强退让验收变绿。

新增独立的渲染器生命周期竞态测试，断言只有一次 close、没有并发 flush。完整原生启动生命周期 harness 16 项通过；这是渲染器边界测试，不冒充原生性能证据。

## 真实成品验收

| 项目 | 报告 | 结果 |
| --- | --- | --- |
| 设置选择独立窗口、播放、跳播、截图、置顶、倍速、字幕延迟、全屏、连播、保存错误恢复和退出 | build/native-independent-wiBOMP/acceptance.json | 通过 |
| 独立窗口 → Render API 嵌入 → 独立窗口 → 退出重启，偏好不变；立即返回后退出 | build/mpv-window-coexistence-wsHrKk/report.json | passed=true，cleanExit=true |
| 内嵌 PQ 10-bit 合成样本实际解码、GPU 导入和跳播 | build/render-unverified-color-aMOzfU/report.json | 通过 |
| 分别缺失 libmpv 和独立 EXE 时，主界面可用、仅对应引擎不可用；测试后原文件哈希恢复 | build/render-desktop-package-ZgIWOG/report.json | 通过 |

跨模式使用真实设置控件保存，并在重启后再次打开独立窗口。没有替换运行库或模拟播放实现。独立窗口专项使用应用内 MPV 原生 keypress/mouse 命令注入和自建 H.264 640×360 样本；不等于实体鼠标/键盘、HDR 扫描输出或所有实片验收。内嵌 HDR 仍按未验证实体显示效果记录，不限制尝试。

10 项 Node 运行库完整性、发布证据、桌面运行库策略测试通过。前端/TS 构建与独立后端重建通过。

失败证据保留：UNEadg 的 check() 对异步保存控件过早判断；改为等待真实状态后，z8ga3r 完成了功能切换但停在退出保存提示，需要结束自建测试进程。z8ga3r 已标记 passed=false、cleanExit=false、forcedTerminationByTestSupervisor=true，不能作为通过证据。修复后 wsHrKk 正常退出，并有 renderer-save-complete success=true、backend-stopped gracefully、shutdown-complete 日志。

## 尚未完成

- 独立 MPV EXE 仍是清单中的固定哈希滚动预览构建。electron/mpv-distribution.json 的对应源码、依赖许可与构建材料尚未齐备，未把 distributionReady 改为 true。本地功能通过不代表正式发布准备完成；后续应整理其对应材料或准备具备 Lua 功能与来源闭包的可追溯 EXE，并重新做独立窗口验证。
- 新嵌入的 MPV 驱动尺寸初始化、动态分辨率显示表面重建仍待完成。
- 默认构建/CI 流程、完整搬迁和新版外机验收仍待推进。历史 ZIP 不包含本轮修改。
