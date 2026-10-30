# M2：原生嵌入验证与范围决定

> **当前决定：用户已明确授权限定 SDR 放行并推进 M3。**
> 当前构建十份证据闭环及边界见 [16：SDR 范围放行](16-current-cohort-and-sdr-gate.md)，
> M3 限定验收及 M4 首帧同步见 [20](20-m3-scoped-acceptance-and-m4-startup.md)。
> 下文“不实施 M3”是早期历史结论；实体 HDR/混合 DPI 多屏仍未验证，完整物理矩阵未标为通过。

> **最新复核见 [15：所有权修复与 D3D11 候选](15-m2-ownership-and-d3d11.md)。**
> 已修复崩溃共享句柄泄漏、重复关闭/故障准入竞态，并验证了更新的 D3D11 Render API；
> 下文保留首轮历史状态。实体 HDR/混合 DPI 多屏按用户决定待办，完整 M2 不标为通过。

> 本文件保留第一轮盘点证据。后续已补齐 libmpv，并完成共享纹理 Render API 的开发态和
> 隔离打包态核心 PoC，详见 [后续验证报告](03-libmpv-render-api-spike.md)。
> 下文“未完成 Render API / 缺少 DLL”是第一轮状态，不是最新结论；完整 M2 门槛仍未放行。
> 最新Intel灰阶修正与成品实测见 [07报告](07-intel-precision-isolation.md)，完整M2仍未放行。
> 后续显示/HDR资格和设备LUID匹配见 [08报告](08-display-hdr-and-adapter-identity.md)。
> HDR离屏数值验证见 [09报告](09-hdr-offscreen-luminance.md)，不能视为HDR显示或M2整体通过。
> 后续饱和色及关闭边界验证见 [10报告](10-hdr-colors-and-close-boundary.md)。
> 最新按需读回与成品回归见 [11报告](11-on-demand-readback.md)，M2仍未放行。
> 原生ASS/OSD叠层、全屏与输入焦点实测见 [12报告](12-subtitle-osd-and-focus.md)。
> 15分钟循环验收暴露句柄波动超限，原结果FAIL，见 [13报告](13-loop-endurance-and-counter-boundaries.md)。
> 连续时间轴、正向增长/排空观测及布局缓存回归见 [14报告](14-continuous-timeline-and-resource-convergence.md)，M2仍未放行。

2026-10-25；应用构建 `6f5b5c90628f1b9d`。**M2 未通过完整退出门槛，M3–M5 不实施。**
M0/M1 成果可保留，默认行为和原有显式 MPV 功能不变。没有接入 Cinema OS、改版 UI、
提升版本、打包、发布或推送。此报告区分“真实运行的 HWND PoC”和“尚未运行的 Render API”。

## 依赖来源与完整性

本轮复用此前工作区中已锁定的候选，不下载或安装新原生依赖，不更换 `bin/mpv/`。

