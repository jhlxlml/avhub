# M5：冻结后台源码重建与独立 FFmpeg 源码材料

## 后台实际重建

在 `build/application-build-replay-d3KDr8` 中，使用此前冻结的 809 个应用源码文件，实际运行 PyInstaller 重建后台。使用既有 Python 工具链和已固定的 SQLite、FFmpeg、FFprobe 二进制输入；不是干净系统构建，也没有重编这些第三方二进制。

- 冻结源码：`build/application-source-review-4by_uumb/source-review-inventory.json`。
- 编译日志：`build/application-build-replay-d3KDr8/build/backend-replay-build.log`。
- 综合证据：`build/backend-source-replay-evidence.json`。
- 实际可执行文件复核：`build/application-build-replay-d3KDr8/build/backend-executable-verification-5no436vy/report.json`。
- 构建标识：`9aed889e7ca3ca73`；SQLite 3.54.1 验证成功；带令牌请求成功，无令牌请求被拒绝；正常关闭后退出码为 0。
- EXE SHA256：`03c3565948bdbbb9c21aab233f087dc0e977fb1182db50a80c0a5a182ecb54f5`。

首次验证没有携带鉴权令牌，随后一次误把仅随包交付的 notice 文件当作 HTTP JSON 路由。这两次测试脚本失败记录保留；前者不代表编译失败，后者不代表后台新增了错误路由。应用只挂载 `/assets`，其他前端路径返回 SPA。修正验证脚本后，分别核对实际 HTTP 首页与随包 notice 文件，通过验证，没有修改应用鉴权或添加例外路由。

新增 `replay-backend-build.py` 和 `backend_replay_verification.py` 允许后续重建、验证分别留存证据。`test_backend_source_replay.py` 校验实际 EXE、健康信息、源码成员哈希与历史失败记录；没有对应本地材料时明确跳过。

## 独立 FFmpeg CLI

现有 `ffmpeg.exe` / `ffprobe.exe` 是 Gyan 9.0.2 构建。它们的 FFmpeg 源码提交是 `946fcce07b6dcd0331c8cc609192aeff5e1924f8`，与原生 libmpv 依赖闭包里的 FFmpeg 提交不同，不能共用一份源码归档冒充对应材料。

- 固定来源：`ci/ffmpeg-cli-source.json`。
- 采集脚本：`scripts/capture-ffmpeg-cli-source.py`。
- 实际材料：`build/ffmpeg-cli-source-review-l8diqnc1/report.json`。
- 已从官方 Git 仓库取得该提交的源码归档，核对 RELEASE、许可证文件与归档哈希。
- 源码 TAR SHA256：`61b00f08ae2391291d664e1b9d3cd6d813d5ed4ff8ddf268891734d1b1079b72`。
- 构建信息列出的 37 项外部库仍逐项标记为未核齐准确源码；没有声称已复现 Gyan 二进制、验签或完成整个静态依赖闭包。

上述两组新增材料审计测试共 4 项通过。本轮保留版本号与原有播放路径，不替换运行库、不修改原视频、不发布。

## 当前边界

应用源码重建已有前端、Electron JS 与后台的实际证据，仍需最终发布提交的对应快照。第三方源码材料以及外部电脑的完整交互、长时记录继续分别核查，不能将材料采集等同于再分发审查完成。15 分钟成品长测与成品交互复核的最终结果另行记录。
