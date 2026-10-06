# AVHub 0.2.8

## 桌面启动与下载

- 新增解压即用的文件夹便携 ZIP，与单文件 EXE 同时提供。ZIP 完整解压后运行 AVHub.exe，省去每次启动外层自解包；两者均包含 Electron、Python 后端和 FFmpeg。
- 手动检查更新分别识别、展示 ZIP 与 EXE，提供下载与数据保留说明；只在点击检查时联网，不后台检查、不自动安装。
- 新增启动阶段计时。隔离空库本地测量：首次测试启动到媒体库可操作，单文件版约 11.6 秒、文件夹版约 1.75 秒；重复启动约 10.8 秒与 0.85 秒。未清空系统缓存，这些数字不代表所有电脑或真实大库。

## 播放窗口与交互

- 进入纯净播放自动置顶，退出自动取消并恢复原窗口；期间可手动切换置顶。
- 鼠标停在控制栏上时持续显示。移出隐藏控制栏；移动中的光标保持可见，在画面区域停止约 400 毫秒后隐藏。播放、暂停、纯净播放和视频全屏使用相同规则。
- 保留拖动、菜单和 Tab 导航的操作保护；键盘播放不唤出已隐藏的控件。控制栏/光标状态与计时独立整理，不改变播放地址、解码、跳播和观看进度逻辑。

## 媒体库与界面

- 目录树本次会话记住展开、分页与滚动位置；首次启动仍默认收起，隐藏时不加载目录。缓存和页码记忆有容量上限，万级目录仍分页展示。
- 刷新目录时保留相同页的列表，减少闪动；不把旧页数据显示成新页。支持缓存失效与错误重试。
- 深浅色更新下载卡片、帮助内容与成功提示统一；成功提示四秒后消失，失败不会被旧成功计时关闭。
- README 保留项目说明与使用方法，版本更新内容集中在 Releases。

## 交付与验证

- CI 分别运行单文件 EXE 和从最终 ZIP 解压的应用，验证内部依赖、同级数据目录、迁移与重启持久性。SHA256SUMS.txt 校验两个下载文件，release-build.json 记录构建来源和各自哈希。
- 打包阶段排除依赖中的隐藏元数据；ZIP 检查拒绝私有数据、源视频、链接和网页版归档。
- 本地后端回归 300 项：299 通过、1 项跳过；播放器、更新、目录树、通知和主题专项及真实 Electron 验收通过。正式发布以本次标签 CI 的最终结果为准。
- 原视频只读、原画优先、不自动有损转码策略不变。升级前关闭应用并备份，保留 AVHub-data 与 avhub-data-location.json。未代码签名，首次运行可能收到 Windows 安全提示。

## English

Adds an extract-once folder portable ZIP alongside the single-file EXE, explicit download-format choices and per-launch timing. Local isolated empty-library tests measured about 11.6s versus 1.75s on first test launch; OS caches were not flushed and results vary by machine and library.

Pure Playback pins on entry and unpins on exit. Controls remain visible on hover; the pointer remains visible during movement and hides after approximately 400ms idle over the picture. Playback/seek/source-quality logic is unchanged. Directory expansion, pages and scroll positions survive same-session sidebar hiding with bounded caches. Help, themed download cards and success notifications are refined.

CI accepts both actual delivery formats, data migration and restart persistence before publishing; checksums and provenance cover both downloads. Keep AVHub-data and avhub-data-location.json when upgrading. Source videos remain read-only; original-quality playback never silently converts video or audio. This build is unsigned.
