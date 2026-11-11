# 内嵌 MPV 播完后播放恢复修复

2026-11-08，版本保持 0.2.19，构建 5d3ecfdc28e394d0。不打包、不提交、不推送，保留现有未提交工作。

## 可复现问题

真实 Electron 中，视频播放到 EOF 后按空格播放，eof-reached 仍为 true，实际画面不返回片头。修复前报告 build/render-playback-intent-jsjOYv/report.json FAIL，退出码 1。这不是加载提示问题，测试直接观察原生 EOF 和实际播放时钟。

源码 frontend/src/playback/MpvEngine.ts 的 play 原来只发 play 命令；原生宿主只取消 pause，没有主动离开 libmpv keep-open 保留的文件末尾状态。

## 修改与边界

MpvEngine.play 在 ended 且没有待完成用户 seek 时，先执行现有 seekTo(0)，等待匹配片头的真实新帧确认，然后恢复播放。若用户已经选择其他跳播位置，不额外发 seek(0)，保留其目标。playRequest 计数使重播等待期间收到的新 pause 或 play 优先，旧恢复步骤不在用户暂停后再次启动视频。暂停仍直接发送真实暂停命令，不改写时间、呈现回执或成功状态。

此修复使用现有精确 seek 与 GPU 呈现确认链路，不重新加载源、不重编码、不改变缓存、硬件加速、分辨率、位深或色彩，也不改变默认引擎。适用于内嵌 libmpv 的适配器，不改独立 MPV Lua 行为。

## 验收

| 回归 | 结果 | 退出码 | 证据 |
| --- | --- | --- | --- |
| MpvEngine 合约含 EOF 回片头、等待真实帧、新暂停取消续播、保留用户 seek | PASS，16 项 | 0 | node --test electron/test/mpv-engine.test.mjs |
| 前端构建与 Electron 编译 | PASS | 0 | npm run build / npm run build:electron |
| 真实 Electron，生成 MP4 播完后空格重播并验证实际时钟回到片头推进 | PASS | 0 | build/render-playback-intent-M8jX1k/report.json |
| 本机 HDR 真实片源，完整播放控制回归及 EOF 重播/EOF 选择指定位置 | PASS | 0 | build/render-playback-intent-LdiwNr/report.json |

本机片源 E:/downloads/The World in HDR in 4K (ULTRA HD).mkv 使用隔离副本，原文件 SHA256 与修改时间前后一致。验证包括实际播放到文件末尾、空格重播、再次 EOF 后选择 1 秒并立即播放、真实时钟恢复、源加载始终为 1。此前快速双空格、双按钮及暂停跳播仍通过。当前 SDR 会话不作为物理 HDR 输出或外机验收。

本轮没有宣称减少长 GOP 解码耗时，修复的是“结束后播放仍停住”的功能问题。回滚只需恢复本轮 MpvEngine 的 playRequest 和 play/pause 实现，其他未提交功能不动。git diff --check 退出码 0。
