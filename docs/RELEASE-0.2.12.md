# AVHub 0.2.12

## 文件整理

- 视频默认只读。媒体目录设置新增分别授权的文件重命名与 Windows 系统回收；首版只支持非受保护目录的本地固定 NTFS 磁盘。
- 单文件重命名同步视频标题，锁定扩展名、拒绝覆盖同名文件，保留收藏、观看进度、片单和媒体 ID。不提供重命名撤销或批量重命名。
- 重命名时保留同目录外挂字幕关联，不改名、修改或复制字幕。视频或字幕被修改或替换时不继续沿用旧关联。
- 批量选择新增“所选移入回收站”，最多 500 个视频。确认前展示清单、大小和跳过原因；逐项检查目录授权、文件身份及占用，预览快照十分钟有效。
- 批量回收可停止后续任务，当前项仍完成；显示成功、失败、跳过及未执行结果。失败项保留选择，已开始系统回收的项目写入操作记录。
- 仅使用系统回收站，不建立应用视频回收副本，不提供永久删除，也不在回收失败时降级删除。恢复请使用 Windows 回收站；进入回收站不等于立即释放空间。

## 状态、界面与稳定性

- 数据管理新增文件状态与操作记录，区分已回收、文件缺失、待核对和操作中，支持身份核对恢复。
- 普通缺失项可仅移除索引记录及其收藏、进度、片单引用，不碰磁盘文件；已回收及待核对项禁止清理。重新扫描同路径视频作为新记录收录，不复用已清理记录的编号。
- 重命名及回收的成功提示四秒后自动消失；失败原因保留。确认框展示真实文件名、路径、大小、分辨率及封面。
- 应用内确认弹窗统一深浅色样式、焦点、取消和 Escape 行为，覆盖备份、缓存、片单、未保存修改及有损播放确认。系统目录选择、保存与退出仍使用原生窗口。
- 更多操作菜单根据窗口边缘自动定位，必要时向上展开和内部滚动，避免被封面容器裁切或超出窗口。
- 文件整理保护播放、预览、封面生成、无损准备、扫描及备份恢复，记录中断状态；权限按目录绑定，重新定位或恢复备份后需重新授权。
- 修正关闭后迟到心跳重新登记活动的情况，避免无视频打开时仍误判占用。单文件整理也拒绝已变化而尚未刷新索引的源视频。
- 不改变原画优先策略，不降低分辨率、编码质量、位深或色彩信息，不增加自动有损转换。

## 验证与升级注意

- 新增后端、深浅色与窄窗口、停止任务、部分失败及真实 Electron 回归，并纳入 GitHub Actions。
- 文件操作验收只使用独立生成的 GUID 命名临时样本；实际系统回收项目按原路径和唯一名称精确还原并校验字节，不修改用户媒体。Web 视频全屏确认在明确标记的渲染器测试中验收；原生窗口全屏在 Electron 中验收。
- 更新前退出 AVHub 并备份媒体库数据。数据库备份不包含原视频。保留 AVHub-data 和数据目录定位配置；下载后可使用 SHA256SUMS.txt 校验。
- Windows 发布继续提供单文件便携 EXE 和完整解压即用 ZIP。版本更新说明仅在 Releases 发布，不向 README 添加版本历史。

## English summary

- Opt-in local NTFS file organization: single-file renaming updates the title while retaining media identity and personal metadata; same-directory sidecar subtitle associations survive without modifying subtitle files.
- Explicitly selected videos can be recycled serially through Windows, with directory permission checks, ten-minute identity snapshots, stop-after-current semantics and partial-result reporting. Batch renaming, permanent deletion and application-owned video trash copies are not provided.
- File-state management distinguishes recycled, missing and review-required records. Only proven ordinary missing records can be removed from the index; disk files are untouched and removed IDs are not reused.
- Themed confirmations, viewport-safe menus and four-second success toasts improve desktop consistency. Busy-file guards, persistent operation reconciliation and retired playback owners improve safety.
- Original-quality playback policies are unchanged. Acceptance mutations use generated isolated samples only; real recycled samples are uniquely identified, restored and byte-verified. Releases include portable EXE and fully extractable folder ZIP.
