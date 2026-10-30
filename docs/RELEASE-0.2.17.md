# AVHub 0.2.17

## 播放架构升级

- 保留现有播放器，新增可选的原生 MPV D3D11 Render API 内嵌路径，同时保留 MPV 独立窗口及 AVHub 风格控制栏。默认播放引擎与已有偏好不变。
- 普通视频、缺少色彩标签的视频和 HDR 视频交给 MPV 实际解码，不再使用验收样本、标签完整度、固定 8K 或固定显存配额作为播放白名单；实际解码器和 GPU 能力仍须满足。
- 内嵌画面尺寸由解码器确定，支持文件旋转、非方形像素和播放中分辨率变化；等待 GPU 读者释放后切换目标，不重载源视频来适应尺寸。
- 保留音轨、字幕、倍速、截图、观看进度、队列、全屏和置顶等能力；修复播放窗口切换、返回媒体库后立即退出及进度保存期间的收尾问题。
- 原文件优先，不自动重新编码、降低分辨率或位深，不自动授权有损兼容播放；现有原画播放器保留为手动回退入口。

## 运行库与交付

- 双 MPV 运行库及 FFmpeg CLI 使用固定来源的源码构建，附带许可、NOTICE、哈希和相应源码材料；独立窗口启动时检查 EXE 和随附 DLL，缺库不会阻止媒体库使用。
- 提供单文件便携 EXE、推荐的解压即用文件夹 ZIP，以及单独的对应源码 ZIP。无需另外安装 Node.js、Python 或 MPV；不要只复制文件夹版中的 AVHub.exe。
- GitHub Actions 保留回归测试，正式成品改为本机打包、验收后上传 Releases，不由标签自动触发云端打包或发布。

## 媒体库与外观

- 完善主题配色与自定义强调色，协调媒体库、设置和原生控制界面。
- 优化封面可见性、列表缓存、收藏反馈，以及后台封面、备份和数据管理任务的只读快照与取消收尾。

## 验证与使用提示

- 同运行库组合已完成实际 Electron 控件、精确定位、动态分辨率、PQ / HLG 纹理导入、缺色彩标签、退出释放及外机双模式测试；原尺寸 4K 10-bit 生成样本连续 15 分钟，解码和输出丢帧均为 0。这不代表所有视频、硬件或物理 HDR 显示均已认证。
- HDR 实体显示准确性、动态元数据、多屏混合 DPI 和 VMware GPU 兼容性仍需分别验证，不作为视频准入白名单。出现实际硬件或解码问题，可手动选择现有播放器。
- 单文件 EXE 每次启动需要自解压，日常使用推荐文件夹 ZIP。升级前退出旧程序，并保留 AVHub-data 与自定义数据目录配置。

## English

This release adds an optional embedded MPV D3D11 Render API path while retaining the independent MPV window and existing player. Defaults and saved preferences stay unchanged. Playback admission no longer depends on a sample, colour-tag, HDR or fixed-resolution whitelist; actual decoder and GPU support still apply.

Decoder-driven geometry handles rotation, pixel aspect ratios and resolution changes without reloading the source. Fixed-source MPV and FFmpeg runtimes, license notices, checksums and corresponding source materials are included. Original quality is preserved; lossy compatibility conversion is never an automatic performance fallback.

GitHub Actions runs regressions only. Release binaries are built and accepted locally. Extract the entire folder ZIP for daily use; the single-file EXE extracts on every launch. Physical HDR fidelity, dynamic metadata, mixed-DPI output and VMware graphics remain separate verification scopes. Preserve your data and exit the previous app before upgrading.
