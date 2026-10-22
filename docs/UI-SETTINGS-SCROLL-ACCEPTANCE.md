# 设置滚动、公共头部与键盘流程验收

用户日期 2026-10-22；最终构建 `a2bd1e86c95c0326`。不升级版本、不打包、不推送；
冻结归档及用户媒体未改。

## 完成

1. 设置使用稳定高度的外层 flex 框架，标题/安全说明/关闭按钮固定，只有正文滚动。
   宽窗口分类常驻左侧；窄窗口采用窗口内的横向分类条，避免短窗口被多行分类占满。
2. 切换分类在布局提交阶段仅复位正文 scrollTop；面板保持挂载，不卸载输入草稿，
   不写偏好、不清除未保存提示。分类重复点击不重置正在浏览的当前位置。
3. 新增公共 DialogHeader，标题和说明 ID 仍用于原 Dialog 的 aria-labelledby/
   aria-describedby。设置框架布局收敛在 settings.css，移除 Mira 中的重复布局与
   移动端 display:block 覆盖，不盲目删除其他历史样式。
4. 公共模态焦点循环允许浏览器揭示被滚出视野的目标；原实现 preventScroll 会让
   Shift+Tab 回绕的末尾控件获得焦点却不可见。summary 纳入可聚焦集合，修复
   原生折叠标题处 Tab 意外回到开头的问题。保留 inert、忙碌锁、Escape 与焦点恢复。

普通操作仍遵守既有无外框/32px 与嵌套 28px 规范，没有重置播放器画面或原生窗口。
修改仅限界面布局与公共焦点规则，未改播放链路、备份/清理或文件授权服务。

## 证据

- TypeScript/Vite 构建与 diff 检查通过，既有配置加载/HLS 大分块及换行符警告保留。
- 62 项不同组件/解码 harness 回归通过（1.4 分钟），覆盖深浅色、390×650、
  608×400、1440×850、滚动/关闭按钮、分类键盘 End 揭示、草稿保留、取消确认、
  焦点回绕、原生折叠项、帮助、备份恢复锁与播放器弹层。旧帮助测试不再禁止分类
  条本身有意的水平滚动，改为断言 overflow-x:auto、容器不溢出及键盘揭示。
- 真实 Electron：`build/electron-library-refinement-E4J6kW/`。实际滚到正文底部，
  标题/关闭按钮仍在 viewport，外层 scrollTop=0；分类切换正文归零。保留媒体库、
  片单、备份/存储、帮助/诊断截图和错误重试实际解码。生成样本哈希/修改时间不变，
  页面错误为空。已查看 settings-fixed-header-scrolled-light.png 和短窗组件截图。
- 真实授权 AV1 原片：`build/original-startup-oEERT4/report.json`。两种音轨记忆状态
  原文件直放 3840×2160，同一源 15/35 秒实际呈现帧通过、转换许可未开启；源文件
  哈希/大小/修改时间不变。存在起播丢帧统计，不据此声称 4K60 无丢帧。

浏览器仅为显式组件 harness，不替代真实桌面。多屏 DPI/MPV 原生叠层物理显示的
完整验收未在本轮关闭；公共组件尚未全部重构，后续清理仍应逐模块带回归推进。

```powershell
npm run electron:dev
npx playwright test tests/ui/settings-scroll.spec.ts tests/ui/interaction-refinement.spec.ts tests/ui/workspace-consistency.spec.ts tests/ui/help.spec.ts tests/ui/interaction-system.spec.ts tests/ui/mira-design.spec.ts tests/ui/iteration-eight.spec.ts tests/ui/full-backup.spec.ts tests/ui/settings-consistency.spec.ts tests/ui/appearance.spec.ts
node electron/test/library-refinement.mjs
```
