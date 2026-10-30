# M5：通用 ZIP 整合、对应材料及外机验收输入

## 本轮范围

继续 M5 的发行准备，不扩大 D3D11 视频准入，不切换默认引擎，不推送、上传或提高版本。用户提供的新电脑录屏因缺少色彩标记被准入检查拒绝；这项外机观察不能计为 DLL／原生渲染成功，也不能计为真实原生解码失败。

## 1. 通用 ZIP 整合

scripts/folder-portable.py 仍默认拒绝 node_modules、用户数据、媒体、日志和历史归档。只在 resources/native-render/ffi 下允许仓库 ci/render-ffi/runtime-manifest.json 锁定的完整闭包：逐文件核对大小和 SHA，随包清单不能自行授权；目录输入与 ZIP 输入共用检查。

拒绝缺少完整 FFI 的原生包、额外模块、媒体混入、缺失文件、字节篡改、伪造清单。不会全局放开 node_modules。受控原生依赖仍位于 ASAR 外；实际 EXE 的 N-API 加载已有证据，未假设普通 Node ABI 可复用。

新增测试使用真实锁定的 FFI 文件加合成基础包，属于打包安全 harness。含篡改 ZIP 的读取验证，不把这些测试冒充真实 EXE 验收。首次系统临时目录受沙箱权限拒绝；改用项目 build/packaging-test-temp 后执行。

实际通用 create／verify 流程在原本已验收的 b578a8bbb16aa84a 成品上生成 build/native-render-acceptance-Aa7Otl/AVHub-local-M5-zip-validation.zip。解压位置：build/render-m5-standard-zip-g1dm03v4/AVHub-folder-portable-0.2.16-x64。

真实 EXE 报告 build/render-app-flow-ZK67S5/report.json passed：4K HEVC SDR10、合成画面目标帧、16-bit 原尺寸截图、窗口模式和退出资源释放通过。包内文件从新解压目录加载。此项验证新 ZIP 工具处理旧成品资源的正确性，**没有声称已将后续源码提示改动重建到该成品**，不是外机或全新安装系统验证。

## 2. 新运行库的对应材料

发现 stage-native-source-materials.py 只选择旧 selfbuilt 指针，README 还硬编码旧 cohort。加入显式 --replayed 入口，选择新指针并动态写入对应 cohort，保留旧入口和旧材料；不将旧清单重标为新库材料。

实际运行结果：build/native-replayed-source-materials-4xtgeo89/inventory.json，576,564,262 字节，21 个 Git 源码归档与 3 组支持库源码包，cohort replayed-sdr-ee574a3359da。每个文件的大小、SHA 和实际构建报告均核对；新清单同时收录 candidate 的 layout、runtime 与 materials，旧 native-source-materials-latest.json 指针保持原样。

新增独立新 cohort 测试，核对实际归档、构建报告和每个复制文件。材料仍是原生依赖审阅目录，**不是完整应用发行源码包，不认证许可证义务已全部履行或 DSC 签名已验证**。正式发行前仍要对最终应用源代码快照、第三方交付材料和工具链补丁等逐项核查。

## 3. 外机验收输入与说明

生成 build/render-clean-machine-kit-04hhna2d.zip，3,412,709 字节，仅含项目自有测试图、SHA 清单和步骤，无用户媒体。两个样本：

- Framecode-v2-640x360.mp4：BT.709 SDR／8-bit，SHA 4da5a210f5086e11658c04657ebaa653a5934efeb6b6929ca2747684ecbfa2d0。
- Precision-SDR10-3840x2160.mkv：BT.709 SDR／10-bit，SHA e45b97729cb7b5c3ad71d0036a0771d0016f0452e95a71cfa6bd97c9e91e3e0c。

样本已经满足当前视频准入，供新电脑区分源元数据与运行库／渲染问题。当前 externalMachineTested=false；等待真实外机的画面、跳播、截图、窗口及重开结果，不能以这份输入包生成成功计作验收成功。

中英文 README 更新当前本地验收入口，新增 M5-LOCAL-ACCEPTANCE.md，说明限制、排障和手动返回原画路径。没有 README 版本更新栏目或固定当前版本号。

## 测试与当前结论

- Python：27 项通过（ZIP 9、旧源码材料 4、新材料 2、原生源／只读保护 12）。
- Node：相关资源布局、闭包锁定与本地打包入口 18 项通过。
- 实际标准 ZIP 解压后的 Electron：上述 ZK67S5 报告通过。
- 原始媒体不变；未修改 frozen archive 或普通默认引擎。

M5 继续进行，尚未整体放行。主要剩余项为真实外机使用已准入样本验证、最终应用及依赖对应源码／许可证交付审查，以及此前明确保留的资源观察。实体 HDR、多屏仍按用户决定保留待办，不能靠移除保护绕过。
