# M5：物理机通过记录与应用源码审阅快照

## 物理机证据

用户明确本次使用物理机，提供 build/render-startup-diagnostics-TzKh0G/render-startup-20261029-101430-991.json。

该报告 passed=true；Windows 10.0.26300，Intel Arc 130T GPU，框架 Release=534296。29 个原生 DLL 的实际哈希与当前 replayed pin 完全相符，LoadLibraryEx 成功，宿主 open 成功，D3D／资源查询正常，exitCode=0、stderr 为空。设备列表还列出远程显示相关驱动，但不能仅据驱动存在判断其正在参与输出或造成故障。

诊断工具传入 windowHandle=0，因此 selectedMonitor=null 是这项独立工具的测试方式，不是对完整应用显示器匹配的失败判断。没有把工具初始化通过误当作 Electron 共享纹理合成通过。

随后向用户询问：同一物理机用 Start-render-acceptance.cmd 启动完整应用，8-bit 样本是否能播放。用户明确回复“完整应用已能播放”。这项记录为**外部物理机、完整应用、8-bit 样本手动验收通过**，不是自动逐帧或主观色准认证。核对摘要保存在 build/physical-render-startup-evidence.json。

此前 VMware 相关诊断环境与未找到包文件的记录继续保留，不混入本次物理机通过结论，不声称已定位或修复此前虚拟机的失败根因。外部 4K 10-bit、截图、全屏进退、长时间播放和完全未配置开发环境的声明仍需各自证据。

## 应用源码审阅材料

scripts/stage-application-source.py 新增工作区源码审阅快照。通过 Git 的跟踪／非忽略源码清单加明确的源码与资产范围选取，收录 React／Electron／FastAPI、原生宿主源码、构建脚本、配置、测试、锁文件、许可证和必要的 FFmpeg／SQLite 构建声明。包括未提交源码修改，不从 HEAD 恢复工作区已删除文件，不修改 Git 状态。

明确排除历史网页版、生成二进制和 app/static、node_modules、媒体、数据库、缓存、日志、根目录用户规划文档等。文件逐项核对大小／SHA，未上传或发布。

当前快照：build/application-source-review-qapu5tfu/source-review-inventory.json，801 文件、5,809,875 字节。它与 build/native-replayed-source-materials-4xtgeo89 原生依赖源码材料互补。

它是当前工作区的**审阅快照**，不是最终授权发布提交的对应源码交付认证。最终发行仍需复核应用与依赖交付内容、构建配方及其许可证材料，并重新绑定真正发布的构建；不能把本快照直接称为此前 b578 成品的完整对应源码。

首次快照 lby2y6fy 的测试错误地假定存在 frontend/src/App.tsx，实际入口为 frontend/src/main.tsx；修正断言并补齐 bin 下构建／许可证声明后生成新快照。旧快照保留，不将失败改写为成功。

应用快照与新原生源码材料测试共 4 项通过；应用完整性和隐私范围分别检查。没有修改播放逻辑、放宽准入或重打包应用。

## 当前 M5 状态

同机成品、ZIP 搬迁、外部物理机的基础原生启动与用户确认的 8-bit 完整应用播放均已有证据。源码与发行材料的审阅范围得到补齐；M5 尚未整体放行。后续继续核对发行材料、外部 4K 10-bit 与完整交互／长时结果，不以单样本成功概括全部能力。
