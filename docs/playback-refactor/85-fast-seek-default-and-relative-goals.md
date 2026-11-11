# 响应优先偏好与快速连续跳播修复

2026-11-08，版本保持 0.2.19，最终构建 1141316612cd7dc0。不打包、不提交、不推送。

## 用户明确选择

用户针对指定 4K 60fps VP9 MKV 选择“响应快，接受关键帧时间偏差”，随后明确选择“设为 MPV 默认，随时可切精确”。因此只在本项目正在使用的 AVHub-data/library.db 保存全局 mpvSeekPolicy=fast，不修改其他偏好、媒体记录或原始文件。保存前在 build/seek-default-change-1794123424851223600.json 记录原值，写入后读取校验 fast。

这是用户持久化偏好，不修改未配置的新数据目录的工厂回退值；用户显式保存的精确/智能选择继续有效。新打开的视频读取 SQLite，播放页临时选择不覆盖全局默认。运行着旧源码的窗口须重启开发版加载本轮控件修复；其他便携数据目录不受本次本地偏好写入影响。

## 发现并修复的快速模式问题

指定文件在暂停状态由 0 秒快进 5 秒，实际关键帧仍可能为 0 秒。之前完成近似跳播后丢弃请求目标，下一次 +5 又从 0 计算，形成反复请求 5 秒、画面一直不动。真实内嵌复现 build/mpv-seek-paired-zEHKSA/report.json FAIL，退出码 1，不是隐藏加载提示的问题。

frontend/src/playback/renderDesktop.ts、electron/src/mpvClient.ts、electron/src/independentController.ts 现在为同方向相对输入保留尚未追上的请求目标，直到实际播放追上，或用户改方向/绝对定位/模式/视频。输入中的 pending seek 仍优先合并。快速前进目标可从 5、10 秒继续推进，实际画面依然报告 0、5.072 秒及各自误差，不伪造精确落点。反向输入以实际落点为基准；绝对选择清除相对目标。精确模式计算及 GPU 呈现条件不变。

内嵌相对输入在边界验证有限步长 <=120 秒，与既有 MPV Client 限制一致。没有硬编码媒体标题、关闭硬解、改变渲染或增加重新加载。

## 验收证据

| 验收 | 结果 | 退出码 | 证据 |
| --- | --- | --- | --- |
| 内嵌首次连续快速 +5 修复，指定真实 MKV | PASS | 0 | build/mpv-seek-paired-1Etn3y/report.json |
| 两条 MPV 的连续 +5、全部配对、暂停/播放、远跳与模式策略 | PASS | 0 | build/mpv-seek-paired-enp6n0/report.json |
| 全局快速设置、重开/重启、会话临时模式与默认隔离 | PASS | 0 | build/mpv-seek-settings-NJRsaO/report.json |
| Client 真实落点/队列/错误合约及新增连续近似落点、反向输入合约 | PASS | 0 | node electron/test/mpv-client.mjs |
| 前端 / Electron 构建 | PASS | 0 | npm run build / npm run build:electron |
| git diff --check | PASS | 0 | 既有 CRLF 提示非失败 |

真实指定文件是 E:/downloads/[4K 60FPS] Chinese Model #25 _ 중국 모델 #25 _ 中國模特 #25 _ 中国人モデル #25.mkv，只读复制并流式核对 SHA256。内嵌快速中位数/P95 为 45.34/90.84 ms，精确为 397.70/786.70 ms。独立 EXE 快速为 50.07/182.70 ms，其 frameMs=null，不冒充 GPU/物理呈现时间。

连续例子：内嵌第一次请求 5 秒，实际 0 秒，GPU 45.81 ms；第二次请求 10 秒，实际 5.072 秒，GPU 46.58 ms。独立原生 Lua 同样请求 5→10 秒并落在 0→5.072 秒。第一下可能仍为原关键帧是显式快速模式的时间精度取舍，本轮修复的是后续输入反复停在同一请求，而不是声称每下都精确前进 5 秒。

最终补充了模式/新视频清理与非法步长边界，完成最终构建、Client 回归和设置真实应用回归；没有重复扩大未变的解码测试。当前 SDR 会话不作为实体 HDR、多屏或外机验收。

回滚生产修复时仅移除上述三个文件的 relativeGoal/relative_goal 计算与相关清理；本地默认偏好可在播放偏好改回精确，或根据保存的原值恢复单个 SQLite 键。保留其他工作区修改。
