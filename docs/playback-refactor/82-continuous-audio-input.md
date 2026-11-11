# 连续音量／静音输入丢步修复

2026-11-08，构建 11e8ad62da862117，版本保持 0.2.19。保留其他尚未提交工作，不打包、不提交、不推送。

## 实际问题

真实 Electron 内嵌播放器音量为 0 时连续两次 ArrowUp 应为 10，旧逻辑每次从旧属性音量计算，实际仅为 5。报告 build/render-playback-intent-MkGCVL/report.json FAIL，退出码 1。

仅保留“命令 ACK 前”的输入目标还不足够：40 ms 间隔的两次 ArrowUp 中，前一条命令已 ACK 而实际状态尚未更新，音量应从 10 增至 20，却为 15。中间方案报告 build/render-playback-intent-Mc0N11/report.json FAIL，退出码 1，不作为最终验收。

## 生产修复

frontend/src/NativePlayerOverlay.tsx 为待确认的音量和静音目标保留最新值与请求序号。连续音量按最新输入目标累加，快捷键与按钮共用静音切换；滑块命令经过同一入口。只有原生状态流真实确认相同属性值才清除目标，命令 ACK 本身不当作属性生效证明。失败仍显示原有错误，只清除对应的最新目标，旧失败不清除新输入。

未伪造 properties.volume、mute、pause、time-pos 或呈现状态；未新增属性轮询、固定 debounce、解码等待、媒体重载或原生进程；只保存各一份最新输入目标，旧状态更新不覆盖尚待确认的目标。未改变缓存、原画质、硬件加速、字幕或默认引擎。

## 验收

| 回归 | 结果 | 退出码 | 证据 |
| --- | --- | --- | --- |
| 生成 H.264 MP4 实际应用完整回归 | PASS | 0 | build/render-playback-intent-DwpFNL/report.json |
| 本机真实 HDR MKV 副本完整回归 | PASS | 0 | build/render-playback-intent-jX2QhP/report.json |
| 前端构建 / Electron 编译 | PASS | 0 | npm run build / npm run build:electron |
| 差异空白校验 | PASS | 0 | git diff --check |

扩展的 electron/test/render-playback-intent.mjs 验证即时双加音量、40 ms 间隔连续加音量、连续降音量与双静音切换的实际原生属性值，同时回归快速播放暂停、按钮切换、暂停跳播、真实时钟恢复、EOF 重播及 EOF 指定位置。测试通过实际应用 DOM/键盘处理器，不作为 OS 输入时延或物理输出测量。

本机 E:/downloads/The World in HDR in 4K (ULTRA HD).mkv 只读复制到隔离 build 目录，原文件 SHA256、mtime 前后一致。真实音轨源与无音轨生成样本均通过。当前 SDR 环境不作为物理 HDR 或外机验收。

本轮不声称减少 seek 解码时间，修复的是连续操作正确性。回滚只需恢复本轮 Overlay 的音量/静音目标、状态确认及两个输入入口，保留前轮播放暂停与 EOF 修复。前端原有 Vite 配置和 chunk 大小 warning 保留为非阻断提示。
