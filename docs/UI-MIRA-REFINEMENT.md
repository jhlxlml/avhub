# AVHub 桌面 UI/UX：Mira 设计语言改造

后续精修记录见 [播放器反馈与操作细节](UI-MIRA-FOLLOWUP.md)，以下为首轮改造记录。

## 判断与边界

Mira 适合媒体库：紧凑、适合高密度桌面界面，不需要用大标题、营销区块或大量
留白撑页面。采用中性灰、克制的鸢尾色强调、系统中文字体、细描边、较小圆角。
浅色和深色是同一套语义，不是把深色界面简单反色。

官方依据：[Mira 的定位](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create)、
[源码组件模式](https://ui.shadcn.com/docs)、[手动集成](https://ui.shadcn.com/docs/installation/manual)。

这不是运行一次 CLI 覆盖所有业务代码：实际接入本地改造的 shadcn radix-mira
Button、CVA/Slot、Tailwind 构建及统一 Lucide SVG。已有 Button/IconButton 调用
通过适配层进入基础组件；原生表单、复杂弹窗与播放器仍保留经回归的业务结构。
不能宣称所有组件已经换成 Radix，也不靠换库本身宣称性能提升。

## 梳理结果与本轮处理

| 范围 | 发现的问题 | 处理 |
|---|---|---|
| 全局视觉 | 多代灰蓝色、局部硬编码、圆角/边界层级不同 | 共享深浅语义色，7px 控件 / 12px 面板 / 9px 封面 |
| 图标 | 手绘分支多，描边与视觉重量不一 | 同一 Lucide 家族、24px 网格、1.75 描边；两种播放引擎共用 |
| 操作层级 | 默认、主要、危险按钮缺少组件级约束 | 本地 Mira 组件提供 outline/primary/ghost/destructive 和 size |
| 媒体库 | 工具视觉重量过高，窄窗换行挤占封面 | 压缩工具密度、统一分段控件，保留可调封面大小与懒加载 |
| 小窗口 | 608×400 时品牌/操作/分类占三行，筛选再多次换行 | 品牌与图标操作共用一行；目录弹性宽度，刷新图标保留名称和提示 |
| 设置 | 多层卡片与间距不一致 | 紧凑侧栏/窄窗标签、统一表单和分区面板；补充设置对话框描述关联 |
| 片单 | 样式与媒体库不同，说明容易误解为应用永不改文件 | 同一面板/字体体系；说明改为“片单操作仅修改列表” |
| 菜单/通知 | 密度与阴影、关闭按钮大小不同 | 统一间距/边界；保留菜单避让屏幕、恢复焦点和通知关闭机制 |
| 播放器 | 普通界面主题与原生面板之间不同 | 共用图标，视频叠层固定暗色；原生面板也使用影院语义色 |
| 动效 | 非必要过渡与大范围背景模糊 | 控件仅短颜色过渡；减少模糊，尊重 reduced-motion |

## 保留的交互约束

- 不改变解码、封装、原画/颜色/位深、跳播或后台提交策略。
- 不改视频元素的滤镜/透明度/变换；主题切换不重建播放器或重载源。
- 控制区透明、不增加渐变和明边框；鼠标隐藏、控制区停留、暂停/纯净播放沿用。
- 全屏弹层保持在全屏元素内，不用默认 portal 把字幕菜单送到播放器外。
- 嵌套确认、未保存保护、Escape/Tab、文件权限和系统回收语义保留。
- 为桌面操作适配 32/36px 基础点击区，不照搬 Mira 默认的 28px；特殊关闭/行内
  操作有更小尺寸，不能宣称全应用达到 44px 触控目标。
- 无远程字体、图标 CDN 或运行时 UI 请求，仍可离线使用。

## 维护方式

- `frontend/src/components/ui/button.tsx`：本地拥有的基础组件，MIT 来源声明保留。
- `frontend/src/lib/utils.ts`：共享类名合并；`components.json`/Vite/TS 配置提供路径。
- `frontend/src/design-system.css` 与 `appearance.css`：深色/浅色语义变量及影院隔离。
- `frontend/src/mira.css`：本次设计规范与已有类名的兼容桥。不引入 Tailwind preflight；
  只扫描 owned UI primitives，不扫描视频名称、缓存或历史网页归档。
- 旧模块 CSS 仍存在，不能声称已全部删除。新增外观应进入上述共享体系，不再
  复制一组局部颜色；后续可逐模块迁移并移除被兼容桥取代的规则。
- 新组件放到子目录后，构建指纹同步改为递归纳入前端/Electron 源码；app/static
  产物不参与自引用。Python 与 Node 使用同一文件集合，有隔离回归。
- UI 第三方许可随静态产物携带 `third-party-ui-licenses.txt`。

不修改历史网页归档，不升级应用版本，不打包或推送。

## 依赖与已知边界

新增 UI 依赖均锁定版本。安装后的 npm audit 仍报告 11 项（8 moderate、3 high），
列出的链路属于 Vite、electron-builder 等构建工具及其传递依赖，没有列出新增
UI 包。没有执行可能改变 Electron 打包行为的 `npm audit fix --force`；这是后续
独立的依赖维护项，不能把本轮称为“零漏洞”。

本次验收使用隔离生成媒体，不读取或修改 E:\downloads。组件 harness 不代替真实
Electron；原生视频像素与多屏物理显示不由 UI 截图保证。

## 验收记录

后续用户报告的起播错误已单独复现并修复，见
[唯一音轨记忆与原片起播](SOLE-AUDIO-ORIGINAL-PLAYBACK-FIX.md)。以下 UI 验收记录
保留其原始构建与范围，不能代替该后续播放组合的验证。

最终构建：`6fc41fc0afd4cd9f`，应用版本未变。前端与 Electron TypeScript 编译通过，
Python/Node 构建指纹一致。静态产物包含 UI 许可证，历史归档无修改，diff 检查通过
（既有 build-windows.ps1 LF/CRLF 提示保留）。既有 Vite 配置加载和 HLS 大分块警告
仍在，不是零告警构建。

- UI/UX 定向组件/解码 harness **77 项通过**（2.3 分钟）：深浅主题、对比度、
  320/390/608/760 等尺寸、统一图标、全屏图标、未保存确认、键盘焦点、菜单边界、
  控制区隐藏/停留、主题切换不重载视频、播放记忆与进度失败重试、退出保护。
- 真实 Electron 媒体库工作流通过；最终截图目录
  `build/electron-library-refinement-k8X4uw/`：宽窄布局、设置、片单操作/并发保护、
  深浅主题，生成源哈希/修改时间不变，无页面错误。
  `library-mira-dark.png` / `library-mira-light.png` 与对应 `settings-mira-*.png`
  是干净界面；更早的中间截图和失败记录仍保留。
- 真实 Electron + MPV 独立窗口工作流通过：
  `build/native-independent-69MoKY/`。控制、跳播、截图、保存和关闭路径的功能结果，
  **不是物理视频画面合成、HDR 或真实大文件性能结论**。
- 新增构建指纹隔离测试 1 项通过；CI 配置契约 8 项通过。没有把上一轮后端全量
  结果当作本轮重新跑过；本轮未重跑完整后端套件。

### 未完成的桌面验收

完整 `electron/test/window-mode.mjs` **未完整通过**。早期 608×400 的首排封面被
挤出屏幕问题已修正，并有最终组件回归和真实 Electron 可见性检查。验收脚本也
修正了屏幕外封面必须提前解码、固定坐标落在控制区内、强制扩大窗口不移动原坐标、
固定大屏最小尺寸等假设，仍保留实际滚动/严格边界/精确还原断言。

最后一次 `build/window-mode-result-electron-window-mode-VKH8SG.json` 仍在原生滚动条
拖动检查失败。运行中观察到小工作区与 DPI/隐藏窗口尺寸变化，但不足以断言全部
失败都只是环境问题，也没有排除窗口交互问题。故不报告完整纯净窗口回归通过，
不为通过测试而修改生产窗口逻辑。正常交互桌面上的纯净播放、原生滚动条、多屏
DPI 仍需补验；组件 harness 不能取代它。

最初新增的两项键盘可见焦点测试也失败过：测试用了程序 focus 模拟 Tab；改为
实际 Tab 导航后通过，未给鼠标操作强加焦点框。组件测试仍出现 Windows asyncio
连接重置日志，最终 77 项无失败；保留日志，不把它描述成已定位修复的产品问题。

```powershell
npm run electron:dev
npx playwright test tests/ui/mira-design.spec.ts tests/ui/design-system.spec.ts tests/ui/ui-refinement.spec.ts
node electron/test/library-refinement.mjs
node electron/test/native-independent.mjs
python scripts/python-runtime.py -m unittest discover -s tests -p test_build_fingerprint.py
```
