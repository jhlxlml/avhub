# Mira UI/UX 精修：播放器反馈与操作细节

后续目录树与键盘交互精修见 [UI-MIRA-NAVIGATION.md](UI-MIRA-NAVIGATION.md)。

本轮最终构建 `38c9b1367f50134d`，版本不变。保持上一轮 Mira/Lucide 方向，不重写
解码或文件服务，不触碰归档，不打包、不推送。

## 完成项

- 播放准备、续播、错误和结束提示共用紧凑卡片：最大 480 CSS px，长说明换行，
  短窗口保留内部滚动，按钮不被挤扁。错误本身和重试/许可确认不会被隐藏。
- Chromium 设置弹层与已有原生面板统一圆角、描边、间距与字段尺寸；移除弹层的
  模糊及入场动画。画面控制栏仍透明、无渐变，不改视频滤镜、透明度或解码器。
- 永久删除权限使用危险语义色，保留明确文字；复选框默认值、授权范围和二次确认
  完全不变，不把颜色替代风险说明。
- 分页按钮接入共享 Mira 组件，增加命名的 navigation 区域；保留 Enter 跳转与页数
  边界，加载时同时禁用页码框及提交，空输入禁用跳转。
- 全局通知靠右下紧凑排列，窄窗不出界。成功自动消失、错误保持、恢复提示停留与
  聚焦时暂停计时的规则不变；不宣称所有情况下都不覆盖底部内容。
- 无音轨的视频不再显示“仅兼容音轨”这个无意义选项。有音轨视频仍保留该入口和
  明确的有损音频确认，没有改变转换许可策略。

## 验证与限制

精修主构建 e75e4b12308e2ff1 上，45 项播放/主题/焦点/音轨/原画保护回归及 29 项
分页/通知/风险权限/片单/回收反馈回归通过，共 74 个不同用例。最后“无音轨选项”
调整后，最终构建再跑相关 28 项全部通过（45.9 秒）。未把重复执行累加成更多用例，
也未宣称本轮执行过完整后端套件。

新增 `tests/ui/mira-followup.spec.ts` 覆盖深浅风险提示、640/1440 播放失败卡与实际
重试解码、分页 Enter、390/1440 通知边界及自动消失。浏览器运行仅是组件/解码
harness，不替代以下真实桌面检查。

真实 Electron 工作流通过：`build/electron-library-refinement-AnattJ/`。除了媒体库
与片单，还加入生成静音视频的可控错误（故障注入，非真实片源故障）、无音轨时
无音频转换按钮、实际点击重试解码、深浅画质弹层、主题切换同一视频源验证。
生成源哈希/修改时间不变、页面错误为空。截图包括：

- `player-error-mira-light.png`
- `player-settings-mira-light.png` / `player-settings-mira-dark.png`
- `settings-mira-light.png` / `settings-mira-dark.png`

用户此前报错的已授权 4K AV1 原片也在最终构建复测，证据为
`build/original-startup-HcDlBU/report.json`。无音轨记忆与记忆唯一音轨两种状态均
3840×2160 原文件直放，15/35 秒目标处有实际 rVFC 呈现帧，每种状态单次播放请求、
同一源，不开启视频或音频转码。源 SHA-256/大小/修改时间一致。起播仍有丢帧统计，
因此这是正确性检查，不是 4K60 全程无丢帧或物理显示验收。

前端编译及 diff 检查通过；既有 Vite 配置/大分块和 LF/CRLF 警告保留。上一轮
完整纯净窗口/多屏 DPI 未通过项没有在本轮重新验收或关闭。

```powershell
npm run electron:dev
npx playwright test tests/ui/mira-followup.spec.ts tests/ui/fullscreen-icon.spec.ts tests/ui/media-playback-memory.spec.ts tests/ui/native-quality.spec.ts
node electron/test/library-refinement.mjs
node electron/test/real-original-startup.mjs "<已授权原片路径>" --expect-original
```
