# AVHub 0.2.13

## 文件整理与系统回收记录

- 包含此前尚未正式发布的文件整理功能：目录分别授权、单文件重命名同步默认标题、批量移入 Windows 系统回收站；保留媒体 ID、收藏、进度及片单，不提供批量重命名或重命名撤销。
- 批量整理右侧新增回收记录入口，支持搜索、分页、当前页全选与反选、单项及批量恢复、进度和部分失败结果。失败项可定位到实际所在页面重新核对。
- 恢复仅针对应用记录中唯一匹配的系统回收项目，拒绝覆盖原位置文件。应用不创建视频回收副本，不清空整个系统回收站。
- 永久删除需单独开启目录权限并再次确认，默认关闭且不继承系统回收权限；只处理选中且身份匹配的应用回收记录。清理已恢复或已核对不存在的历史记录不会删除磁盘文件。
- 批量任务可停止后续项目；预检停止不继续确认或执行。超时、中断或结果不确定时进入待核对状态，不自动重试、恢复或永久删除。
- 操作意图持久化，重启只做只读核对；系统操作成功而数据库尚未提交时保留恢复依据。原生系统回收助手按需复用、闲置释放，大批量操作复用受限快照，避免重复遍历回收站。

## 媒体库身份与界面

- 扫描记录文件身份。在受支持的本地固定 NTFS 磁盘上，明确且唯一的同卷外部重命名保留个人数据；默认标题随文件名变化，自定义标题保留，同目录外挂字幕关联不改动字幕文件。
- 同路径视频被替换或内容信息改变时暂停沿用旧信息，数据管理提供“保留原媒体信息”或“作为新视频”的明确选择。新视频不继承旧收藏、进度、标签或片单引用；无法证明身份的情况不自动合并。
- 身份检测基于文件系统标识与大小、修改时间，不进行全视频哈希；跨卷移动、硬链接、离线目录等不承诺自动关联。
- “筛选 X 项”、条件标签及清空操作统一收至“更多筛选”，默认收起，兼顾剧集、窄窗口及深浅色界面。
- 回收记录、源文件变化和文件状态面板使用统一确认框、选择状态、错误展示与焦点逻辑；成功提示自动消失。

## 稳定性与验证

- 修复正式发布测试在设置操作尚未完成时退出 Electron 导致挂起的问题；成功判定包含真实进程关闭，并增加退出超时诊断，不移除应用忙碌保护。
- 补齐后端、渲染器交互与深浅色回归，以及真实 Electron 系统回收、外部重命名、源文件替换和重启恢复验收，纳入 GitHub Actions。
- 文件操作验收只使用独立生成的临时样本。真实媒体库基线仅复制读取索引，不修改用户视频；测试计时不代表所有硬件上的保证。
- 本轮不改变原画优先播放策略，不降低分辨率、质量、位深或色彩信息，不增加自动有损转换。
- 发布继续提供单文件便携 EXE 与解压即用文件夹 ZIP。更新前退出应用并备份数据目录；数据库备份不包含原视频，下载可用 SHA256SUMS.txt 校验。

## English summary

- Includes the previously unreleased opt-in file organization features: single-file renaming with title synchronization, metadata preservation and selected Windows recycling. No batch renaming, rename undo or application-owned video trash copies.
- Adds searchable, paginated recycle records with page selection, scoped restoration, separately authorized and confirmed permanent deletion, progress, cancellation and explicit reconciliation of uncertain outcomes. Unrelated system-bin items are never cleared.
- Preserves identity for provable same-volume NTFS external renames. Source replacement requires an explicit keep-metadata or new-video decision; ambiguous identities are not silently merged. Identity checks use filesystem metadata, not full-content hashing.
- Consolidates active filter summaries inside More filters and unifies recovery/source-change UI across light and dark themes.
- Fixes the release acceptance hang by waiting for settings work to settle and verifying real Electron shutdown. Adds native recovery and source-identity regression coverage. Original-quality playback remains unchanged.
- Releases provide both portable EXE and extractable folder ZIP. Back up application data before upgrading; library backups do not contain source videos.
