# AVHub 0.2.11

## 播放与操作体验

- 新增鼠标前进 / 后退侧键跳播，默认 5 秒，可在播放偏好设置为 1–120 秒；键盘和控制栏步长不变。
- 统一菜单、弹窗及文本编辑时的快捷键拦截，修复菜单打开时鼠标侧键仍会跳播的问题。
- 鼠标点击播放控件后空格仍控制播放暂停；Tab 聚焦按钮时保留按钮的原生空格操作，窗口置顶按钮不再误触播放。
- 片单的播放模式与连播开关改为本次会话独立状态，切换视频和刷新后保留，不覆盖全局偏好。
- 封面墙外部播放入口移至文件大小行右侧的小图标，点击直接调用系统播放器，不弹确认或成功提示；离线时禁用，打开失败时保留反馈。
- 可编辑文本框新增原生右键编辑菜单，支持撤销、重做、剪切、复制、粘贴和全选；不后台读取剪贴板。

## 媒体库与界面

- 统一视频、剧集分组和单集列表的标题、结果统计与筛选摘要；长路径标签适配可用宽度。
- 窄窗口的更多筛选和批量整理使用图标，保留悬停说明、键盘操作及已启用状态。
- 分辨率筛选图标、设置输入控件高度与鼠标帮助图标统一；全部分辨率标签使用“全部”。
- 无错误的扫描完成提示约 5 秒后自动收起；有异常的结果保留，便于查看。
- 补齐鼠标侧键时长和待添加目录的未保存保护，切换设置分类保留草稿；关闭设置可取消放弃修改。
- 退出整个应用时统一使用一次原生确认，避免网页确认与原生退出确认重复出现。

## 验证与升级

- 完成本地前端 / Electron 构建、后端回归，以及深浅色、窄窗口、菜单、焦点、跳播快捷键、片单和退出生命周期的 UI 回归复核。
- 真实 Electron 使用隔离合成视频验证侧键事件、无源重载、暂停状态、设置重启保存、片单偏好隔离、取消退出保留草稿及外部播放器路径分发。
- 物理鼠标及驱动映射未进行硬件验收；外部播放器启动在测试中拦截，验证系统调用但不启动用户应用。新增界面与交互不改变编码、转码策略或原视频文件。
- 更新原生验收脚本的异步剪贴板恢复与隐藏控件操作步骤，并加入 GitHub Actions 回归。
- 修正云端纯净播放悬停测试的布局时序：等待模式和实际尺寸切换后再定位鼠标，保留静止悬停不隐藏的断言，并增加延迟窗口状态的回归用例。未修改播放器隐藏策略。
- 升级前关闭旧版并备份数据，保留 `AVHub-data` 与 `avhub-data-location.json`。文件夹便携版请完整解压后运行 `AVHub.exe`，不要只替换单个 EXE；可使用 `SHA256SUMS.txt` 校验下载文件。

## English

- Mouse forward/back buttons seek by 5 seconds by default, configurable from 1 to 120 seconds without changing keyboard or control-bar increments.
- Menus, dialogs and text editing consistently block playback shortcuts. Space preserves native button activation after keyboard navigation while retaining playback control after mouse-clicked player controls.
- Playlist mode and autoplay are session-local, survive item changes and reloads, and do not overwrite global playback preferences.
- The cover-wall external-player action is now a compact icon on the right of the file-size row. It opens directly without confirmation or success notifications; unavailable files are disabled and failures remain visible.
- Editable text fields support native undo, redo, cut, copy, paste and select-all context menus, without background clipboard access.
- Library headings, filters, compact-window actions, resolution labels and settings fields are visually consistent. Successful scan results collapse automatically; results containing errors remain visible.
- Unsaved settings drafts are protected. Application shutdown uses a single native confirmation instead of duplicate renderer/native prompts.
- Local renderer and backend regressions and real Electron synthetic-media acceptance were performed. Physical mouse hardware was not tested, and external-player dispatch was intercepted rather than launching a user application. Source media and playback encoding policies are unchanged.
- Cloud hover tests now wait for actual pure-mode geometry before positioning the mouse, with a delayed-window-state regression and unchanged stationary-hover assertions. Application hide behavior is unchanged.
- Before upgrading, close AVHub and preserve library data and data-location configuration. Fully extract the folder ZIP and retain its runtime dependencies; verify downloads with `SHA256SUMS.txt`.
