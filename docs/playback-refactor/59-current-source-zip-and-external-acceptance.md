# M5：当前构建源码对应、ZIP 解压验收与外机反馈

## 当前构建的独立源码重建

对构建 `acb9a1e222cdad4e` 的冻结快照 `application-source-review-36pn58o0` 再次独立构建，未复用旧 9aed 构建的编译通过记录：

- `build/application-build-replay-yXyBE0/replay-report.json`：818 个源码成员校验并复制；离线 npm 缓存、禁用依赖安装脚本；前端与 Electron 编译通过，构建标识一致，40 个 Electron JS 模块与当前编译输出相同。
- 同目录 `backend-replay-report.json`：从冻结的后台源码实际运行 PyInstaller 编译，使用既有 Python 工具链与固定 SQLite／FFmpeg／FFprobe 二进制输入。
- `build/backend-executable-verification-pxot_k7x/report.json`（位于该重建目录下）：实际冻结 EXE 启动通过、SQLite 校验通过、无令牌访问被拒绝、带令牌访问和正常退出通过，构建 acb9a1e222cdad4e，退出码 0。

前端重建报告中的 `backendRebuiltFromSnapshot=false` 是执行该前端阶段时的状态；后台随后另行编译，保留两份原始记录，不倒改前序证据。不是干净电脑构建，也没有重编第三方运行库或声称后台 EXE 字节完全可复现。

## 与实际交付 ZIP 对应

新增 `scripts/audit-playback-clock-package.mjs`，实际结果在 `build/m5-clock-source-zip-audit.json`：

- 冻结源码重建后的 **40 个 Electron JS** 与实际 ASAR 内成员逐字节一致，包含 `playbackClock.js`。
- ZIP 内 ASAR 与已验收解包程序的 ASAR 字节一致。
- ZIP 中固定的 **85 个原生运行库／材料成员** SHA256 匹配，不是只核对目录名或版本文本。
- 随包后台元数据为 acb9a1e222cdad4e，应用 GPL 许可证与源文件一致。
- ZIP 仍为 `fa704c7444e122af23eb793768a1e31679826bef0c8a99e585e245f2ed516b72`。

首次审计脚本使用 POSIX 分隔符调用 Windows 版 ASAR API，出现成员未找到。核对实际 ASAR 清单后改为平台路径，再完成逐文件校验；不是程序漏打包，也没有因此改变成品。

## ZIP 真正解压后的 Electron 运行

从已验证 ZIP 解压至独立新目录，启动其中实际 EXE，移除开发工具搜索路径后：

- `build/render-app-controls-EXwPb1/report.json`：计时暂停／最小化／恢复、字幕音轨、状态记忆、切换来源等通过。
- `build/render-app-flow-uQjDHv/report.json`：实际 4K10 画面、跳播、原分辨率 16-bit PNG 截图、全屏等通过。
- 每次退出均确认宿主关闭、文件占用及计时请求释放。

确认临时解压目录位于本项目 build 内、没有重定向成员或用户数据后，已删除该约 715MiB 重复程序副本，避免重新堆积包。原始 ZIP 与验收报告保留；删除记录在 `build/m5-clock-zip-validation-latest.json`。

## 外部物理机与 VMware 分开记录

用户在本次新包复测问题的上下文中反馈：“外机物理机测试正常，vmvare虚拟机和之前一样”。因此记录当前 acb9 新包的外机**手动复测正常**，覆盖本次所询问的播放、跳播、截图、全屏进退与最小化恢复的反馈；没有逐片源、分辨率／位深、持续时长或定量计数，不能扩大为全部格式／硬件的量化验收。

VMware 仍为用户报告失败，根因未确定。早期 VM 诊断曾因目录选错而没有实际加载 DLL，旧 desktop.log 也没有足以定位的新退出码；不能据此确定虚拟显卡不支持、缺运行库或已修复。当前包没有为 VM 放宽色彩／精度门槛、强制软件降级或隐藏错误。VM 失败不倒填为物理机失败，物理机成功也不倒填为 VM 通过。

## 当前状态

限定单屏 SDR 的当前新包已有本机 15 分钟、ZIP 解压运行和外部物理机反馈证据。保留原始显存极差未过旧阈值、VM 失败及非量化反馈的限制。M5 尚未总体完成，第三方对应源码闭包／供应商材料等继续核查；源码补充进展见 60。没有升版、上传、推送或发布。
