# 媒体目录设置：紧凑列表与按需权限

构建 `7fc7f2595e1822c3`，版本保持不变。本轮仅重构设置中的目录列表，未改播放
链路、视频内容、文件操作服务、授权规则或归档，未打包、发布或推送。

## 界面与交互

- 去掉目录项的独立卡片边框，改为细分隔线列表。名称、完整路径、扫描与更多操作
  集中在主行；状态摘要和“文件权限”在次行。长路径省略显示，title 保留完整路径。
- 默认收起权限；未知权限明确显示“权限暂未读取”，不把未读取状态当成确认只读。
  已授权项在摘要中列出，离线状态与重新定位入口保持可见。
- 展开后显示统一的开关行（原生 checkbox 保留键盘/辅助技术语义），权限标题、
  说明与开关对齐。永久删除分隔并使用危险语义色，无法恢复的说明及逐次确认保留。
- 扫描使用统一图标按钮；移除操作进入更多菜单并命名为“移出媒体库”，明确说明
  仅影响索引，不删除原视频。保留移除预览、确认及错误处理。
- 菜单使用已有定位逻辑限制在窗口内，支持方向键、Tab、外部点击和 Escape。
  Escape 先关闭菜单，不顺带关闭设置；授权确认所在的模态层优先。
- 取消移出确认后，等待父级忙碌锁解除再返回触发按钮，修复锁定期间恢复焦点失败。
  深浅色及窄窗口均使用现有 Mira/Lucide 语义样式。

## 验证

- TypeScript/Vite 构建、`git diff --check` 通过；原有 Vite 配置加载/HLS 大分块及
  build-windows.ps1 换行符警告保留。
- 35 项设置、文件权限、源变更、扫描、封面任务、设计系统与反馈组件回归通过
  （48.0 秒）。随后补充超长目录路径与菜单 Tab 退出用例，目录设置 7 项重跑通过。
  共 36 个不同用例，浏览器仅为显式组件 harness。
- 真实 Electron：`build/electron-library-refinement-2mJ24c/`。确认权限默认折叠、
  应用目录内生成样本仍被保护为只读、菜单 Escape、移出确认取消；保留片单、主题、
  错误重试和实际生成视频解码回归。生成源哈希/修改时间不变，页面错误为空。
  已查看 `settings-mira-light.png` 与组件深浅/窄窗截图。
- `node electron/test/file-management.mjs` 通过：在唯一创建的 TEMP 样本上实际点击
  展开的权限并确认授权，验证默认拒绝、可信 IPC、重命名、系统回收及精确恢复、
  持久化和正常退出。视频和字幕内容哈希不变；未访问用户媒体进行写操作。
  该脚本关闭 GPU，不用其结果宣称播放性能。

既有测试按新入口更新（先展开文件权限、通过更多菜单移出目录），没有删除安全
断言或为了通过测试放宽受保护目录。完整多屏 DPI 及既有片源性能问题不在本轮范围。

```powershell
npm run electron:dev
npx playwright test tests/ui/directory-settings.spec.ts tests/ui/file-management.spec.ts tests/ui/source-changes.spec.ts tests/ui/library.spec.ts tests/ui/mira-followup.spec.ts tests/ui/thumbnail-tasks.spec.ts tests/ui/design-system.spec.ts
node electron/test/library-refinement.mjs
node electron/test/file-management.mjs
```
