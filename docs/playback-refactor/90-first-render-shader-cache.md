# 首次绘制等待与原生着色器缓存

2026-11-09。版本仍为 0.2.19；HEAD 仍为 f3f65dbc321b54541f09be6b1558fb9e4f5eab27；不提交、推送或打包。当前产品构建 3980640b19893216，匹配原生 staging `render-replayed-candidate-KhYHON`。保留此前所有用户修改。

## 证据与定位

启动性能工具包装原有 `RenderHostClient.frame` 与 `RenderTextureBridge.present`，只记录第一次实际可用纹理和真实 GPU 完成回执，没有替换帧或伪造完成事件。时间以同一次 main-process 观察起点标注，不把 renderer 与 native 不同时钟直接相减。首次绘制跟踪使用现有 `AVHUB_NATIVE_SEEK_TRACE=1`，开启观察的结果单列，不冒充无观察开销的基准。

- `render-startup-profile-tByz4d`：PASS / 0。温启动首帧 620.58、624.29 ms；首个可用纹理之后的实际桥接/GPU 完成约 9.11、8.64 ms；此前约 170–180 ms 等待发生在原生出帧阶段。
- `render-startup-profile-ZEUxO0`：PASS / 0。原生跟踪确认三次首次 `render` 分别约 162.93、164.25、162.26 ms。因此不能把这段等待简单归因于 Electron 纹理传输或视频解码。
- 实际固定 libmpv 源码的 `video/out/gpu/shader_cache.c` 与 `video/out/d3d11/ra_d3d11.c` 支持以完整 shader/参数生成哈希键，保存并校验 D3D 编译程序。未修改这些库代码或编译参数。
- 隔离缓存试验 `render-startup-profile-0u8m4X`：PASS / 0。第一轮仍发生约 167.93 ms 首次绘制；后两轮首帧约 443.19、419.36 ms，绘制不再出现在 >=20 ms 的跟踪项中。实际生成 64 位十六进制命名的编译缓存文件。首轮新运行库首次校验受路径/缓存状态影响，不作为冷启动优化对照。

## 实际接入

- `MpvCore.cs` 接受 trusted-main-only 的可选着色器缓存目录，设置原生 `gpu-shader-cache-dir`；`RenderHost.cs` 与 `RenderHostClient.ts` 仅传递这一私有字段。公开 renderer open 不接受任意目录；RenderPlayer 根据自有数据目录生成路径。
- `nativeShaderCache.ts` 管理 `<应用数据目录>/native-shaders-v1`。这不是视频副本、索引重建或转码缓存；保存的是编译后的渲染程序。源画面、分辨率、位深、色彩和硬解选项均未修改。
- 只接管自行创建且带准确 owner/schema 标记的目录。未知文件、目录联接、符号链接或异常目录不遍历、不清除；缓存准备异常在主进程记录并退回原先无指定缓存目录的播放路径。
- 只在宿主打开前和完全退出后维护缓存，避免删除活动读者使用的文件。闲置维护阈值 64 MiB / 512 项，超限清到 48 MiB / 384 项；单文件超过 4 MiB 可回收；可用空间不足 256 MiB 则不启用缓存。它是闲置清理上限，不是对第三方 DLL 每次写入强加实时文件系统配额。
- 缓存的源失效由 libmpv 对实际生成程序、参数哈希和编译程序头的验证处理，不缓存视频帧，不以媒体标题作为着色器键。
- `render-startup-profile.mjs` 保留明确的隔离试验开关，正式验收不使用试验注入目录、不打开 verbose trace。缓存错误不掩盖视频解码或呈现错误。

## 正式路径实测

`render-startup-profile-lNqrKP`：PASS / 0，12 次实际打开、14 次关闭（含取消/重开）均释放宿主、文件读租约、时钟及 GPU/NT 租约。相同只读指定 4K VP9 MKV，使用正式的自有缓存路径，未注入试验缓存选项。

