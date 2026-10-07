# AVHub 0.2.9

## 媒体库与整理

- 视频不足一页时，总数与分页控件靠列表区域底部；长列表的分页位于最后一排之后，不遮挡卡片。剧集分组和单集分别使用正确计数单位。
- 视频卡片的“更多操作 → 编辑信息与封面”直接打开编辑窗口，无需启动播放；未保存信息有关闭与退出保护。
- 当前搜索、目录、格式、分辨率、观看状态、时长与季条件以摘要展示，可逐项移除或统一清除。保留当前分类 / 剧集并回到第一页，键盘焦点随清除动作恢复。
- 窄窗口采用紧凑分辨率选择器；完善首次使用、空分类、扫描中、筛选无结果及目录离线的提示和操作入口。
- 添加目录后可立即扫描该目录；移除目录前显示路径与影响，并明确原视频不会删除。

## 桌面保存与设置

- 备份和诊断采用原生保存窗口，完成后显示实际路径并可在文件夹中定位；支持明确的取消和失败反馈。
- 导出先完整写入并同步临时文件，再替换目标；取消或传输失败不覆盖旧导出文件。拒绝覆盖应用数据目录、链接目标或不匹配的文件扩展名，完成后回收备份暂存。
- 截图目录草稿在切换设置分类时保留，提供放弃修改和关闭前提醒；保存失败可重试。
- 后台封面与悬停预览归到“媒体目录”，高级播放项归到“播放偏好 → 高级播放设置”。MKV 无损准备仍默认关闭。
- 统一成功、失败和后台任务状态说明，区分排队、暂停、等待播放空闲、等待目录连接与失败待检查；保留重试、取消及关键操作确认。

## 播放列表

- 媒体库支持批量选择后加入已有或新建片单，每次最多 500 条，已有成员不重复加入。新建片单与批量加入在同一事务完成。
- 片单支持跨页多选移除，并可撤销最近一次移除，恢复原来的位置和顺序。
- 列表内容或顺序被后续修改时拒绝过时操作和撤销，避免覆盖新排序。操作只改变片单记录，不改动视频文件。

## 验证与升级

- 两轮迭代完成后端回归、共享界面专项与真实 Electron 验收；新增原生导出、独立编辑、草稿保护、片单批量和并发保护的桌面 CI 验收。
- 本地桌面验收使用隔离的合成媒体，并检查源文件内容与修改时间。未据此宣称真实 HEVC / HDR 或跳播性能改善；正式交付以版本标签 CI 的最终构建、便携包验收结果为准。
- 原画优先、原视频只读和有损转换必须明确确认的规则保持不变。
- 升级前关闭应用并备份媒体库；保留 `AVHub-data` 与 `avhub-data-location.json`。文件夹便携版请完整解压，保留随包运行依赖。

## English

Improves desktop library workflows: bottom-aligned pagination for short pages, direct metadata/artwork editing, removable filter chips with keyboard focus preservation, compact resolution controls, and clearer empty/offline states.

Backups and diagnostics use native save dialogs with completion, cancellation, error and reveal feedback. Exports write and sync a temporary file before replacing the selected destination. Screenshot-directory drafts survive tab changes and warn before dismissal. Background artwork settings are grouped under Media directories; advanced playback options remain explicitly opt-in.

Playlists support atomic batch creation/addition, duplicate skipping, selection across pages, removal and undo of the last removal. Revision checks prevent stale actions from overwriting newer membership or ordering. Source files and original-quality playback are unchanged; lossy compatibility still requires confirmation.

Local checks include isolated synthetic-media Electron acceptance and source-integrity checks. They do not establish real HEVC/HDR or seek-performance improvements. Release artifacts are built and accepted by the stable-tag CI pipeline. Close the app before upgrading and preserve your library data and data-location configuration.
