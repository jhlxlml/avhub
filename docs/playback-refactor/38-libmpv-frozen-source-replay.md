# M5：从冻结材料实际重建 libmpv

2026-10-28。继续报告 37。版本仍为 0.2.16，普通播放路径与已验收候选保持不变。未打包、发布、修改原视频或推送远程仓库。

## 实际执行的范围

本轮重新生成 `build/native-source-materials-2a3ts22f`，其中包括带重放入口的实际构建配方、固定源码提案和 MPV 源码归档。执行前核对材料清单中的文件身份，并要求正在执行的配方与冻结副本逐字节一致。

执行：

```powershell
wsl -e python3 /mnt/d/AI/codex/avhub/scripts/build-libmpv-windows-harness.py --source-materials /mnt/d/AI/codex/avhub/build/native-source-materials-2a3ts22f
```

配置、编译、安装均真实完成；输出只在新目录 `build/libmpv-source-replay-68npnz9m`。原 `libmpv-windows-cross-latest.json` 仍指向 `libmpv-windows-cross-06dva4ei`，新重放使用单独的 `libmpv-source-replay-latest.json`，没有重新指定应用运行库。

此处独立的是 libmpv 的源码展开、配置及产物前缀。**复用了原先已验证的 FFmpeg、libplacebo、字幕等依赖前缀和现有工具链**，不是所有 21 个组件的干净机器全链重建。DLL 同伴依赖的 28 个哈希均与已验收候选一致。

## 新产物及 Windows 检查

新 DLL：3,603,290 字节，SHA256 `f009aab1209695a6e197112355f92d99d1f4ffaf665e834f8ab710b4e7c03268`。

| 检查 | 实际结果 | 重放目录中的证据 |
| --- | --- | --- |
| 独立配置、编译、安装 | 通过 | report.json、configure.log、build.log、install.log |
| 上游核心单元测试 | 10 项通过 | windows-tests.json、windows-unit-*.log |
| 实际 DLL API／解码状态 | H.264、4K HEVC、4K SDR 10-bit、4K AV1 共 4 组通过 | windows-tests.json |
| H.264 硬件解码 | 实际观察到 d3d11va-copy | windows-tests.json |
| 静态 DLL 导入闭包 | 29 个 DLL 核对，21 个外部系统导入从 System32 解析 | import-audit.json |
| 完整重放摘要 | 通过上述检查，发行门禁仍关闭 | replay-result.json |

DLL API 检查使用 null VO，验证的是加载、解码信息、控制状态和样本身份，**不是 Electron 可见帧、播放流畅度或截图画质验收**。没有把报告 36 的 Electron 结果转移到这个新哈希。

验证工具新增 `--build-dir` 入口，只接受本项目 build 下命名匹配的构建目录；不改写当前候选指针。

## 与已验收 DLL 的差异

已验收自建候选 SHA256 仍为 `2cf60d001765b91cf3f40a7ef115da010385ecc46442d609d8a75d3db3defa88`。两个 DLL 大小相同，但原始文件有 91 个字节不同。

PE 比较表明代码段 .text 一致。仅在**内存诊断副本**中忽略 COFF 时间戳、PE 校验和、导出目录时间戳，并将 4 处新构建目录字符串替换为旧字符串后，其余所有字节一致，详见 pe-comparison.json。

没有改写任何 DLL，也没有以归一化比较结果替代完整哈希校验。它说明本轮观察到的差异范围，不能当作字节级可复现、全部语义等价或新产物 Electron 放行证明。

## 回归结果

相关 Python 回归共 30 项，通过 29 项、跳过 1 项（现有目录链接测试的环境限制）。新增覆盖：冻结配方不一致拒绝、源码改变拒绝、目录／审批状态边界、实际构建与测试证据对应、原候选指针保留、28 个依赖身份核对。

原有源码材料目录保持冻结；该目录历史 inventory 中的“未重建”字段没有改写，本报告与重放目录记录后续的 libmpv 单层结果。

## 后续门禁

M5 尚未全部完成。接下来优先重放渲染与媒体关键依赖，补足当前复用前缀的验证边界；发行前仍需完整应用源码 revision／依赖材料审核，以及经用户授权的成品和干净机器验收。原始资源波动观察、已延期的实体 HDR 和多屏测试继续保留。

新 DLL 不在应用准入哈希中，普通启动和已验收候选均不变。`distributionReady`、`productionDistributionReady` 继续为 false。
