# 普通控件无外框与同级尺寸规范

构建 `99ebbb9a7874562d`，版本不变，不打包、不推送。

- 普通按钮、下拉选项、分段筛选、选中导航与封面大小入口去掉常态外框线，使用
  背景与文字色表达悬停/选中/危险状态。保留透明边框占位，避免状态切换改变布局。
- 工作区与设置主按钮/选择控件为 32px；分段组总高 32px，内部项 28px；目录行内
  次级操作为 28px。文字宽度由内容决定，不强迫不同文字等宽。窄窗导航保持 32px。
- 修复原生旧“浏览本地文件夹”按钮仍为 36px，而共享“添加目录”按钮为 32px 的
  残留差异；两者字号、内边距与高度一致。
- 不移除键盘 focus-visible 提示、不隐藏禁用/错误状态；面板边界与分区分隔线
  不是选项外框，保留。输入框用填色区分，不把复选框、开关、滑条样式一并重置。
- 规则限定普通工作区/模态控件，不对视频画面、原生窗口控件或播放器控制栏做
  全局尺寸重置。播放、授权、偏好保存与文件操作服务未修改，归档未改。

最终构建 40 项组件/解码 harness 回归通过（49.7 秒）：边框颜色与同级高度断言、
深浅模式、键盘焦点、320/390/608/760 窄窗、所有设置分类和画面像素/叠层隔离。
首轮新增断言发现旧按钮 36px 后，修复实际样式并完整重跑，没有放宽尺寸断言。

真实 Electron 工作流通过：`build/electron-library-refinement-zEpLge/`，新增设置
主按钮 32px/透明边框断言；保留权限/确认、目录树、片单、错误重试和实际生成
视频解码，页面错误为空，隔离样本哈希/修改时间不变。已查看 settings-mira-light.png。
浏览器结果仅作组件 harness，不替代桌面验收，不宣称通过完整多屏 DPI 验收。

构建和 diff 检查通过。原有 Vite 配置/HLS 大分块与换行符警告未在本轮处理。

```powershell
npm run electron:dev
npx playwright test tests/ui/borderless-controls.spec.ts tests/ui/mira-design.spec.ts tests/ui/settings-consistency.spec.ts tests/ui/directory-settings.spec.ts tests/ui/ui-refinement.spec.ts tests/ui/appearance.spec.ts
node electron/test/library-refinement.mjs
```