| 范围 | 无指定自有缓存 | 正式自有缓存 |
| --- | --- | --- |
| 暖首帧中位数 | 前轮 `lCoayM` 的 11 轮：626.77 ms | `lNqrKP` 的 11 轮：419.71 ms |
| 本轮暖首帧范围 | `tByz4d` 两轮：620.58–624.29 ms | `lNqrKP` 十一轮：414.71–457.25 ms |

改善针对相同/可复用 shader 程序的重复打开，约减少 0.2 秒。OS 缓存和驱动状态未控制，不保证所有机器或每个首次打开都如此。新 shader、不同色彩/程序组合第一次仍需编译；保留真实加载提示与 GPU 回执。

## 回归和安全边界

| 验收 | 结果 / 退出码 | 证据 |
| --- | --- | --- |
| 宿主、前端、Electron 编译及匹配 staging | PASS / 0 | 本轮构建命令 |
| 缓存所有权、未知对象、容量/数量回收、目录联接保护 | PASS / 0，5 项 | `node --test electron/test/native-shader-cache.test.mjs` |
| 完整统一桌面回归 | PASS / 0，13 步 | `playback-regression-CWgT9Q/report.json` |
| 三引擎六轮切换、截图、最小化恢复、关闭 | PASS / 0 | `playback-path-cycle-iu46r1/report.json` |
| 双 MPV 三格式、模式、连续/暂停/远跳矩阵 | PASS / 0 | `mpv-seek-paired-NFc9tg/report.json` |
| 实际 4K 10-bit 像素定位、截图、全屏/纯净播放、缓存重开 | PASS / 0 | `render-app-flow-izue9v/report.json` |
| 未标记目录的真实播放回退与原文件保留 | PASS / 0 | `render-startup-profile-77rdhV/report.json` |

像素测试中，缓存命中后重新打开实际定位到帧码 31；PNG 为 3840×2160、16-bit，源样本身份不变。未标记缓存目录中的 keep.txt 内容及目录清单保持不变，同时真实视频能够播放、关闭、重开。

单元测试第一次在沙箱中创建自有 build 目录联接被 EPERM 拒绝（4 PASS / 1 FAIL，退出 1）；未删除或修改目标原文件。使用获准的桌面权限重跑五项全部通过。没有把被权限拦截的测试记为通过。缓存用例已纳入统一入口与 Windows CI 配置；没有推送、运行或监控远程 CI。

本轮 HDR 缓存重开持续播放 `hdr-real-media-QoPJUY/report.json`：PASS / 0。真实 VP9/PQ 片源在同一应用先生成缓存、关闭再打开（cacheWarmReopen=true），按现有用例移动窗口至当前显示器并采集 compositor 图像，随后测量 120.018 秒，含一次定时精确跳播。呈现序号推进 7,158；sourceLoads=1；最终及采样窗口观察到的解码/输出丢帧最大值均为 0。原视频 SHA256 与 mtime 前后一致。

两次真实关闭日志都为 helperAlive=false、sourceLeaseReleased=true；第二次 clock 请求/释放 3/3、导入/释放/GPU 完成 7202/7202/7202、NT 租约打开/关闭 1/1。没有用后续 seek 重置的最终计数掩盖中途丢帧，也没有跳过实际 GPU 完成回执。

物理 HDR 色彩准确性、外机、其他厂商显卡与冷盘表现没有因此自动获得认证，也不作为普通视频播放限制。独立 MPV 与 Chromium 路径本轮保持行为，三引擎组合已回归；约 0.2 秒收益仅指本机内嵌 MPV 重复打开场景。

回滚可只去掉 RenderPlayer 的缓存准备/传参及关闭维护调用，恢复原先每次编译路径；用户编译缓存可留在自有目录，不能无条件递归删除。若撤销 C# 可选字段，须重新编译匹配宿主及 staging，不得绕过 manifest/source hash 检查。
