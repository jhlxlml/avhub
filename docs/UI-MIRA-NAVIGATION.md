# Mira UI/UX：目录树与封面操作精修

最终构建 `cc1250dbb8a6ca40`，保持现有版本。未修改播放器、解码、转码许可、
源文件服务或媒体文件；未打包、推送或修改历史归档。

## 实施

- 目录树使用 roving tabindex：Tab 进入一个目录节点，方向键在可见节点间浏览，
  Enter/空格选中；不再依次 Tab 穿过所有目录。折叠、筛选、根目录翻页和子目录
  异步翻页后，仍有一个可返回的 Tab 入口，不强行把正在使用搜索框/分页的焦点抢走。
- 焦点协调只观察当前目录树的 childList，不监听整页，不增加媒体查询或逐帧任务；
  面板隐藏时移除观察器。既有分页、缓存、延迟加载与默认收起规则保留。
- “全部收起”改用同一 Lucide 图标家族的 ChevronsDownUp；没有展开目录时禁用。
  键盘焦点与选中背景保持区别，深浅主题共用语义色。
- 封面大小面板打开后聚焦滑块，方向键/Home/End 可立即使用；Escape 关闭并返回
  触发按钮，Tab 离开或打开其他对话框会收起。隐藏或 inert 背景不截获 Escape。
  面板仍为非模态 group，不强制困住 Tab，也不更改媒体查询、每页数量或画质。
- 键盘聚焦封面时，同步显示收藏和加入片单；离开后恢复默认隐藏。鼠标悬停预览
  不增加播放图标或暗色遮罩，已有收藏状态及挂载的预览画面保持不变。

## 验证

- 前端 TypeScript/Vite 构建及 `git diff --check` 通过。
- 43 个不同组件/解码 harness 用例通过（42.0 秒）：新增导航 5 项，目录树 8 项，
  外观 9 项，收藏稳定性 3 项，交互系统 11 项，上轮 UI 反馈回归 7 项。
  覆盖万级目录有界渲染、翻页焦点、主题持久化、320/390 窄窗与弹窗快捷键冲突。
- 真实 Electron 工作流：`build/electron-library-refinement-mYuyIx/`。加入实际桌面
  的滑块焦点/Tab/Escape、目录树展开收起/Tab 退出、键盘封面动作可见性检查。
  同时保留片单、深浅界面、错误重试与生成视频实际解码；生成源哈希/修改时间
  未变、页面错误为空。`library-keyboard-navigation-light.png` 已人工查看。
- 真实 Electron 原片：`build/original-startup-cwcZ3J/report.json`。此前报错的已授权
  AV1 视频在无音轨记忆、记忆唯一音轨两种状态下均以原文件直放解码 3840×2160；
  15/35 秒实际呈现帧通过，单次播放请求且不换源，不允许视频/音频转码。
  原文件 SHA-256/大小/修改时间不变。起播统计仍有丢帧，不声称 4K60 无丢帧。

浏览器测试只作为组件 harness，不替代上述真实 Electron。未在本轮重新验收完整
多屏 DPI/纯净窗口测试，也未宣称解决此前搁置的特定片源流畅度问题。
既有 Vite 配置加载方式及 HLS 大分块警告保留。

```powershell
npm run electron:dev
npx playwright test tests/ui/mira-navigation.spec.ts tests/ui/directory-tree.spec.ts tests/ui/appearance.spec.ts tests/ui/favorite-stability.spec.ts tests/ui/interaction-system.spec.ts tests/ui/mira-followup.spec.ts
node electron/test/library-refinement.mjs
```
