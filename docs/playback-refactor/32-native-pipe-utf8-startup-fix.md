# 原生宿主 UTF-8 通信修复（2026-10-27）

## 现象与证据

`npm run dev` 在打开带韩文文件名的 3840×2160 VP9、8-bit BT.709 SDR MKV 时显示“原生渲染宿主已退出”。同一入口的 ASCII 路径生成样本可正常播放，因此此前样本验收未覆盖这个边界。

真实 Electron、原始媒体库只读复制、同一自然视频的修复前报告：`build/render-startup-reported-CKhLVl/report.json`。子进程在首个画面前退出，stderr 为 `ArgumentException: native host could not start`，退出码 1。

单独的标准输入编码诊断报告 `build/native-encoding-probe/report.json` 表明，.NET Framework `Console.InputEncoding` 默认为 `gb2312`，而 Electron 向标准输入写入 UTF-8 JSON；读入后的路径哈希与发送前不同，文件存在性检查失败。该诊断仅解释边界；最终验收使用真实 Electron，而非独立 MPV。

## 修复

`electron/native/render/RenderHost.cs` 在首次 `Console.ReadLine` 前明确设置严格 UTF-8 标准输入及无 BOM 的 UTF-8 标准输出，后续命令共用相同编码。重新构建开发宿主，不更换 libmpv，不修改解码、渲染精度、原文件或播放回退策略。

- 宿主 SHA-256：`3514bb9452d5b811ff1929fe213f545056372141355c28bd04f478963ae09e73`
- libmpv SHA-256：`ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74`
- 清单：`build/native-render/runtime.json`

## 回归结果

| 验收 | 结果 | 本地证据 |
| --- | --- | --- |
| 用户截图对应自然视频启动、暂停、12.12 / 62.44 秒跳播、接收完成帧和不同目标画面、返回媒体库 | 通过；原文件大小及修改时间不变 | `build/render-startup-reported-9S5bLN/report.json` |
| 中文、韩文、emoji 多级路径；生成帧码的 5 个准确目标、截图、播放中跳播、快捷键、缩放旋转、全屏、纯净播放、返回 | 通过；生成源文件前后 SHA-256 相同 | `build/render-app-flow-fpSOKk/report.json` |
| Unicode 字幕名称、音轨/字幕/延迟/倍速/样式、记忆恢复、播放器切换、换片、旧请求隔离 | 通过 | `build/render-app-controls-br2NOB/report.json` |
| 宿主故障与恢复 | 通过 | `build/render-app-faults-0mdAKT/report.json` |
| 原生源契约单元测试 | 4 项通过 | `python scripts/python-runtime.py -m unittest tests.test_native_render_source` |
| 命令桥相关性、流错误、超时 | 3 项通过 | `node --test electron/test/render-api/command-bridge.test.cjs` |

复现入口：`node electron/test/render-startup-reported.mjs AVHub-data/library.db 2532`（该 ID 为本机索引项）；通用 Unicode 生成样本回归使用环境变量 `AVHUB_TEST_UNICODE_SOURCE=1` 后运行 `node electron/test/render-app-flow.mjs`。

## 范围与后续

这是启动通信问题修复，不是播放性能或所有文件兼容性结论。自然画面差异哈希不代表独立参考帧精度验收；没有声称实体 HDR、多屏或长期运行验收已完成。M5 发行许可材料、Windows 重建与成品放行仍待完成。

本轮未打包、未发布、未修改版本号、未推送。默认开发入口使用已重建宿主，重启 `npm run dev` 生效。历史 `render-runtime-candidate-*` 是冻结验收副本，不会自动同步此次修改；显式选择旧候选的测试须重新暂存，不能用旧候选冒充已包含此修复。
