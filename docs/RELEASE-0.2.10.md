# AVHub 0.2.10

## 媒体库界面

- 分辨率筛选使用与现有界面一致的显示器 / 像素图标；全部分辨率选项统一显示为 `ALL`，保留中文悬停提示和无障碍名称。
- 窄窗口下，“更多筛选”和“批量整理”只显示图标，保留已启用状态、悬停说明和键盘操作。
- 当前筛选条件的数量、可移除标签和“清除全部筛选”统一移到列表标题右侧、结果数量左侧。
- 筛选摘要根据列表实际可用宽度换行；长目录标签省略显示并提供完整路径提示，避免挤压标题与结果统计。
- 普通视频、剧集分组和单集列表共用标题与摘要布局，统一结果统计及更新状态提示。

## 验证与升级

- 完成本地构建、筛选交互 / 键盘焦点回归和隔离合成媒体的真实 Electron 桌面布局验收，覆盖深浅色、紧凑窗口、长目录标签与目录树。
- 本次调整媒体库界面，不改变原文件播放质量或源视频内容。
- 升级前关闭应用并备份媒体库；保留 `AVHub-data` 与 `avhub-data-location.json`。文件夹便携版请完整解压，保留随包运行依赖。

## English

Resolution controls use a consistent display/pixel icon and the `ALL` label. Compact windows show icons for additional filters and batch editing, retaining tooltips, accessible names and active states.

Active filter counts, removable chips and the clear action now sit beside the library heading, immediately before the result count. The summary wraps according to the available library width; long directory labels are truncated with full-path tooltips. Video, grouped-series and episode lists share the same heading, result and update-status layout.

Local verification includes builds, filter interactions and keyboard focus checks, plus real Electron layout acceptance with isolated synthetic media. Original playback quality and source files are unchanged. Close the app before upgrading and preserve library data and data-location configuration.
