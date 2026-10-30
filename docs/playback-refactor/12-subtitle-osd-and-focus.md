# M2：原生 ASS / OSD 与 React 输入焦点验证

2026-10-25。M2 尚未整体通过，M3–M5 未开始。本轮只修改隔离 PoC，
生产 MPV/HTML5 播放器、播放界面和默认设置均未接入这些测试控件。

## 实现与安全边界

- `overlay-fixture.cjs` 提供固定、生成的 ASS：英文文字、旋转、双色、描边、阴影及矢量矩形。
  使用系统 Arial，不分发字体。不是所有复杂 ASS、动态字幕、外挂字幕格式的完整认证。
- 仅 `AVHUB_RENDER_OVERLAY_TEST=1` 开启测试。主进程在独立 run-logs 目录中排他创建
  固定 ASS，并覆盖子进程的文件环境变量，不接受 renderer 的文件路径或字幕文本。
- 原生宿主通过 libmpv `sub-add`/`sub-visibility` 和固定 `show-text` 调用绘制，
  不是用 React 模拟 MPV 字幕。主进程只允许两个布尔测试开关；字符串路径和对象参数被拒绝。
  默认不开启这些 IPC，HDR 数值探针也不能借此变成 HDR 显示路径。
- 固定样本通过共享纹理进入同一个 Electron compositor，React 菜单仍在同一窗口内。
  截图只取本 PoC 窗口，不捕获其他桌面窗口。CPU 截图用于验收，不参与视频上传/播放。
- 私有成品包含固定 ASS 源模块，纳入源码指纹校验；没有修改 AVHub 正式打包配置。

原生命令行为依据 [mpv 官方手册](https://mpv.io/manual/master/) 的命令接口与字幕属性。
本轮没有解码重编码、降分辨率、降位深或 HDR→SDR 自动回退。

## 输入焦点

PoC 原来的按钮只通过本地布尔状态决定暂停，没有统一键盘控制路径。
本轮在隔离 React 控件中增加 Space 处理：读取原生实际 pause 后切换，暂停操作串行；
忽略重复 keydown 和组合键；进度条/按钮焦点不夺走播放器 Space；菜单内 Space 不传给播放，
Escape 只关菜单。文本编辑控件保留输入，不拦截其 Space。

真实 Electron 已测试进度条焦点、按钮焦点、重复 keydown、菜单 Space 隔离及 Escape。
文本编辑、IME、系统焦点切换与所有生产快捷键组合未据此宣布全部通过。
这些改动不等于已改写正式应用的快捷键逻辑。

## 实测与证据

所有片源均为 build 内生成样本，未访问或修改 `E:\downloads`。
当前为 RTX4090、SDR 显示环境；以下像素是 Electron 合成截图，不是实体亮度/HDR 证明。
每次暂停同一源帧，分别开字幕、关字幕、开 OSD、同时打开、全部关闭；排除 React 顶栏/底栏，
对合成截图 ROI 做像素差检查，不能只用 sub-text/pause 等状态冒充显示成功。

| 路径 | 证据 | 结果 |
|---|---|---|
| 默认 RGBA8，窗口及全屏 | `evidence-8FVTjL` | ASS、OSD、同时显示、清除、菜单和焦点通过；68/68 导入释放 |
| 4K SDR10/F16 开发态 | `evidence-WdfXc9` | 60 次实际像素 seek，误差全 0；窗口/全屏叠层通过；252/252；877 平台保留，传输灰阶最大差 2.5e-8 |
| 最新私有成品 4K SDR10/F16 | `evidence-JiY5aS` | 加强后的重复按键及非法参数拒绝、窗口/全屏叠层、60 次 seek、关闭边界全部通过 |
| 默认关闭测试命令 | `evidence-x1eokE` | subtitle-probe 被拒绝；默认 RGBA8 跳播误差全 0，正常退出 |

成品 `package-20261025T112249178Z/win-unpacked/AVHubRenderSpike.exe` 为隔离 M2 私有目录包，
不是 AVHub 正式发布包。完整报告在 `build/libmpv-render-spike/`，各图为
`overlay-windowed-*` / `overlay-fullscreen-*`。已人工查看成品的全屏字幕、OSD 与 React 菜单合成图。

成品截图差异（阈值每通道 24；数值用于确认显示/消失，不证明字体像素绝对正确）：

| 状态 | 窗口 ROI 482,482 像素中的变化数 | 全屏 ROI 912,384 像素中的变化数 |
|---|---:|---:|
| ASS | 28,505 | 66,047 |
| ASS 关闭 | 0 | 0 |
| OSD | 3,108 | 7,454 |
| ASS + OSD | 31,471 | 73,177 |
| 全关闭 | 0 | 0 |

成品 60 次 seek 均对照独立 FFmpeg 源帧号；877 灰阶平台保留，最大传输差 2.5e-8。
暂停采样句柄范围 1；末轮私有内存增 397,312 字节、GPU 增 0。
关闭边界挂起真实可准入帧 259（最后导入 258），关闭后没有新增导入；
导入/释放 257/257，宿主退出，无残留；含边界等待约 728ms。
这仍是短时收敛检查，不能替代 15 分钟解码丢帧或长期压力，也不是端到端性能提升报告。

### 保留的测试问题

- 首次 `evidence-9Ob5pt` 因 Electron evaluate 参数签名写错导致基线尺寸检查失败。
  修正为正确第二参数传入，未改变像素阈值。
- 早期 `evidence-3yfB2t` 的 combined 截图只抓到 OSD，说明仅发出命令不足以确认字幕已合成。
  因此加强为等待 combined 的实际变化数超过 OSD，而不是将旧结果算作同时显示成功。
  `evidence-8FVTjL`、`evidence-WdfXc9`、`evidence-JiY5aS` 均使用加强后的检查。

## 测试命令与结果

```powershell
# 新 PowerShell 会话，使用生成样本；GUI 测试串行执行
$env:AVHUB_RENDER_SHARED_TEXTURE='1'
$env:AVHUB_RENDER_FP16='1'
$env:AVHUB_RENDER_SDR10='1'
$env:AVHUB_RENDER_SAMPLE='Precision-SDR10-3840x2160.mkv'
$env:AVHUB_RENDER_OVERLAY_TEST='1'
$env:AVHUB_RENDER_STRESS_SEEKS='16'
$env:AVHUB_RENDER_SEEK_ROUNDS='3'
node electron/test/render-api/spike.mjs
# 私有目录包由 package.mjs 生成；成品验收加 --packaged
```

Node 引擎/源契约/显示资格/HDR 数学与独立色彩参考 34/34；C# 内存策略 8/8；
Python libmpv 暂存 10/10、CI 配置 12/12，JS 语法通过。
本轮未重跑生产应用全套测试，未声称所有字幕功能已集成。

## M2 尚未放行

下一项为真实 GPU 呈现的长时播放/资源压力，明确统计解码帧、可见像素前进及丢帧，
不把探针重绘次数当作解码帧数。实体 HDR、多屏混合 DPI/更多 GPU 与许可材料仍未齐备。
不能用本轮 SDR 叠层成功代替这些证据，正式 MpvEngine 接入仍暂停在 M2 门槛前。

该15分钟循环验收已运行，原判定FAIL及后续观测补充见 [13报告](13-loop-endurance-and-counter-boundaries.md)。

根 package.json 与用户计划保持 M0 摘要，冻结网页版未改动；无版本提升、提交或远程推送。
