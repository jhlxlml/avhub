# M5：分发清单与真实依赖审计

2026-10-27。M5 已开始，本批仅离线审计与工具实现；没有生成应用安装包、修改版本、推送或发布，没有修改已通过 M4 的播放器产品代码及运行库。

## 已核对

新增 `scripts/audit-render-distribution.mjs`，区分运行库完整性与发布准备状态。流式校验实际宿主、四份对应 C# 源码、固定开发运行库六个文件、补充 D3D11 头文件及固定 Koffi 清单中的全部文件。校验不启动播放器、不下载、不复制组件，不会把一个 readiness 布尔值当成干净机器验收。

运行 `node scripts/audit-render-distribution.mjs`：本机文件校验通过，发布准备不通过。原始报告 `build/render-distribution-audit.json`；当前应用 build `9bfe12f3fda7d68e`，宿主 SHA-256 `1b204ba8ec38e5f3df485d583f586ed3e6e8e0aa783a255784e0c53a63f0776a`，DLL SHA-256 `ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74`。

`node scripts/audit-render-distribution.mjs --release` 按预期返回失败，报告 `build/render-distribution-release-check.json`。这表示 M5 门槛尚未满足，不是播放器解码回归。

`node --test electron/test/render-distribution-audit.test.mjs`：4 项通过，覆盖文件被改、宿主编译后源码被改、完整开发文件仍未获分发许可、单独修改 readiness/资源映射不能凭空获得成品验收。这些是合成清单契约测试，不是原生加载或干净机器证据。

## 发现的实际缺口

| 项目 | 当前事实 | 后续处理 |
| --- | --- | --- |
| libmpv 加载依赖 | 固定 DLL 的 PE 导入表含 `vulkan-1.dll`，不是 delay import；上游六文件开发包不含该文件 | 从可核验来源准备可分发 loader、许可、哈希和依赖材料，再在无开发环境机器验证；不能复制本机系统 DLL 冒充分发方案 |
| 宿主环境 | x64 PE 含 CLR 头，使用 .NET Framework WinForms | 明确最低系统及 Framework 要求，做干净环境启动；本机成功不能替代 |
| FFI | Koffi 3.3.4 x64，delay import 为 NODE.EXE；当前 Electron 实际加载已在 M3/M4 通过 | 保留精确 N-API 二进制与 MIT 许可，移动目录后重验 Electron；不能以普通 Node 测试替代 |
| 路径 | `renderPlayer.ts` 读取 build/native-render 和 build/libmpv-d3d11-input；`renderTexture.ts` 读取测试 FFI 目录 | 将受控运行库清单与 resources/native-render 对齐，并保留开发路径隔离 |
| 构建清单 | package.json extraResources 只有 backend、icons | 后续显式增加经过准备的原生资源；不把 build 整体打入包 |
| 完整性模型 | 宿主校验仍要求工作区四份 C# 源码存在 | 分发清单须同时绑定宿主、DLL、FFI 与构建来源；不能简单删除校验 |
| 许可材料 | 固定候选 distributionReady=false；GPL/版权文本已有，但对应依赖与源码构建材料未完成 | 整理本 DLL 精确构建所用材料；不能套用旧 mpv.exe 或另一候选的组件清单 |
| 成品门槛 | 打包态仍拒绝新引擎，无绑定本候选的成品/干净机器验收 | 保留拒绝逻辑，待真实产物通过后再考虑启用 |

PE 静态报告 `build/render-distribution-imports.json` 使用本机已安装 pefile 读取实际三个二进制的 Machine、普通导入、延迟导入及 CLR 头。三者为 x64。libmpv 的普通导入含 Vulkan loader；Koffi 普通导入为 KERNEL32/ADVAPI32。该静态结果不是完整传递依赖、动态加载或签名信任审计。

本机 `C:\Windows\System32\vulkan-1.dll` 存在，文件版本 1.4.341.0、长度 1,730,096 字节，仅记录环境事实，不复制或将其视为批准的包内运行库。选择 D3D11 不会改变二进制的静态导入表。

## 实施顺序

1. 优先补齐固定 DLL 的可分发 Vulkan loader 与依赖/来源材料，保留已经过 M4 验证的 libmpv 主体，避免为移除依赖而立即换库造成无必要的播放回归。
2. 完成独立原生运行库清单与资源目录加载，校验布局迁移和缺失文件处理；保持默认引擎、SDR 范围与画质约束。
3. 整理精确构建的许可和对应源码材料，再接入受控打包入口。
4. 在用户要求打包后生成实际产物，验证无开发环境启动、播放、切回、缺失组件、关闭与升级；通过前不标记 M5 完成或打开生产开关。

现有播放器路径继续可用。回滚本批仅涉及新审计脚本、其测试与阶段记录，无需回滚产品或运行库。
