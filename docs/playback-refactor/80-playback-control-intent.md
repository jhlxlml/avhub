# 播放／暂停连续操作丢失修复

2026-11-08，版本保持 0.2.19，构建 642dc6927ebbd7ea。未打包、提交或发布。保留此前全部未提交修改和原始用户文档。

## 实际问题与修复

真实 Electron 正常播放时，在一个输入回合连续触发两次独立非 repeat 空格事件，期望暂停再继续。旧 NativePlayerOverlay 的空格、画面点击及按钮处理都从尚未更新的引擎状态计算下一个开关，两次都发出 pause=true，最终错误停在暂停。实际复现报告 build/render-playback-intent-iR8N2c/report.json FAIL，退出码 1。没有人为延迟或模拟播放器状态。

修改 frontend/src/NativePlayerOverlay.tsx：为尚未收到 ACK 的播放/暂停输入保留最新目标及序号，三种入口共用 togglePause。后续输入相对最新用户目标切换，而非重复读取旧状态。只由对应最新命令的 finally 清除该输入目标，旧 ACK 不清理新目标；错误仍显示原有提示。未写入伪造的引擎 pause、time-pos、ready 或帧呈现状态，UI 实际播放状态仍来自原有状态流，未增加固定延时或串行等待视频解码。

## 验证

| 回归 | 结果 | 退出码 | 报告 |
| --- | --- | --- | --- |
| 原始快速双空格复现脚本，修复后 | PASS | 0 | build/render-playback-intent-Auuu3C/report.json |
| 完整操作回归，生成 H.264 MP4 | PASS | 0 | build/render-playback-intent-aRhbtc/report.json |
| 完整操作回归，本机实际 VP9/PQ HDR MKV | PASS | 0 | build/render-playback-intent-ICe4V1/report.json |
| 首帧前播放意图/暂停/恢复，真实 GPU 门控回归 | PASS | 0 | build/render-app-startup-intent-d3hVuV/report.json |
| MPV Client 队列、超时、真实落点及错误合约 | PASS | 0 | 命令 node electron/test/mpv-client.mjs |
| npm run build / npm run build:electron | PASS | 0 | 前端既有 Vite 配置/chunk warning 非阻断 |

完整操作脚本 electron/test/render-playback-intent.mjs 验证播放中双空格仍继续播放且实际时钟前进；暂停后连续点击两次播放按钮仍暂停；发出进度条跳播并连续切换两次后保持暂停、时钟稳定；重新播放后实际时钟恢复；源加载次数为 1。输入通过真实应用 DOM/键盘处理器，不能当作 OS 键鼠或物理扫描时间测量。

真实片源来自 E:/downloads/The World in HDR in 4K (ULTRA HD).mkv，只读复制到隔离 build 目录，跳至 38 秒，原文件 SHA256 与 mtime 前后一致。当前 SDR 环境只验证 HDR 编码片源的播放控制，不补充物理 HDR 输出验收。未改变编解码、分辨率、位深、色彩或引擎默认值。这次改动修复输入正确性，不宣称降低精确 seek 的解码耗时。

风险与边界：覆盖共享 React 原生 overlay，不修改独立 MPV 的 Lua 原生输入；独立窗口前轮已有对应控制测试。需要回滚时只恢复本轮 Overlay 的 pauseRequest/pauseRevision 与 togglePause 三个入口，保留其他原生引擎优化。git diff --check 退出码 0。
