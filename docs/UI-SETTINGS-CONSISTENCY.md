# 设置 UI 统一：开关、字段与任务摘要

最终构建 `238221c0ac2951d2`，版本不变。沿用 Mira/Lucide 与现有深浅主题，未改
播放链路、原画策略、权限接口或文件操作服务；未打包、推送或修改冻结归档。

## 本轮范围

- 新增仅负责展示的 `SettingToggle`：文本与说明在左，原生 checkbox 语义的开关
  在右。封面预览、视频连播、MKV 准备共用组件；目录权限复用相同开关样式。
  保留 Space 键、焦点、禁用和辅助技术语义；不把偏好写入放进展示组件。
- 连播倒计时说明就近展示，设置保存/片单队列隔离说明保留。MKV 准备默认关闭、
  占用空间、收益不保证以及关闭后行为的说明保留，不更改任何自动回退策略。
- 后台封面的暂停/恢复操作移到标题同行，摘要改为简洁文字与语义状态点；状态仍
  明确展示文字，异常与失败未隐藏。其他任务面板的摘要不受这组局部样式影响。
- 起播方式、播放引擎和鼠标时长统一 32px 字段与对齐，解除旧 360px 宽度限制；
  窄窗口标签/字段改为上下排列。统一说明字号与行距，保存与未保存保护不变。

## 验证

- 初始构建 `7fa6677eb7db1dbd` 上 55 项回归通过（2.0 分钟）：设置、目录权限、
  连播、鼠标跳播、MKV 准备、截图草稿、快捷键与媒体库操作。
- 人工查看真实桌面截图发现旧字段宽度残留，修正后最终构建再跑 18 项通过
  （20.0 秒），包含深浅/390px/1440px、同列对齐断言、默认关闭、键盘 Space、
  重启持久化、未保存保护、菜单和 MPV 缺失提示。不把重复测试累加成独立用例。
- 最终真实 Electron：`build/electron-library-refinement-jcVFxE/`。新增实际操作
  封面预览开关并恢复原值、开关尺寸和起播字段检查，保留目录保护、主题、片单、
  播放失败重试及生成视频实际解码。页面错误为空，隔离生成源哈希/修改时间不变。
  已查看 `playback-preferences-mira-light.png`；与组件深浅/窄窗截图一起保留在 build。
- TypeScript/Vite 与 diff 检查通过。既有 Vite 配置加载方式/HLS 大分块及换行符
  警告未在本轮处理。浏览器仅是组件 harness，不替代真实桌面验收。

本轮不宣称完整设置模块已全部重构；数据管理、帮助等其余密集区域仍可继续精修。
未重新验收多屏 DPI，也未宣称解决搁置的特定片源流畅度问题。

```powershell
npm run electron:dev
npx playwright test tests/ui/settings-consistency.spec.ts tests/ui/directory-settings.spec.ts tests/ui/interaction-refinement.spec.ts tests/ui/native-runtime-message.spec.ts
node electron/test/library-refinement.mjs
```
