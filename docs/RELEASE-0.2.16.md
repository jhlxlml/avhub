# AVHub 0.2.16

## 隐私模式与桌面界面

- 新增顶栏隐私模式：一键模糊封面墙、列表、剧集、片单、队列和文件操作预览；开启后停止封面悬停视频，设置保存在本地并随数据迁移保留。主动播放的视频、标题、路径及截图文件不隐藏；此功能不是加密或访问控制。
- 统一窗口、应用内品牌与桌面图标；刷新媒体库改为图标按钮，整合“全部分辨率”入口，协调深浅主题、控件大小和顶栏图标间距。
- 修复搜索展开后缩小窗口会把整页撑宽的问题：封面墙自适应列数，空间不足时分类导航换行，避免页面横向滚动和右侧操作被挤出窗口。
- 优化媒体目录操作：移出媒体库按钮置于扫描按钮右侧，修复目录刷新与文件权限保存之间的竞态，补充读取失败和重试反馈；移出媒体库不删除原视频。
- 对齐数据目录、文件状态等设置控件，优化封面菜单靠近屏幕边缘时的位置及收藏操作稳定性。

## 媒体库、封面与并发

- 改善扫描的内存边界：分批查询候选路径，不再启动时加载整库路径字典；保留嵌套目录归属、取消及增量扫描语义。
- 改善剧集、片单、偏好和封面查询的读写隔离，减少普通浏览排队等待写事务；优化片单分页中的邻居和位置查询。
- 外部删除或移回文件后，可通过刷新媒体库更新缺失状态；新增“失效视频与封面”预览，按需清理缺失视频的自动封面，保留索引、收藏、进度、片单及手动封面。离线目录、源文件引用、回滚引用及占用项目受保护，不自动删除原视频。
- 存储统计和清理预检的缓存遍历、回滚数据库读取不再长时间持有播放控制锁。确认清理仍重新核对引用、文件身份和读者状态；无关原文件读取可继续，不移除安全校验换取速度。
- 改善悬停预览在超时、失败或页面隐藏后的资源释放；增加慢提交关联信息及启动阶段观测，保留原有持久化成功和退出保护语义。

## 使用与验证边界

- 提供单文件 EXE 和解压即用 ZIP，日常推荐完整解压文件夹版后运行 `AVHub.exe`，避免单文件版每次启动的自解压开销。
- 更新前退出应用并备份数据目录；保留 `AVHub-data` 与 `avhub-data-location.json`。应用备份不包含原视频，发布包不包含用户媒体和数据库。
- 本次采用本地构建、实际 EXE/ZIP 验收后直接上传；不以 Actions 通过作为本次发布依据。成品检查涵盖合成旧库升级、观看与片单数据保留、迁移、生成视频实际解码、隐私设置持久化及退出/预检取消保护。下载清单绑定正式源提交、构建身份、大小与 SHA-256。
- 仍优先原文件、原画播放；必要时使用支持的无损封装，不自动降低分辨率、位深、色彩或音频质量。有损兼容播放仍须明确确认。本版不分发 MPV 二进制，开发预览的分发与物理桌面验收门槛不变。
- 历史偶发启动超时、后台提交长尾及特定设备/媒体的掉帧不宣称彻底解决。最终清理中的必要文件核对和删除仍可能受磁盘 I/O 影响；合成 SDR 样本不构成全格式、4K/HDR 或全硬件无卡顿承诺。

## English summary

- Added a persistent one-click privacy mode for library artwork and hover previews. Active playback, titles, paths and saved screenshots remain visible; this is not encryption.
- Unified desktop branding and toolbar controls, fixed expanded-search window overflow, refined settings alignment and directory permission/removal interactions.
- Improved bounded scan lookups, read/write isolation and playlist paging. External-file refresh and explicit missing-artwork cleanup preserve personal library data and protect offline roots, source references, rollback snapshots and active readers.
- Moved expensive storage preflight out of playback-control locks while retaining final reference/identity checks and allowing unrelated original-file reads. Added bounded startup and durable-save diagnostics without weakening playback quality or persistence.
- Both portable formats are built and checked locally before manual publication. Prefer the extracted folder ZIP for everyday use. Preserve and back up your data before upgrading; sample-based acceptance does not establish universal codec, hardware, HDR or long-duration performance. MPV binaries are not distributed.
