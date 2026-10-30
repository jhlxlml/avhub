# M2：所有权修复与 D3D11 Render API 候选

2026-10-26。当前仍是独立 PoC；没有把新宿主接入生产播放器，也没有进入 M3–M5。
本报告承接 02–14 的历史证据，旧 FAIL 和不完整记录不改写为 PASS。

## 放行状态

**本轮软件侧阻断已修复，SDR 核心嵌入可行性通过真实测试；完整 M2 矩阵暂不放行。**
用户已确认“目前只有 SDR 单屏，保留实体显示验证待办”。实体 HDR、混合 DPI/多屏
不再反复索取，也不记为通过。125% 历史环境与本轮报告的 SDR 100% 环境分开记录，
不把 Electron compositor 捕获等同实体显示器扫描输出或精确色度验收。
没有以软件验证代替这些硬件项目，M3–M5 未开始。机器可读状态见 `m2-status.json`。
技术选型上，在当前已测 Intel/SDR 范围内优先 D3D11 候选；保留 OpenGL 对照，
未改变生产引擎默认值。新 D3D11 后端的其他 GPU/驱动组合仍需资格探测与验收。

## 实际修复的问题

| 问题 | 处理与证据 |
|---|---|
| 原生子进程崩溃留下父进程 NT 共享句柄 | `handle-crash-4wWmbH`：强制结束自有子进程后，GPU 引用已释放，父句柄仍有效。主进程改为从子进程复制并持有自己的 lease，排空 GPU 读者后关闭；`handle-crash-JKVELc` 复测 25/25 引用归还、句柄 1/1 关闭、主界面存活 |
| 致命错误后，已在途 snapshot 仍可能准入一帧 | 错误立即关闭准入，snapshot await 返回后再核对；真实挂起可准入帧后注入管道故障，进口计数不增加 |
| 连点关闭可能绕过第一次关闭的等待 | 每次 close 都先 preventDefault；只创建一个收尾。记录原生退出码、是否强制终止，防止重复 finish 覆盖证据 |
| 过早的宿主失败提示丢失 | 页面载入后重放当前原生错误；固定不存在的 DLL 后缀测试，不删除真实库 |
| 命令写失败/超时留下等待或未捕获 stream error | 白名单 command bridge 统一拒绝 pending，写失败、timeout、stream error/close 均有明确语义 |
| C# UI 派发分配和短时句柄波动 | 复用 Monitor gate，保存完整空闲轨迹。CLR 延迟线程初始化与 GPU 句柄分开归因；不强制 GC，不扩大原有 8 个句柄空闲上限 |
| 竖屏原尺寸卷积合并灰阶 | 共享 FBO 与源尺寸一致时显式 bilinear，保留 FP32 内部处理/F16 交换；877 个灰阶平台不合并，不缩小视频 |
| Render API 返回错误未检查 | Render 委托按头文件返回 int，检查真实返回码并进入失败清理 |
| 长 MKV 的轨道 duration 缺失 | 仅用已验证容器 duration 补充；不猜测时长 |
| 随机跳播压力参数被拼错 | `AVHUB_RENDER_SEEK_STRESS` 现在报错；统一入口使用正确 `AVHUB_RENDER_STRESS_SEEKS`。8COdgX/qaG1Cx 实际仅 12 次，不宣称 60 次；SiLs0V 已真正补跑 60 次 |

