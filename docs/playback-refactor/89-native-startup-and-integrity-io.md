# 原生启动细分与完整校验 I/O

2026-11-08，版本仍为 0.2.19，HEAD 仍为 f3f65dbc321b54541f09be6b1558fb9e4f5eab27。本轮保留所有其他未提交修改；不打包、不提交、不推送。最终产品构建 25f7a964f21a609a，原生开发 staging 为 `render-replayed-candidate-RmUZbu`。

## 本轮修改

- `MpvCore.cs` 记录 DLL 哈希、加载、API/选项设置、MPV 初始化及属性订阅的实测耗时。
- `RenderHost.cs` 记录 core、D3D 设备/表面准备、Render API 上下文和 loadfile 命令耗时，在原有 open 回复中附加数字计时；不改变渲染、解码、参数或就绪判定。
- `RenderHostClient.ts` 在所属 IPC 边界验证可选计时字段，未完成阶段为 null，不写假零值。旧宿主缺少可选字段仍可兼容。主进程的 verification/hostOpen 计时与宿主内部阶段不属于同一时钟原点，不应相减冒充实际屏幕呈现时间。
- 28 个固定依赖仍全部计算实际 SHA256；先核对完整文件名/固定哈希清单，再按每批最多 4 个文件读取。每批 `allSettled` 后再传播失败，没有未结束读者留到校验返回之后。主 DLL、宿主、源码、清单、文件身份检查原样保留；无缓存跳过、无忽略错误、无关闭 hash/sandbox。
- `render-startup-profile.mjs` 支持 `AVHUB_STARTUP_ITERATIONS=3..30`，采集每次真实打开及关闭后的进程资源；逐次核查宿主退出、读租约、GPU 导入/释放和时钟租约是否平衡。
- 新增 `scripts/benchmark-render-verification.mjs`，对实际运行库做八次验证，并在自有隔离副本测试依赖、宿主篡改及非法路径拒绝。不是 mock 校验，也不是操作系统冷缓存测试。

## 发现的实际等待

`render-startup-profile-QDggu9` 和 `INXdth` 均为真实 Electron、只读指定 4K VP9 MKV。原生候选分别 TTAARd / RmUZbu，仅为定位继续细分计时而重编译，DLL 固定 SHA 未改。

`INXdth` 12 次打开/关闭：PASS / 0；14 次关闭记录（包含取消和重开）都符合 helperAlive=false、sourceLeaseReleased=true、时钟与 GPU/NT 租约平衡。每次关闭后仅一个主窗口。原生句柄首轮 875，随后 869 左右，末轮 870；原生私有内存约 543–547 MB 波动，不是持续爬升证明，也不是长时间无泄漏证明。

暖路径观察：

| 阶段 | 大致耗时 |
| --- | --- |
| 宿主内部 DLL hash | 3.9–5.0 ms |
| DLL LoadLibrary | 2.3–4.1 ms |
| MPV initialize | 1.4–1.8 ms |
| core 全部准备 | 15–17 ms |
| D3D 设备及初始表面准备 | 134–143 ms |
| libmpv Render API 上下文 | 81–88 ms |
| loadfile 命令返回 | 约 2 ms，**不等于解码/呈现完成** |

重复打开首帧约 624–647 ms。新复制运行库第一次打开达到约 2.09 秒，主进程完整验证占约 1.36 秒；不能归咎于视频解码，也不能以之后热缓存数据伪装为冷启动修复。

本轮读取了实际固定 libmpv 对应源码，确认 Render API 上下文包含 GPU 与硬解互操作初始化。没有为缩短时间把 `gpu-hwdec-interop` 强制为某个设备、禁用其他硬解、删除校验或引入后台常驻解码器。D3D 准备的具体驱动内部成本尚未细分，不能断言是 MPV 核心本身慢。

## 校验对照与安全负向验收

| 实现 | 八次实际验证 ms | 中位数 |
| --- | --- | --- |
| 串行 `render-verification-MqdPj9` | 70.09 / 63.54 / 62.21 / 68.80 / 63.59 / 62.65 / 60.53 / 62.10 | 63.09 ms |
| 每批 4 文件 `render-verification-6Ub8HJ` | 61.18 / 53.57 / 51.50 / 51.99 / 52.29 / 53.03 / 52.81 / 54.43 | 52.92 ms |

两个命令均 PASS / 0，均确认依赖篡改、非法依赖名、宿主篡改被拒绝。仅本机热缓存校验阶段约节省 10 ms；不声称整体打开按同样比例提升，不声称解决新路径首次 1.36 秒波动或 HDD 性能。报告包含实际验证实现 SHA256。

## 构建与回归

- 宿主编译、本地 staging、前端和 Electron 编译：PASS / 0；staging 不是新 EXE/ZIP 发布包。
- source-contract + command-bridge：13 项 PASS / 0。
- runtime-attestation + command-bridge：7 项 PASS / 0。
- 最终统一桌面入口 `playback-regression-zyuHlD/report.json`：PASS / 0，12 步均通过、无 skipped/unrun。组合报告 `playback-path-cycle-WZwfHe`、双 MPV 矩阵 `mpv-seek-paired-ZSCGMV`；均为最终实现和新宿主，不借用旧成品结果。
- 并行校验后 12 次真实 4K 文件打开/关闭 `render-startup-profile-lCoayM/report.json`：PASS / 0，14 次关闭（含取消、重开）均释放宿主、文件、时钟和 GPU 租约。原生句柄采样均约 869，私有内存约 545–548 MB；关闭后的 Electron 各进程私有内存合计在采样点有升降，没有凭短循环宣称长期无泄漏。

最终同样本重复对照（各自第一轮单列，后 11 轮为 warm）：

| 报告 | 首次首帧 | 后 11 轮首帧中位数 / 范围 | 后 11 轮完整验证中位数 |
| --- | --- | --- | --- |
| 串行 `INXdth` | 2094.7 ms | 638.05 / 623.55–646.66 ms | 65.80 ms |
| 每批 4 文件 `lCoayM` | 744.8 ms | 626.77 / 602.86–637.42 ms | 57.69 ms |

本机暖首帧约减少 11 ms，幅度很小。第一轮运行库新路径/缓存条件没有控制，**不得把 2095→745 ms 当作冷启动优化幅度**。没有外机、机械硬盘对照或最终打包验收。本轮也没有以此前 180 秒 HDR 结果替代新宿主的长时间 HDR/色彩验收；HDR 允许播放，未验证不作为准入限制。

回滚本轮 I/O 优化可仅恢复依赖逐个哈希循环；计时字段与重复打开工具可保留。若撤销 C# 计时字段，必须重新编译并 stage 匹配宿主，不能用旧宿主清单绕过校验。其余画质与播放功能不变。
