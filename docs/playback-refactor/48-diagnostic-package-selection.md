# M5：外机诊断选取位置与工具修正

收到 build/native-render-acceptance-Aa7Otl/render-startup-20261029-100417-220.json。系统报告 Windows 10.0.26200、VMware SVGA 3D、驱动 9.17.9.4。29 个包内 DLL 均 matches=false、sha256=null，流程在包文件检查停止，没有 dllLoad、宿主退出码或渲染异常。

该报告只证明工具未在所选位置发现运行库；可能选取了父目录、不同的应用目录或未完整解压。原报告没有保存路径布局，不能据此断定真实启动的验收应用缺少全部 DLL，也不能断定虚拟显卡导致原宿主退出。原外机播放失败仍未解决。

原工具让用户选择文件夹，并把缺失与内容不匹配合并成一句错误，交互与诊断不充分。本轮改为通过 OpenFileDialog 直接选择实际 AVHub.exe；检查它旁边的 resources/native-render，分别记录 applicationExists、nativeDirectoryExists、每个 DLL 是否存在和哈希是否匹配。缺少目录／缺少文件／存在但篡改分开报告。未放松任何哈希或源色彩要求。

新工具 build/render-startup-diagnostics-TzKh0G.zip，63,682 字节，SHA256 6b9c4bd85b8dc24f842b0a3eb0efa50ed4d18b0a0b30ddaba40acea1916996e3。仅包含工具、辅助宿主、固定清单与源码／LICENSE，不包含本机硬件报告或用户数据。

本机两项实际工具验证：

- 错误父目录：build/render-startup-diagnostics-TzKh0G/render-startup-20261029-100722-445.json，明确拒绝未包含 AVHub.exe 的位置，没有继续输出误导性的整组 DLL 不匹配。
- 正确成品目录：build/render-startup-diagnostics-TzKh0G/render-startup-20261029-100723-819.json，布局正确、29 个 DLL 匹配、真实加载与独立宿主初始化退出通过。

这两项是工具的目录与直接启动验证，不是外机或 Electron 合成验收。需要用户在失败电脑选择与 Start-render-acceptance.cmd 同目录的 AVHub.exe，再选 8-bit 测试样本，取得真正进入加载／宿主阶段的诊断。没有修改完整应用包、运行库或源媒体，没有发布。
