# AVHub 0.2.14

## 原画播放与诊断

- 默认继续优先原文件直放，不自动降低分辨率、位深、色彩或音频质量。原文件 Range 路径查询不再等待扫描/编辑的全局写入锁，仍受恢复读取屏障保护。
- H.264 MP4/M4V/MOV 的画质菜单新增“原画 · 无损封装（本次）”，适用于部分异常交织、直放供数不畅的文件。仅主动选择后生效，不记为全局设置、不复制整片；AAC/MP3 或无音轨保持复制，拒绝继承有损转换权限。失败可返回原片，不悄悄换路径或转码。
- 常见 classic MP4 从有界时间表建立关键帧索引，避免逐包扫描整片；旧索引保留复用。复杂编辑、分片容器等仍走可靠探测，源变更、取消及缓存读者保护保留。增加分片容量、磁盘余量及截断输出拒绝。
- 修复 MP4 容器独有色彩标记在 TS 封装中遗漏的问题：将原始 CICP 元数据保留到 AVC VUI，不重编码画面、不做色彩转换；ICC/未知或无法表达的描述拒绝封装，不假定为 SDR。普通和索引无损路径均处理。
- 播放信息新增手动 8 秒播放诊断导出，可取消、重试和定位保存文件。记录真实解码器、GPU/驱动、帧呈现、播放推进、缓冲及范围请求；不后台常驻、不切源，不导出视频路径、标题、画面或音频设备标识。

## 媒体库、界面与恢复体验

- 统一媒体库、设置、帮助、片单、文件整理及播放器的深浅色表面、图标、焦点、间距与窄窗口布局；保留封面尺寸和原有导航习惯。
- 封面按视口需要加载，离屏悬停预览及时释放，封面缓存支持版本与条件复用；增加播放、扫描、封面并发时的读取协调及验收。
- 优化每视频音轨、已识别字幕和延迟记忆，与全局音量/倍速/字幕外观及片单设置隔离；源身份或轨道变化不沿用旧记忆。
- 文件状态、来源变化和回收记录刷新协调，回收失败/未执行项重新预检，不自动重放不确定的系统操作。确认框、待保存保护、部分失败及成功提示样式统一。
- 修复短窗口续播按钮被控制区遮挡，以及浅色模式续播提示的文字/背景对比；长播放错误和设置弹层可内部滚动，不滚动页面或缩放画面。补齐隐藏控件热区、通知更新、全屏及 TS 索引测试时序。

## 发布范围与验证边界

- 正式便携包仍使用默认 Chromium 播放器，提供单文件 EXE 和解压即用文件夹 ZIP。**本次不分发 MPV 二进制**；源码内 MPV 内嵌/独立窗口能力仍是可选试用，运行时分发和硬件/混合 DPI 验收门槛没有解除。源码配置若选择过 MPV，使用正式包时可在播放偏好选择现有播放器。
- 开发机真实 Electron 只读整片验证：约 5 GiB MP4 显式封装约 0.42 秒就绪，目标新帧跳播和源复用通过；普通 1080p 与高码率 4K 默认直放通过。数字受硬件、缓存与文件结构影响，不是所有文件的速度承诺。
- 本机仍记录到波动丢帧，未复现持续慢于 1× 的媒体时钟，不宣称另一台电脑的慢动作感已修复。真实 HDR 显示和物理音画同步未由静音单机测试验收；合成 10-bit/PQ 测试只验证位深、标记及解码像素保持。
- 后端、渲染器及真实 Electron 启动/退出、纯净置顶、播放器 UI 回归已检查；正式 EXE/ZIP 仍由标签触发的 GitHub Actions 构建并执行成品验收，云端结果与本机结果分开判断。
- 升级前退出应用并备份数据目录；备份不包含原视频。源码、原视频、数据目录、开发缓存和测试产物不作为发布包混装。

## English summary

- Original-file playback remains the default. An explicit, session-only lossless H.264 MP4/MOV remux option and bounded sample-table indexes address some poorly interleaved files without full-movie copies or automatic quality reduction.
- MP4 container CICP tags survive TS delivery through metadata-only AVC VUI updates; video/audio are copied, not re-encoded. Unsupported colour descriptions fail closed. Manual diagnostics identify the actual decoder and measure frames, clock advance, buffering and delivery without exporting media paths or titles.
- Refined consistent light/dark desktop UI, short-window resume decisions, local overlay scrolling, artwork loading, playback memory and scoped file/recycle recovery.
- Portable EXE and folder ZIP use Chromium. MPV binaries are not distributed; optional source-preview gates remain closed. Local read-only Electron results are not proof of the reported other computer, universal zero dropped frames, physical audio sync or HDR appearance. CI builds and verifies the final portable artifacts after the release-tag push.
