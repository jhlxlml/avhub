# M5：外机宿主启动失败与诊断缺口

## 外机事实

用户报告通用 ZIP 验收包中，已准入的 8-bit Framecode-v2-640x360.mp4 和 4K SDR10 均提示“原生渲染宿主已退出”。提供的日志位于 build/native-render-acceptance-Aa7Otl/desktop.log：前后台启动正常，多次 render-player-closed，helperAlive=false、sourceLeaseReleased=true、transport=null。

这次不同于未标定录屏的准入拒绝。宿主已被请求启动，但还没有成功建立纹理传输；不能据此确定缺少 VC 运行库、CPU 指令集或显卡驱动问题。M5 外机原生播放当前判为失败、根因待诊断，不能标记已通过。

## 确定的代码问题及改进

RenderHostClient 原先只统计 stderr 字节、丢弃内容，并把所有宿主退出都显示成同一句；RenderHost 的启动 catch 也只输出异常类型。原日志没有退出码，无法区分进程原生崩溃、加载失败或 D3D 初始化失败。

本轮在应用代码中新增安全终止记录：exitCode、无符号十六进制状态、signal、spawnError、stderr 字节数和受控启动异常类型。普通 Node 启动 errno 不当作 Windows 原生状态码。保留有界 stderr 尾部，但不将任意原文／路径写入应用诊断。记录订阅在 open 前建立，close 事件在管道关闭后记录最终信息，不改变播放、质量或清理保护。

## 无需替换成品的诊断工具

build/render-startup-diagnostics-CTjTpJ.zip，63,393 字节，SHA256 fcf8332bd098106a8c4b137e234ce72025d55b2c7a81ed632818ae52eef1ee82。

工具中的 DiagnosticRenderHost.exe 从原验收候选的固定四份 C# 源码构建，只扩展启动／渲染线程异常输出，源码与 LICENSE 一并提供。它是独立排障宿主，不能冒充打包应用的新版本；不替换验收包中的主程序或 DLL。

Diagnose.cmd 启动系统 PowerShell。选择原包解压目录和已给出的两个精确 SHA 测试样本之一：

- 先核对现有 29 个运行时 DLL 的哈希；不从任意路径下载或安装运行库。
- 实际调用 LoadLibraryEx，记录 Win32 加载错误。
- 运行独立宿主，记录启动异常／退出码、D3D 显示与资源信息；测试只读源，关闭仅限它自己创建的进程。
- 报告保存在工具旁 render-startup-*.json。源样本和包目录在错误输出中替换为占位符；分享前仍须检查个人路径。

本机实际报告 build/render-startup-diagnostics-CTjTpJ/render-startup-20261029-095418-614.json：passed=true，29 个 DLL 匹配、加载成功、宿主正常初始化退出，exitCode=0。该结果**仅为同机独立启动诊断工具验证，不是外机成功、Electron 合成或完整播放验收**。

工具 ZIP 按明确文件清单生成，没有包含本机实际硬件报告、用户视频、数据库或日志。下一步须在失败的新电脑上运行该工具取得异常，再针对证据修复，不能先随意更换运行库或放松原画条件。

## 回归证据

- 终止记录／准入／闭包锁定 Node 测试 9 项通过。
- 真 Electron 原画与截图：build/render-app-flow-jIe6OZ/report.json passed。
- 真 Electron 故障回归：build/render-app-faults-Tqh33L/report.json passed，日志能区分正常退出、SIGTERM 和启动错误；随后细化 Node errno 与 Windows 状态的区分。
- 最终区分修正后的真实 Electron 故障回归：build/render-app-faults-TwdGjv/report.json passed，前后端 build b0acdf85fdfb43f2。
- 没有重新构建／上传完整应用，没有变更运行库版本、视频准入、默认引擎或原视频。
