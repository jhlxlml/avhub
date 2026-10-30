# M5 普通桌面启动与准入清理

2026-10-30。本轮为后续 M5 迭代，不替换历史 SDR 成品包的验收结论。没有升级版本、推送或发布。

## 本轮实现

- 旧 MPV 窗口路径取得源文件只读租约时，不再依赖编码、像素格式、位深或色彩预探测。未知元数据留给 MPV 解码，源身份校验与文件占用保护保留。
- 新嵌入路径前置 FFprobe 改为流信息探测，不再预解码 32 帧；实际 HDR 传递函数仍由解码后的 video-params 校正。HDR 待验证提示同时依据实际输出状态，不只看前置合同。
- 取消 Render API 起播、跳播、进度和截图时间参数中的七天固定上限。只允许有限非负时间值；界面已知时长仍用于约束用户目标。
- 起播与截图命令的等待预算分开为 30 秒，普通控制仍为 10 秒。宿主初始化预算与截图派发预算同步调整；GPU 读者释放、进程退出、文件租约保护未放松。此项是避免误超时，不作为性能提升证据。
- SUP 图形字幕不再受文字字幕 16 MiB 统一限制；旧窗口导入支持 SUP。文字字幕的大小保护仍保留。本轮未完成大 SUP 实片验收。
- 普通桌面包可以通过匹配的 native-render-desktop.json 使用重建 MPV 运行库，无需 Start-render-acceptance.cmd 或验收环境开关。运行库哈希、宿主源码、依赖、FFI 和包内路径校验继续生效。
- 新增 electron/desktop-render.builder.cjs：复用完整原生及许可预检，不附带验收启动脚本。仍是禁止发布的本地集成候选；默认 package.json / CI 发布配置没有切换，不声称全局发布集成已完成。

## 实际成品

目录：build/m5-desktop-native-20261030/win-unpacked。直接运行 AVHub.exe，在设置中选择 MPV 和 D3D11；整个目录须保留，不能只复制 EXE。

- 应用构建：82fca3c0ff8850bb，版本 0.2.16。
- 原生运行库：render-replayed-candidate-3bupPu。
- 冻结源码：build/application-source-review-ew4j5tie。
- 独立应用及后端重建：build/application-build-replay-87Amej；replay-report.json、backend-replay-report.json 均通过。
- 实际受控 CLI 后端：build/m5-controlled-backend-w2pvw5s_/AVHubServer。
- 没有生成额外 ZIP / 自解压 EXE，也没有上传。

## 验证

| 验证 | 报告 | 结果 |
| --- | --- | --- |
| 开发态旧 MPV 窗口，清空自建索引编码与色彩元数据后的完整应用流 | build/native-app-flow-amYjtT/acceptance.json | 通过 |
| 开发态超过七天时间轴准确跳播 | build/render-unverified-color-SwwS1n/report.json | 通过 |
| 开发态 PQ / HLG | build/render-unverified-color-BW3aMH/report.json；build/render-unverified-color-liOdcT/report.json | 通过 |
| 开发态文件旋转 | build/render-unverified-color-4pu7Cd/report.json | 通过 |
| 实际桌面目录包控件、截图、显示切换、恢复；去除开发工具 PATH | build/render-app-controls-qxrxEE/report.json | 通过 |
| 实际桌面目录包 PQ，无验收环境开关 | build/render-unverified-color-zU9zUj/report.json | 通过 |
| 实际桌面目录包超过七天跳播，无验收环境开关 | build/render-unverified-color-q45cAK/report.json | 通过 |
| 实际桌面目录包普通启动与缺 DLL 后主界面可用、引擎不可用；恢复 DLL 哈希不变 | build/render-desktop-package-iwxuin/report.json | 通过 |

超长样本仅为前 12 秒帧序列加一个七天后的实际编码帧，不是连续录制七天的实片。目标 604810 秒，实际 GPU 画面变化、源加载一次、零重启；不用于证明七天连续稳定性。

另外：14 项 Python 原生源/租约测试、13 项 Node 策略/完整性/恢复测试、19 项截图测试通过。前端和 Electron TS 构建、C# 宿主编译通过。

测试失败记录保留：最初两帧 MP4 的时间戳未按预期保存；改成 MKV 后起播直接到末帧，不能证明跳播画面变化；最终使用前段连续帧加远端目标帧，并通过实际成品测试。精简探测后 HDR 提示取值缺失已修复。截图测试首次用错误的模块搜索路径调用失败，按项目运行时及 discover 方式重跑通过。

## 剩余工作

1. 新嵌入仍需五秒有界尺寸探测。彻底取消前置尺寸依赖，需要先完成 MPV 元数据驱动的显示表面初始化；本轮没有用索引尺寸猜测替代。
2. 动态分辨率变化仍报告 NATIVE_SOURCE_CHANGED。应补齐原生表面、句柄租约和 WebGPU 接收端同步重建，不可直接删除检查。
3. 新普通启动配置尚未接入默认构建/CI 发布流程，完整搬迁、冷启动与最新外机验收仍需另行补齐；本轮候选通过不等于已发布。
4. HDR 实体显示、动态元数据及混合 DPI 验证状态沿用未验证，不限制尝试播放。旧成品 ZIP 不会自动获得本轮代码。
