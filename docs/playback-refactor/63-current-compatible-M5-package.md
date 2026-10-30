# 当前兼容版 M5 成品验收

当前应用构建 f70c85299841a0f0，版本保持 0.2.16。仅生成本地验收成品；没有推送、发布或调整默认播放引擎。记录 62 的开发态修改已包含在本轮成品中，旧 ZIP 不再代表当前代码。

## 产物与来源

目录：`build/m5-final-sdr-20261029-compatible/`。

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| AVHub-folder-portable-0.2.16-x64.zip | 263892156 | 018e850d66ac5a04aa7132f72b5890589f50a19916e4b52e830c9c38bb6479a6 |
| AVHub-render-acceptance-0.2.16-x64.exe | 169557104 | 15901280087d534bc0f9a2d7268131cc2023992a469a9d8d3ed0590ca504c6a0 |
| AVHub-M5-source-materials-0.2.16-verified.zip | 245796250 | 576dcd432fee71235864878cdb51f0b9dedbe288e4535d9e1d4fa3015617111f |

实际后端来自 `application-build-replay-zbJ7nj`，58 个 Python/入口源文件与交付源码一致，EXE SHA256 2bb7d46950e9e4cf3eaa35d262a32c7f6974390caf067668783f2d0a5f990b66。CLI 由受控的 11 个固定源包构建；libmpv 及原生依赖为已有重建闭包，宿主为当前 `render-replayed-candidate-NuOYHv`。编译工具、材料与验收范围见源码包，不宣称全新系统可离线构建或 Python 二进制逐字节复现。

`M5-BUILD-INPUTS.json` 固定本次实际后端和原生输入，避免使用可变 latest 指针倒推成品来源。`M5-PACKAGE-AUDIT.json` 已核对 40 个 Electron 模块、21 个前端文件、85 个原生文件、5 个受控 CLI 文件及实际 ZIP/ASAR 对应关系。

## 发现并修复的构建问题

第一次严格前端字节审计失败，发现重建时间 `built_at` 进入 Vite 定义，使同源前端产生不同 chunk 名称；没有忽略这个差异。源码快照现在保存完整构建元数据，重建以 `AVHUB_BUILD_TIMESTAMP` 显式重放 ISO UTC 时间，错误时间输入不会覆盖元数据。`application-build-replay-7qvjIz` 已独立重建并与成品逐字节匹配。失败记录不作为通过证据，Python 后端不宣称逐字节重建。

## 已完成的本机验收

- Python 29 项：CLI 载荷、便携 ZIP、播放源与读租约；另 3 项构建指纹/时间冻结/源码快照检查通过。
- Node 15 项：构建配置、运行库路径、验收开关、错误恢复分类通过。
- 文件夹 ZIP 实际解压、旧合成数据库升级、元数据/进度/片单保留、数据目录迁移、3 次启动和退出：`build/folder-release-test-751BNM/startup-timings.json`。
- 实际自解压 EXE 相同流程：`build/portable-release-test-kkOLZo/startup-timings.json`。
- 本机媒体库就绪时间：文件夹版 2005/1131/816 ms，自解压版 11008/10623/10403 ms；不是清空 OS 缓存后的冷启动基准，旧库为合成样本。手动更新 UI 使用明确的测试 GitHub 响应，不作为联网验收。
- 普通启动、缺失启动标记和缺失 DLL 策略：`build/render-packaged-policy-nJcULi/report.json`。
- 真正解压 ZIP 内、移除开发 PATH 的原生控件与退出：`build/render-app-controls-diev51/report.json`。
- 实际 ZIP 4K 10-bit 播放/跳播/截图/全屏：`build/render-app-flow-ZHmeCE/report.json`。
- 实际 ZIP 12-bit 4:4:4：`build/render-unverified-color-Hg4NBP/report.json`。
- 实际 ZIP 自带旋转：`build/render-unverified-color-OBdYTC/report.json`。
- 实际 ZIP 8K 原尺寸/跳播：`build/render-unverified-color-87GKdP/report.json`，生成 FFV1 2 fps 样本，不代表 8K60 吞吐通过。

## 长测与收尾结果

真实解压 ZIP 在无开发 PATH 下完成 900.126 秒连续 4K25 SDR10：解码/输出丢帧增量均为 0，实际合成器帧码推进与墙钟比为 1.0000047。23304 次纹理导入/释放配平，读租约 1/1、时钟请求 2/2，退出后宿主不存活。原始样本哈希/时间不变，自有复制样本在确认释放后清理。

沿用的正增长与暂停收敛标准通过：native private bytes 峰值正增长 1302528 字节，暂停后增长 249856 字节；GPU 正增长 0，句柄峰值正增长 7、暂停后正增长 0。旧 rawRangePassed 仍为 false（句柄活动区间 19、GPU 区间 67174400 字节），没有抹去该结果或改动阈值，不将旧区间指标写为通过。此测试使用 strip 合成器真实帧码采样，不是物理扫描输出或所有片源的长期认证。

新增中文／韩文／表情路径的实际 ZIP 4K10 全流程通过：`build/render-app-flow-mC03uP/report.json`。

## 外机复测与 M5 结论

- 2026-10-29，用户确认本轮 SHA256 前缀 018e850d 包“外机复测正常，普通视频也可以了”。记录为当前成品的物理机手动通过，不补造硬件型号、外机量化长测或物理色彩精度数据。
- 当前仍为明确开启的原生嵌入验收配置。普通发布配置、默认引擎未推广；实体 HDR、混合 DPI、多屏和 VMware 不宣称已认证。
- HDR 原样嵌入与动态分辨率表面重建的功能边界仍见记录 62，不因为 M5 成品可用而宣称所有文件均可播放。

M5 在已约定的 Windows x64／SDR 范围内完成打包、材料及本外机验收，可以收尾。原计划明确默认切换需要单独决定，因此未推广默认引擎不作为本范围 M5 的剩余阻塞；普通稳定发布配置接入仍是下一步。此结论不代表所有片源或 HDR 已通过，不改变保留的 rawRangePassed=false 原始指标。没有推送、升版本或发布。实际即时清单位于成品目录 `M5-ACCEPTANCE.json`。
