# 内容反馈与加载状态统一

日期：2026-10-22。最终构建：`8bb47db036407d45`；未打包、未发布、未提升版本。

## 实施

- 新增共享 ContentState，统一内容区加载、空态和错误的图标、文字层级、间距、主题和重试区。错误为 alert，加载为 status/aria-busy；真实空态不作为实时警报播报。支持减少动画偏好。
- 媒体库、剧集库沿用原缓存与加载提示延迟，替换反馈外观；后台读取失败仍保留已有结果，不通过隐藏缓冲或旧画面伪造性能改善。
- 播放列表新增独立目录读取状态和并发读取计数。读取完成前不显示“创建或选择一个列表”；首次或详情读取失败时不再同时显示空态。错误与刷新按钮位于内容区，键盘可聚焦重试；有既有内容时保留内容和独立错误反馈。
- 区分空片单、搜索无结果、未创建片单，提供相应下一步说明。已有播放、顺序、离线、批量移除与撤销语义保持不变。
- 空态图标去除装饰边框并统一主题；移除不再使用的 playlist-empty 布局规则。

## 验收

- 构建及 diff 检查通过，冻结网页归档未修改。
- 65 项相关组件/解码器 harness 通过，涵盖 content-feedback、playlists-design、navigation、ui-refinement、library、library-transitions、interaction-system、iteration-eight。
- 最后仅调整片单初始错误区域的位置，最终构建再次通过 20 项 content-feedback/playlists-design/library-transitions 回归。新增断言确认错误在内容区上方，不被大块空白挤到弹窗底部。
- 真实 Electron `library-refinement.mjs` 最终构建通过，证据位于本地 `build/electron-library-refinement-0aey6R/`。新增受控慢读取/失败注入、禁止误显示空态、Enter 重试并恢复实际 API 空结果；已有片单操作、主题、设置、真实解码和退出流程通过，合成源文件 hash/mtime 不变，无页面异常。
- 已查看窄窗错误截图；反馈区域、操作和底部完成按钮均可见。受控错误仅为隔离验收注入，不代表真实服务故障。

## 边界

本轮未修改播放引擎、质量策略、文件操作服务或用户视频。E:\downloads 未操作。没有重新验收 MPV 物理叠层、多屏 DPI 或持续 4K 帧率。
现有 Vite 配置加载与 HLS chunk 体积警告保留。仍有部分模块使用已有内联 StatusMessage，旧样式迁移尚未全部完成；后续应按组件迁移而非继续叠加全局覆盖。
