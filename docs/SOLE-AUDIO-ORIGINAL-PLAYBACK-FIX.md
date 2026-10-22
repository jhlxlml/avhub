# 唯一音轨记忆导致原片起播失败

## 复现与原因

用户报告的 MP4 实际是 AV1 / 3840×2160 / 60000:1001 fps / SDR 8-bit，只有
一条 AAC 音轨（流索引 1）。只读核对日常媒体库，该文件的播放记忆确实为 audio=1。
没有修改日常数据库、设置或原视频。

真实 Electron、隔离单文件索引对照：

- 未指定音轨：原文件直放成功，有 3840×2160 解码画面。
- 记忆音轨 1：原逻辑把它视作音轨切换，prefer_original=false 并传 audio_track_index=1。
  后端没有尝试原文件，而 AV1 不在该 H.264 无损封装路径中，返回 422 原画保护错误。
- 错误在解码器附加源之前发生，不是 CSS 把画面盖住，也不能据此说 AV1 不兼容。

修复前证据：`build/original-startup-Xp5wd8/report.json`，构建 6fc41fc0afd4cd9f。
此前 UI 回归遗漏“有效单音轨记忆 + 非 H.264 原文件”的组合，77 项通过不能证明
这个组合正确。本轮补齐真实原片复现，不回退 UI 或开启有损转换。

## 修复范围

在 Chromium 请求播放地址前，只有“记忆索引非空、恰有一个音轨、索引完全匹配”
才去掉冗余的选轨请求，并允许原片优先。SQLite 中原始记忆保留，MPV 的记忆不变。

不猜测多音轨的默认项；多个音轨仍按真实索引选择。不绕过 skip_direct、解码失败、
显式无损封装、force_transcode、画质或转换权限检查。真实直放失败时依旧允许既有
无损恢复或明确报错，而不会循环强制直放，也不自动降画质。

## 验证

最终构建 b8339fbf4006b74c，真实 Electron：
`build/original-startup-7sptOg/report.json`。

两种状态（audio=null / audio=1）都完成原文件直放、呈现真实解码帧，实际分辨率
3840×2160。分别跳到 15 秒和 35 秒，使用 requestVideoFrameCallback 确认目标附近
画面已经呈现；各状态仅一次播放请求、同一源 URL，没有开启视频或音频转码权限。
源文件前后 SHA-256、大小和修改时间一致，页面错误为空。

这是起播和目标帧正确性验收，不是全程流畅度证明。测试环境起播仍记录了丢帧，
不能据此宣称 4K60 无丢帧或替代物理显示/长期播放验收。

组件/解码 harness 22 项通过（37.6 秒）：新增单音轨起播/重新打开、原文件失败不能
被冗余选轨规范化覆盖、多音轨非默认轨仍真实选择；以及既有播放记忆、进度、退出、
无损准备和转换许可保护。最初新增用例用了没有流索引的通用列表 fixture，未进入
播放即被状态校验拒绝；改用 FFprobe 的真实测试索引后通过，没有放宽产品校验。
Windows asyncio 连接重置日志仍保留，测试无失败。

前端编译、diff 检查通过，归档无修改。未提升版本、未打包或推送。

```powershell
node electron/test/real-original-startup.mjs "<已授权的原片完整路径>" --expect-original
npx playwright test tests/ui/media-playback-memory.spec.ts tests/ui/progress-save.spec.ts tests/ui/shutdown.spec.ts tests/ui/native-quality.spec.ts
```