| 项目 | 证据 |
|---|---|
| 上游 | [mpv 官方 v0.41.0](https://github.com/mpv-player/mpv/releases/tag/v0.41.0)，x86_64 Windows MinGW |
| 源码提交 | `41f6a645068483470267271e1d09966ca3b9f413` |
| 外层 ZIP SHA-256 | `a49811c0752c108b8260636f9c6f6fcb97406641c98b30f1e7b500dfb20177de`；本轮官方资产元数据再次核对相符 |
| 内层 ZIP SHA-256 | `443afe07e61e3f742743349d01d8dac95f0c5390a766a9d3d5b1b5f05911bae5` |
| EXE/DLL | `ci/mpv-stable-candidate.json` 锁定全部 24 文件；测试入口验证外/内归档和每个文件的摘要、类型、大小、路径，无未知 DLL |
| 许可 | 对应 GPL 文本和版权说明在 `third_party/mpv/upstream-stable/`；传递依赖通知、源码及构建材料审查未完成，`distributionReady=false` |
| 平台/安全 | 本轮仅 Windows x64；DLL 为原生进程权限，测试只允许校验清单内文件；不开放 renderer 任意路径或命令 |

可复查：`python scripts/playback-m2-inventory.py`。离线输出保存于
`build/playback-refactor-20261025/m2-dependencies.json`，本脚本仅检查材料，不声称执行 Render API。

## A：libmpv Render API —— 已评估依赖和 API，未完成运行 PoC

核对固定提交的官方 [render.h](https://github.com/mpv-player/mpv/blob/41f6a645068483470267271e1d09966ca3b9f413/include/mpv/render.h)
及同归档的 `client.h`、`render_gl.h`。当前公开渲染后端为 OpenGL 和软件，不能把 MPV EXE 的
D3D11 VO 直接当成 Electron 可导入纹理的 Render API。

- 渲染上下文必须先于播放建立；GL context 在调用线程必须 current，渲染和普通控制线程需隔离，
  update callback 内不能重入渲染。销毁顺序必须先 render context，再 MPV core。
- 软件渲染会引入 CPU 色彩转换/缩放和拷贝，且 HDR 有额外限制；本轮未把逐帧 PNG/CPU 图像搬运
  作为“原画、高性能嵌入”的替代实现，也没有把隐藏原生窗口算作渲染成功。
- 已校验候选是 `mpv.exe + 23 DLL`，**没有 libmpv DLL**；不能对 EXE 调用 `mpv_render_context_create`。
  这不代表其他供应商或自行构建的 libmpv 不可行，只说明本轮没有已锁定和审查的此类输入。
- 当前 PATH 没有 cl/clang/gcc/cmake/meson/ninja，dotnet 无 SDK；Framework csc 存在，不能据此
  声称电脑完全没有编译器。构建 libmpv/原生 GPU 宿主所需工具链和依赖尚未就绪。

决定：A **未验证**，不是性能失败；没有虚构 Render API 适配器或把 IPC ACK 当作呈现证据。
下一步需先取得稳定、可核验的 libmpv DLL 和完整依赖清单，再在独立宿主验证 GL/共享纹理、
线程与色彩输出，最后才考虑生产接线。不能为了绕过此门槛临时使用不明二进制或关闭沙箱。

## B：HWND 备选 —— 当前单屏真实桌面 PoC 通过，完整认证仍缺项

复用现有 `nativePlayer.ts` / `app/native_window.py`，未重写生产窗口机制。
在 `electron/test/native-embedded.mjs` 增加可重现的 `AVHUB_M2_SPIKE=1` 模式：

```powershell
$env:AVHUB_M2_SPIKE='1'
node electron/test/native-embedded.mjs
Remove-Item Env:AVHUB_M2_SPIKE
```

该模式只使用生成的 640×360、25 fps、90 秒 SDR H.264 MKV；数据与 app home 隔离。
候选通过**测试专用** `MpvClient.start` 钩子选择，生产完整性检测仍针对原先开发运行库；
不能据此宣称稳定候选已完成正式安装校验或打包。旧测试模式保持兼容。

两次真实桌面运行通过，最终证据目录 `build/native-embedded-jZuUd7/`：

| 核验 | 实测证据 |
|---|---|
| 正常 GPU/安全 | `m2-environment.json`：无 `--no-sandbox` / `--disable-gpu`，NVIDIA RTX4090、ANGLE D3D11、GPU sandbox=true |
| renderer 安全 | `m2-window-preferences.json`：主窗和控件窗 sandbox=true、contextIsolation=true、nodeIntegration=false；断言强制检查 |
| 真实视频与控件同时呈现 | 系统 `desktopCapturer` 的应用区域截图；不是 MPV screenshot 或仅 DOM capture。normal/pure/rotated/fullscreen 均有红蓝动态图案与白色播放图标像素 |
| HWND 与 DPI | `embedded-windows.json`：视频宿主 WS_CHILD、父窗口为主窗，控件层是 owned 透明 popup；主窗/子窗同 DPI |
| 窗口与布局 | 真实进退全屏、最小化恢复、移动、纯净播放比例、旋转、滚动裁剪、迟到 layout、20 次移动检查通过 |
| React 操作 | 暂停/键盘快进、收藏后快捷键、截图、滚轮缩放还原、模态层遮挡及退出通过；源打开次数仍为 1 |
| 退出与原文件 | 返回库后 active=false；无 pageerror；生成源摘要/mtime 不变；应用正常关闭 |

最终输出：`build/playback-refactor-20261025/m2-final-embedded.log`，exit 0。
`acceptance.json`、`normal-controls.png`、`pure-controls.png`、`pure-rotated-controls.png`、
`fullscreen-controls.png` 保留原始证据。先前正常运行目录 `build/native-embedded-NoBr9b/` 也保留。
颜色图案和按钮像素仅证明当前生成图案/控件可见，不证明所有菜单内容、真实色准、HDR 或零拷贝。

另运行稳定候选双模式生命周期/故障注入：

```powershell
$env:AVHUB_TEST_MPV_CANDIDATE='stable-0.41.0'
node electron/test/native-engine.mjs
Remove-Item Env:AVHUB_TEST_MPV_CANDIDATE
```

exit 0；报告 `build/native-engine-cJZMuX/acceptance.json`，日志 `m2-lifecycle.log`。
这是应用内真实播放配合明确注入的失败/恢复，不是物理 GPU 设备丢失测试。

## 尚不能放行的项目

| 门槛/矩阵 | 状态与原因 |
|---|---|
| 100%/150% 与混合 DPI 多屏、不同刷新率/集显 | 未验证；本机仅一块125%、59Hz屏幕。未改变系统显示设置或用强制缩放冒充物理多屏 |
| 4K HEVC/AV1/HDR 实际输出和丢帧 | 本轮未验证；旧原生质量门禁仍限制未验证 HDR/10-bit，未削弱门禁以获得“通过” |
| GPU 设备异常与全部控件叠层 | 未做完整设备故障矩阵，部分菜单/字幕实际桌面内容仍需补证 |
| Windows packaged 原生嵌入 | 未验证；现有打包资源未包含此候选，候选完整性检测仍是测试覆盖。仅打包现有程序无法验证目标依赖布局 |
| libmpv/原生材料 | libmpv 输入尚未就绪；稳定候选的传递材料、完整多 DLL 运行库校验和正式部署仍未完成 |

`npm run check:mpv` 本轮仍报告 development-preview / runtimeVerified=true /
distributionReady=false，阻断项保存在 `build/playback-refactor-20261025/m2-readiness.log`。
不能修改布尔值、仅复制 DLL 或沿用旧 EXE 成品来宣布这部分完成。

## 决定、后续与回滚

**选择暂缓正式选型，停在 M2。** B 可作为继续验证的候选，A 仍应优先完成真实宿主试验。
下一步顺序：稳定 libmpv/多 DLL 输入及验证 → 隔离宿主 PoC → 同一依赖的本地打包验证 →
补物理 DPI/显示/编码矩阵 → 按证据重新评审 M2，之后才允许 M3。
其中物理多屏/其他 GPU 的验收需要相应设备，不能由当前单屏自动化替代。

没有新增正式 MpvEngine、auto-MPV 策略、跨引擎自动回退、remux 切片调参或 M5 发布变更。
M1 默认开关关闭，关闭试验开关即可绕开 Controller；全面源码回滚应按 M1 文档对照 M0 副本，
不能覆盖用户原有修改。M2 只有测试模式/只读盘点/报告变更，清除环境变量即可回到既有测试入口。