共享句柄的规则依据 [Win32 DuplicateHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle)
与 [CloseHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-closehandle)。
遵循 Electron [allReferencesReleased](https://www.electronjs.org/docs/latest/api/shared-texture) 回调后才能回收共享资源的要求。
未用 fs.closeSync 冒充 Win32 HANDLE 关闭，也不再依靠子进程正常 Dispose 来清理父句柄。

## 为什么增加 D3D11 候选

旧固定构建为 2026-10-14。上游在 **2026-10-15** 的
[`4255130`](https://github.com/mpv-player/mpv/commit/4255130de410e0cbdab694b951085409d466b704)
才加入 D3D11 Render API。先前“Render API 只有 OpenGL/SW”的结论适用于旧候选，不适用于新源码。

`evidence-FKHwr3` 的旧 WGL 最后补测没有生成最终验收报告，只有约 64 秒 checkpoint；
它是 **中断/未完成**，不能算 15 分钟通过。该段在 Intel UHD770 上，decoder drops=0，
VO 累计 8→265 持续增加，足以暴露性能风险。此前 RTX4090 的 15 分钟成功不能替代这条核显路径。

另行锁定 `baa3e11d42cb7978da634a8a6a3a55fe074d01be` 的 generic x64 构建，
不覆盖旧候选或 `bin/mpv`。DLL SHA-256 为
`ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74`。
完整归档/文件校验在 `ci/libmpv-d3d11-candidate.json`；
来源、补充头文件及许可限制见 `third_party/libmpv-render-d3d11/README.md`。

新 `D3dSurface` 直接向源尺寸的 D3D11 F16 纹理渲染，以 GPU event 确认完成，再交 Electron。
不经过 WGL_NV_DX_interop，不将完整视频帧搬到 CPU 上传，不降低分辨率、位深或转码。
诊断行读取仍只用于初始精度检查/显式像素探针，不作为视频传输。保留一个在途帧、容量/预算检查、
读者归还及设备错误清理。**不宣称端到端零拷贝**。

`D3dCapabilityProbe` 已实际创建上下文（result=0），这仅证明 API 存在；
真实 Electron `evidence-vKYtuh` 进一步验证 4K、877 灰阶和实际画面/React 组合。
核显解码由旧路径 `d3d11va-copy` 变为 `d3d11va`。新的库和后端同时变更，
不能把全部差异单独归因某一项，也不能据此声称所有媒体比 HTML5 更快。

## 已完成的相关实测

以下均位于 `build/libmpv-render-spike/`，使用应用自有生成样本；未读取或修改 E:\downloads。

| 证据 | 结果 |
|---|---|
| evidence-N63vcr（旧库/RTX4090，历史补测） | 竖屏 60 次跳播 + 2000 RPC，灰阶 877，准确跳播及空闲收敛；不是新 D3D11 后端结果 |
| evidence-8COdgX（旧库/Intel，父句柄修复） | 实际 12 次跳播，允许误差内，108/108 引用归还，句柄归零；关闭耗时约 2.3 秒，不能仅凭 UI 关闭宣称迅速原生退出 |
| evidence-qaG1Cx（旧库/Intel） | 实际 12 次竖屏跳播 + 2000 RPC；877 灰阶，空闲句柄范围 1，父句柄归零 |
| evidence-OVQ58a（旧库/Intel，双次关闭） | 连续两次 close，原生退出码 0，未强制终止，原生收尾约 216ms，44/44 引用归还 |
| evidence-iIcnCm / vsUAHx / eOhpEa / ihxCDm / 76Ycpv | 旧 WGL 后端分别验证子进程强制退出、WebGPU device.destroy、故障准入边界、导入失败、渲染线程异常；主 UI 存活时父句柄均 1/1 关闭 |
| startup-fault-AwTxGS | 私有打包启动失败正确呈现，0 导入，无宿主残留 |
| evidence-vKYtuh（新库/D3D11/Intel） | 4K SDR10 开发态，877 平台，F16 传输最大差约 2.5e-8，正常关闭与父句柄清理通过 |
| evidence-SiLs0V（新库/D3D11/Intel） | 真正 60 次跳播，实际像素帧号误差全为 0；测试端测得 p50≈258ms、p95≈282ms，含 RPC/探针开销，不是实体扫描输出延迟 |

SiLs0V 两分钟连续时间轴完成，导入/释放 3220/3220，正常原生退出约 170ms。
decoder 观察增量 0，VO 观察增量 **8**（1→9），不能称零丢帧。
原生句柄峰值正向增长 2、结束增长 0；私有内存峰值正向增长约 0.25MiB；
GPU 峰值正向增长 64KiB。该报告使用当时的资源门槛，不回填为通过后来新增的丢帧门槛。

最后 15 分钟采用更严格且明确的判定：固定 25fps 样本，decoder 观察增量必须为 0，
VO 观察增量不超过预计源帧的 0.1%；缺失或回落的计数不能当作零。保留全部原始计数。
这是新增验收门槛，不是放宽旧有内存/句柄阈值。模 150 实际像素计数用于证明内容推进，
不冒充逐帧覆盖或精确解码总数；调度/重绘计数继续分开。

## 复现与边界

相关 Node 引擎/源/颜色/资源/句柄用例 49 个，原生预算边界 8 个，
Python 原生库准备 11 个、FFI 准备 5 个、CI 配置 12 个。
单元/合成安全测试不冒充真实 GPU 验收。最终结果与下节长播/故障证据一起审阅。

```powershell
python scripts/prepare-libmpv-render.py --candidate d3d11
python scripts/prepare-render-ffi.py
node electron/test/render-api/run-acceptance.mjs d3d11-long --prepare-package --packaged
node electron/test/render-api/run-acceptance.mjs d3d11-av1 --prepare-package --packaged
node electron/test/render-api/run-acceptance.mjs d3d11-av1 --packaged --fault=exit
```

这是 M2 计划要求的 **AVHubRenderSpike 私有目录原型**，不是 AVHub EXE/ZIP 发布。
启动器会清除遗留 AVHUB_RENDER_* 参数，并固定样本/测试组合，避免误带故障或缩放变量。
它不会提交、推送、创建标签、升版本号、调用主应用发行构建或上传。

FFI 固定 Koffi 3.3.4，MIT，8 个运行文件单独哈希。最终加载器直接载入清单中的 .node，
不使用第三方包的动态搜索/回退路径。只在可信主进程调用最小 Win32 句柄 API；
preload 不暴露 Win32、任意 DLL、路径或命令执行。主项目 package/lock 没有增加这个依赖。
原生库为固定开发构建，许可审查和相应源码/传递依赖材料仍不完整，`distributionReady=false`；
不把 private prototype 可运行混淆为 M5 发行完成。

回滚不需要改媒体库：保持 M1 控制器默认关闭，保留现有播放路径；原型入口只在
electron/test/render-api，生产侧没有自动启用本轮渲染后端。

## 最终长播与新后端故障矩阵

### 十五分钟连续时间轴

`evidence-YxryfJ`，私有原型
`package-20261025T232300995Z/win-unpacked/AVHubRenderSpike.exe`，Intel UHD770 / d3d11va / SDR。
运行环境 Electron 报告单屏 1252×604 DIP、100%、8-bit、60Hz；不借用前轮 125%/RTX4090 环境的结论。
源为 960 秒连续 PTS 的流复制样本，24,000 个编码包与原六秒片段逐包 SHA-256 对应。
内容每六秒重复，不能冒充十五分钟独特运动素材或高码率真实电影压力测试。

| 项目 | 结果 |
|---|---:|
| 连续播放 | 900,019ms；412 次实际 GPU 像素抽样 |
| 像素源时间 / 墙钟 | 1.0000013；观测中无停滞、无模计数歧义 |
| decoder drop 观察增量 | 0；计数无缺失/回落 |
| VO drop 观察增量 | **16**；计数无缺失/回落，门槛 22，通过 |
| 调度 / 重绘 / 未分类帧增量 | 22,485 / 0 / 0；精确解码帧数仍为 null |
| 源尺寸 / 灰阶平台 | 3840×2160 / 877，F16 传输最大差约 2.5e-8 |
| 随机跳播 | 60 次，实际像素帧号误差全为 0 |
| 原生句柄排空基线 / 结束中位数 | 538 / 528；峰值正向增长 0，结束空闲范围 1 |
| 原生私有内存峰值正向增长 | 122,880 字节；结束无正向残留，约 1.297GiB |
| 原生 GPU 峰值正向增长 | 65,536 字节；结束无正向残留 |
| 纹理导入 / 引用释放 | 22,712 / 22,712；最多一个在途，无导入失败 |
| 父进程共享 lease | 创建 1、关闭 1、live=0 |
| 连续两次关闭 | 原生退出码 0，未强制终止，收尾 155ms；含测试端退出约 474ms |

第 634 秒附近 VO 累计值从 5→17，保留这次波动，不声称零丢帧，也不在没有受控 A/B 的情况下
归因某个进程负载。增量 16 / 预计 22,500 源帧≈0.071%，通过事先定义的 0.1% 门槛。
这不是“完全不卡顿”的保证。Electron 合计私有内存（不含原生宿主，单位 KiB）
在 60–300、300–600、600–900 秒的中位数约 526,180、531,552、532,524；
没有持续等速增长的观测，但不将其当作所有 GPU 内存或长期泄漏的认证。

### 新后端完整故障及补充回归

| 证据 | 验证 |
|---|---|
| evidence-ywhFUf | 私有打包 4K AV1，60 次跳播全为 0 帧误差；d3d11va；正常退出及父句柄归零 |
| evidence-9rKnj3 | 强制结束自己的原生宿主，主 UI 存活，父句柄归零 |
| evidence-ivUYU3 | 实际销毁自己的 WebGPU device，主 UI 存活，引用/句柄归零；不是物理 GPU 复位 |
| evidence-mjZwdD | 已在途可准入帧处注入错误，错误后无新增导入 |
| evidence-dIIjix / IQs4yo / Iq3aAq | 纹理导入失败 / 渲染线程异常 / 命令管道故障；主 UI 可操作，句柄均 1/1 关闭 |
| startup-fault-FyQUMk | 打包后早期 DLL 初始化失败，提示可见，0 导入，无孤儿宿主 |
| evidence-20ldwH / DDjAR3 | 最终直接 N-API 加载后的竖屏 4K：60 次跳播误差全为 0、877 平台；另测导入失败正常归零 |
| evidence-bOLPT2 | 最终 D3D11/RGBA8 实际像素读取，60 次跳播通过，真实读到 00-FE-00-FF，未填充假测量值 |
| hdr-pixels-3DYBb5 / cd0C2I | 新 D3D11 的 HDR 饱和色/灰阶离屏数值通过；最大原生 PQ 码差约 0.0004883，数值传输通过；**HDR 显示认证仍为 false** |
| evidence-QIuvD2 | 保留的 OpenGL/RGBA8 路径，60 次跳播和双次关闭通过，原生退出码 0，未强制结束 |

精确构建范围：十五分钟包对应源 fingerprint
`ee25f0e5c0a38a5e2ac9e620bab6aa8a5d1f0886e3cd38e29c00dd14ef19a56d`。
其后仅补齐长播未使用的 RGBA8 诊断读取，以及将同一个已校验 N-API 二进制改为直接加载；
最终竖屏、RGBA8、HDR 数值和故障补测对应后续源。**没有声称最新指纹的所有代码重跑了十五分钟。**
F16 正常逐帧渲染/读者释放循环没有在这两项收尾中修改。各报告的 runtime、DLL hash、
私有包来源和退出证据保留，不能将不同构建的结果拼成一次相同成品认证。

尚未验证的实体 HDR、混合 DPI/多屏、不同刷新率与新后端更多 GPU 组合继续保留待办。
不要直接把 PoC 的生成文件白名单、audio=no 或诊断控制页当成正式 MpvEngine；
正式媒体授权、音频/轨道/字幕全业务、切源恢复与生产播放器联动属于后续 M3。
本轮未提交、推送、创建标签、发布或升版本；冻结归档、用户计划和原有无关修改保留。
