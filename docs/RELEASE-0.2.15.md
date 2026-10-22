# AVHub 0.2.15

## 统一桌面 UI / UX

- 以本地适配的 shadcn/ui Mira 设计语言统一媒体库、目录树、片单、设置、帮助、诊断与文件整理界面；图标统一为离线 Lucide 家族，协调深浅主题、圆角、间距与文字层级。
- 普通选项去除常态外框线，同层级控件统一高度；优化分页、目录权限、批量工具栏、表单说明、状态反馈与窄窗口布局，保留键盘焦点、危险操作确认和未保存保护。
- 优化弹窗内部滚动、返回后的反馈、队列与最近回收入口，以及设置和目录浏览的键盘操作；修复窗口尺寸持久化的边界与像素舍入协调。

## 媒体库与长期使用

- 引入项目独立、固定校验的 SQLite 3.54.1 运行库，不替换系统 Python 的 SQLite；桌面启动不联网下载，不静默回退到未校验引擎。打包验证唯一 DLL、版本与哈希，并纳入许可说明。
- 改善扫描、封面完成、媒体搜索及观看记忆写入间的协调，补齐数据库连接生命周期、发布屏障与扫描就绪状态；保留原子提交及提交后才确认成功的语义，不降低 SQLite 同步级别换取速度。
- 减少大媒体库搜索的重复扫描，避免在普通启动热路径无条件执行非必要维护；增加保存阶段、后台提交和运行库身份的诊断信息。
- 修复播放记忆保存与页面切换的等待衔接。单音轨记忆与唯一音轨相同时，不再发出冗余选轨请求，避免本可直放的 AV1 MP4 被错误送入不兼容封装路径。

## 文件操作与退出安全

- 修复只读文件预检无响应时阻止应用退出的问题：预检响应头及正文共用 10 秒期限，可取消、关闭或稍后重新预检，不自动重试。
- 取消按请求身份隔离，旧取消不影响新预检；真实重命名、回收、恢复、永久删除和权限写入仍保留退出保护，不使用预检超时强行结束或重放写操作。
- 批量回收与回收记录的预检取消、弹窗关闭和停止反馈更清晰。取消客户端等待不等于撤销已经执行的系统操作，也不承诺中断后端已开始的只读枚举。
- 构建身份覆盖依赖锁、Python 依赖清单、嵌套 UI 源码及原始静态资源，减少前后端或缓存误认旧构建的风险。
- 最近回收验收按实际请求完成状态核对记录，不再用默认 5 秒文字等待代替接口结果；新增有界的回收桥接与枚举/身份核对阶段诊断，不记录视频路径或身份，不自动重试文件写操作。

## 下载、升级与验证边界

- 提供单文件便携 EXE 和解压即用文件夹 ZIP，均内置所需运行环境。日常使用推荐完整解压 ZIP 后启动 AVHub.exe，可避免单文件版每次自解压的开销。
- 升级前退出应用并备份数据目录；保留 AVHub-data 与 avhub-data-location.json。应用备份不包含原视频，发布包不包含用户媒体、数据库或开发缓存。
- 本次采用本地构建、成品验收后手动上传发布，不以 GitHub Actions 成功作为发布依据，也不宣称云端流程已全部通过。发布文件校验清单记录源提交、构建身份、大小与 SHA-256。成品验收涵盖合成旧库升级、观看进度与片单保留、数据目录迁移、生成 H.264 视频真实解码首帧、重启与退出，以及 ZIP 成品的预检卡住、取消和写保护故障注入。
- 默认继续优先原文件、原画播放；必要且支持时仅无损封装，不自动降分辨率、位深、色彩或音频质量。有损兼容播放仍须用户明确确认。
- **本版不分发 MPV 二进制**，源码中的 MPV 能力仍为开发预览；没有解除运行库分发、物理画面、混合 DPI 或 HDR 验收门槛。
- 部分设备/视频的呈现掉帧、历史后台提交长尾以及此前搁置的特定大 MP4 卡顿未宣称彻底解决；生成样本与本地单机测试不构成全格式、全硬件无卡顿承诺。

## English summary

- Unified the desktop library, settings, playlists, directory tools and dialogs with locally adapted Mira primitives and offline Lucide icons, including consistent borderless options, control sizing, keyboard focus and light/dark themes.
- Added a pinned, verified private SQLite 3.54.1 runtime and improved scan, artwork, search, playback-memory and database-lifecycle coordination without weakening durability. System SQLite remains untouched.
- Fixed redundant sole-audio-track selection that could prevent original-file playback. Original quality remains mandatory; lossy compatibility still requires explicit consent.
- Read-only file preflight now has a bounded header/body deadline and request-scoped cancellation. Closing a stalled preview no longer blocks quitting; actual writes remain protected and are never silently retried or permanently deleted as a fallback.
- Both portable formats remain available; the extracted folder ZIP avoids repeated self-extraction. This release is built and validated locally, then uploaded manually, not certified by an all-green Actions run. Packaged checks cover synthetic legacy upgrades, migration, decoded frames, shutdown and cancellable preflight/write protection. The manifest binds downloads to their source commit, build identity and SHA-256. MPV binaries are not distributed. Known frame drops, background-commit tails and the deferred specific MP4 issue are not claimed fixed.
