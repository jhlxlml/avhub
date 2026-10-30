# M5：CLI 对应源码缺口与隔离候选

## 为什么不继续仅补供应商版本清单

核对现有 Gyan `FFmpeg-BUILD-INFO.txt` 的 External libraries、37 项版本表，以及实际 `ffmpeg -buildconf` 后，确认版本表并没有完整覆盖静态依赖。GnuTLS、GMP、libxml2、iconv、fontconfig、bzlib、lzma、zlib 等基础项也需要相应的源码身份与配方。上轮 20 项上游归档不等于完整对应源码；不能推测缺失版本或把供应商补丁、二进制重现标为通过。

## 当前采取的方式

在用户允许按需替换现有库、保留功能和原画要求的前提下，先构建独立的可追溯 CLI 候选。`bin/` 未替换；旧验收 ZIP、源码重建和外机物理机反馈仍对应原包，不将它们当作候选 CLI 的验收。

- 输入清单：`ci/controlled-ffmpeg.json`，固定 FFmpeg 9.0.2 核心与每个候选依赖的提交、归档哈希、许可证来源。
- 构建工具：`scripts/prepare-controlled-cli-tools.py` 只下载并解包固定 Ubuntu 工具到项目私有目录，不执行安装脚本、不安装系统软件；记录原始包与私有脚本路径重定位。
- 配方：`scripts/build-controlled-ffmpeg.py`，独立 Windows x64 静态候选。保留 FFmpeg 内建格式／解码器，加入 x264、dav1d、zimg、zlib-ng、bzip2、liblzma；zimg 的实际 GraphEngine 子模块已单独按固定提交捕获。没有把未启用的测试子模块当作运行库依赖。
- 既有归档有 Windows 文本换行时，只对隔离构建树中的 UTF-8 文本转为 LF，并记录数量；原始归档和哈希不变。

当前构建目录为 `build/controlled-ffmpeg-b464na_v`。最终追加了已有验收需要的 x265 8/10/12-bit、VPX 与 Opus，共 11 份固定源码输入。首次配置遇到私有工具入口、Autotools 资源路径与辅助文件缺失，均已在项目私有目录补齐。x265 生成的 pkg-config 记录原本指向默认共享异常运行库，已在静态配方中明确选择 gcc_eh；没有用允许重复符号等选项掩盖链接错误。

增量配方曾在重新配置后错误复用下游 make/install 成功记录。已修复为任一上游阶段变化后重跑下游，并实际重新编译、链接、安装最终配置；未接受旧 EXE 为最终结果。保留 `report-profile-8.json` 区分初版与最终版。

## 已完成的候选验证

- `build/controlled-cli-validation-ufuq5s3i/report.json`：最终实际 EXE 的必需编码器检查通过。16 组 MP4/MKV/TS/MOV/AVI/WMV/FLV/WebM/ProRes 与既有 4K HEVC、SDR10、AV1 样本，原生 YUV 帧字节、探测元数据一致；原尺寸 16-bit PNG 解码后的 RGB48 字节也与原参考一致。
- 多音轨／字幕无损封装的编码包与 ASS→WebVTT 内容一致；源样本哈希和修改时间不变。
- 短 TS 的初次输入 seek 比较，两侧都没有输出有效帧。没有记为一致通过；改用从头解码后的输出定点取帧，并校验准确三帧字节数。这是解码一致性验证，不宣称随机跳播性能提升。
- `build/controlled-cli-source-cache/report.json`：11 份输入均用 Linux Git 独立重现归档哈希，未用最新 HEAD 替代固定提交。大型跨盘归档的首次 90 秒截止过短，调整为有界 600 秒后完成。
- 3 项真实材料完整性／拒绝篡改测试，11 项文件夹打包测试，11 项 Node 打包策略和计时回归通过。打包测试首次因沙箱临时目录写入被拒绝而失败；使用项目内隔离临时目录重跑后通过，没有改应用绕过。

## 应用范围与当前阻碍

受控 CLI 只加入独立 M5 后台与验收包；默认 `bin/`、普通后台和普通 CI／发行配置保留原样。此举不改变默认引擎，也不宣称已经解决普通 Gyan 发行路径的完整源码材料问题。正式发布流程仍需独立接入审查完成的材料；本轮不自动发布或推送。

已生成 `build/m5-final-sdr-20261029` 的 EXE 和 ZIP。实际后台 EXE 的健康信息、SQLite、鉴权、CLI 哈希和正常退出已通过。新包首轮真实 Electron 控制验收被显示环境拦截：`build/m5-current-display-probe.json` 返回 QueryDisplayConfig 5、无显示输出，当前测试进程在 Session 2，状态 Disc。没有跳过 SDR 准入；等待重新连接交互桌面后再做画面及长时验收。

## 替换前的门槛

编译成功不足以替换。需检查实际 Windows EXE 的导入闭包、版本与功能，使用独立编码的测试样本和真实只读视频，对比解码帧、色彩／位深元数据、无损封装的编码包、截图及字幕转换。还需通过使用该候选的后台和 Electron 打包回归，明确区分测试样本编码工具与应用运行库。

候选不承诺复制 Gyan 的通用命令行全部外部功能；评估边界是本应用实际使用的功能。任何影响现有应用格式、原画封装、字幕、截图或明确确认的兼容播放的缺口，均需补齐后才能采用。已完成本地候选打包，未发布；M5 尚未完成。
