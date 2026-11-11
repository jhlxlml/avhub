# 0.2.20 本地成品验收与发布判定

日期：2026-11-11。上一提交 f3f65dbc321b54541f09be6b1558fb9e4f5eab27。正式版本准备将 package、lock 与后端 fallback 同步到 0.2.20，最终应用构建为 **3b48d95da686b0fd**。

本轮发布条件：当前冻结源码可重建；新运行库对应源码/补丁/材料完整；当前成品真实播放与升级/退出验证通过；最终字节与已测候选绑定；不继承 0.2.19 成品结论。现在满足本机范围的发布条件，按用户授权推送正式标签并采用本地上传，物理 HDR、多屏、外机限制明确保留。

| 检查 | 结果 | 退出码 | 当前证据 |
| --- | --- | --- | --- |
| 官方 npm 安全审计 | PASS | 0 | build/release-security-audit.json；所有级别 0 |
| 源码播放回归 | PASS | 0 | playback-regression-KwKKyE，24 步，含真实 Electron；这是版本准备前后的源码回归，不能替代下面的 0.2.20 成品身份验证 |
| 冻结源码 npm ci/audit/frontend/Electron replay | PASS | 0 | application-build-replay-MtxeMD/replay-report.json；全部 4 命令成功；锁定安装不使用 force/ignore-scripts |
| 当前后端冻结源码重建/成品验证 | PASS | 0 | 同目录 backend-replay-report.json；独立控制 CLI overlay 为 m5-controlled-backend latest 中记录的本轮目录 |
| 当前原生源码 dossier | PASS | 0 | native-replayed-source-materials-dkobmzln；旧 dossier 保留 |
| 当前源码交付 ZIP | PASS | 0 | release-0220-acceptance/AVHub-source-materials-0.2.20.zip；源码、补丁、构建配方与两个清单逐项校验；build/m5-source-delivery.json |
| 新 EXE 独立 MPV | PASS | 0 | native-independent-vMVLiK/acceptance.json；包内 EXE、保存/关闭、截图/控件等 |
| 新 EXE 两模式切换 | PASS | 0 | mpv-window-coexistence-gYhwz8/report.json |
| 新 EXE 内嵌播放 | PASS | 0 | render-app-flow-sWJDgl/report.json；实际帧、截图、回收 |
| schema-2 本轮发布凭据 | PASS | 0 | build/desktop-release-inputs.json；绑定当前应用与上述成品验收 |
| 最终 EXE/ASAR/全部资源与候选比对 | PASS | 0 | build/release-0220-final-proof.json；最终 unpacked 来自正式配置 |
| 实际文件夹 ZIP | PASS | 0 | folder-release-test-lUfAVM；完整解压启动 3 次，合成旧库保留、目录迁移、偏好和退出重开 |
| 实际单文件 EXE | PASS | 0 | portable-release-test-jFWIG0；同样 3 次启动、升级和迁移验收 |
| 全量后端 | PASS | 0 | build/backend-tests/normal.json；800 项，0 failures/errors，2 个创建链接权限测试 SKIP |

## 启动实测和限制

文件夹 ZIP 的 3 次媒体库就绪分别约 1.99/1.07/0.83 秒；单文件 EXE 约 12.10/12.05/11.57 秒，包含约 10 秒自解压。未清 OS 缓存，轮询误差最高 250ms，合成旧库，不声称真实用户库或冷缓存启动基准。推荐使用完整解压的文件夹版。

第一轮普通 sandbox 后端测试停在某项 teardown，记录 release-backend-tests.log，终止的只有本轮已核对命令行的 Python 测试 PID 12324。隔离正确性测试 7 项 PASS/0；带 faulthandler 的完整交互权限重跑在 157.344 秒完成 800 项。中途 40 秒线程栈是定时诊断，并非失败/死锁结论。初次 npm audit 的 sandbox DNS 失败退出 1；正常授权联网重试后审计成功，未绕过检查。

本轮生成的新代码签名未配置，因此是未签名的便携应用。当前真实 HEVC/AV1 HDR/HLG 样本、最终成品物理 HDR/多屏及其他电脑验证仍 SKIP，不构成视频白名单或隐藏错误。此前 20 分钟等长测是前序源码范围，本轮不冒充新成品长测。

## 源码和用户改动

发布源码来自 application-source-review-o5eojike 的冻结工作区快照。应用、后端、MPV 和资源身份均与当前包校验；发布说明补充的最终验收文字属于仓库发布材料，不改变应用二进制。用户修改的根 AGENTS.md 和 AVHub_Codex_Architecture_Optimization_v0.2.17.md 不纳入发布提交，不覆盖或丢弃。

产物在 build/release-0220-final；待提交后生成带最终 commit 的校验清单并核对。正式标签/上传结果仅在实际远程操作完成后记录，不提前视作成功。CI 不实时监控，由用户确认。
