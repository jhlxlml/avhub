# AVHub 0.2.18

## 播放与可靠性

- 增量加入应用级播放会话协调层，统一会话代次、进度保存与关闭顺序，防止旧会话的跳播或异步结果覆盖新会话。该路径默认关闭，现有播放行为与偏好保持不变。
- 保留 Chromium／Hls.js、MPV 独立窗口、libmpv D3D11 内嵌三种路径，保留字幕、音轨、截图、队列和手动回切。原生资源继续由桌面主进程管理。
- 明确引擎实验选项与错误分类；默认引擎不变，自动选择不按文件扩展名猜测性能，不自动授权有损兼容播放。
- 原画策略保持不变，不静默转码、降分辨率、降位深或把 HDR 转成 SDR。

## 安全与发行校验

- 修复 fast-uri、undici 及构建依赖的已报告安全问题，保留 npm 安全审计和运行库哈希校验。
- 修复源码 CI 对开发机私有缓存的依赖；源码回归与真实原生发行验收分别记录，缺少原生构建材料不会冒充验证通过。
- 成品、对应源码、运行库和实际 Electron 验收报告按哈希关联，拒绝复用其他构建的发行证据。

## 使用提示

- 日常使用推荐完整解压文件夹 ZIP。单文件 EXE 每次启动需要自解压；不要只复制文件夹版中的 AVHub.exe。
- 升级前退出旧程序，保留 AVHub-data 及自定义数据目录配置。播放会话协调层仍为默认关闭的增量路径。
- 未认证的 HDR 色彩精度、动态元数据与不同设备兼容性不作为播放白名单。实际解码与显示能力取决于设备；遇到问题可手动回切其他原画路径。
- 并发后台任务的个别数据库写入仍可能出现长尾延迟；本次未用降低画质或隐藏缓冲提示掩盖性能问题。

## English

This release incrementally adds an application-owned playback session coordinator for generation tracking, ordered progress saves and shutdown, and stale seek/result isolation. It remains disabled by default. Chromium/Hls.js, the independent MPV window and embedded libmpv D3D11 playback remain available with existing preferences and original-quality policies.

Reported fast-uri, undici and build dependency vulnerabilities are addressed without disabling audit or runtime integrity checks. Source CI no longer depends on private developer caches; actual native/package acceptance remains a separate gate. Application binaries, corresponding source materials and real Electron acceptance are bound to matching build hashes.

Extract the entire folder ZIP for daily use; the single-file EXE extracts at each launch. Exit the old app and preserve its data before upgrading. Physical HDR fidelity, dynamic metadata and other-device compatibility are separate unverified scopes, not playback whitelists. Occasional durable database-write tails remain observable; no silent quality reduction is introduced.
