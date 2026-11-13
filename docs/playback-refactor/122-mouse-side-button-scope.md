# 鼠标前进/后退键的播放范围

2026-11-13，本地源码迭代，仍为 0.2.21。未打包、未提交、未推送。

## 原因和修改

- 普通播放器曾在整个 document 捕获侧键并取消默认行为，未检查事件是否来自视频区域；Electron 主窗口也仅根据 URL 的 video 参数转发系统 app-command。结果是播放页的标题、信息区也可能触发跳播。
- `Player.tsx` 将 DOM 侧键限定到当前 videoWrap，系统转发同样检查实际悬停区域。区域外释放按键仍清理按下状态，避免下次点击失效；区域外事件不取消默认处理。
- sandbox preload 根据真实鼠标位置及 DOM 命中报告是否位于画面/控制区域，只在边界变化时发送布尔 IPC；滚动、页面切换和离开窗口会更新状态。排除独立窗口的说明卡片。主进程只接受当前主窗口顶层发送者；不再仅凭视频页面 URL 拦截 app-command。
- NativePlayerOverlay 现在在侧键按下阶段处理并取消默认导航，兼容 pointer/mouse 两组事件，释放、离开和失焦会清理按下状态。保留 DOM/系统事件的跨通道去重，避免一次侧键跳两次。设置面板、菜单和编辑中的保护保留。
- 独立 MPV 的 MBTN_BACK / MBTN_FORWARD 本来已分别绑定负/正的设置步长，无需改动播放代码；本轮新增真实绑定回归。默认 5 秒，读取现有设置的 1–120 秒。
- 触及的旧 Electron 鼠标测试改用媒体池复用样本，并去掉其旧的 disable-gpu/no-sandbox 启动参数。未修改用户原视频，也未改变画质或解码策略。

## 验证

最终构建 `262490d618ee4a2e`，`npm run build`、`npm run build:electron`、diff/脚本检查 PASS / 0。

| 验证 | 结果 |
| --- | --- |
| `tests/ui/mouse-seek.spec.ts` + `native-player-controls.spec.ts` | PASS，25 项 / 0。包括区域外不取消默认行为、不跳播、跨区松键后下一次仍有效，默认/自定义时长，菜单保护，pointer/mouse/OS 事件去重与旧控制栏回归。组件 harness，不代表实际解码。 |
| `electron/test/mouse-seek.mjs` | PASS / 0。最终运行目录 `build/electron-mouse-seek-pGCr6O`；真实 Electron 普通播放器，CDP 侧键输入、系统 app-command 重放、实际 decoded frame 回调、配置重启保留。视频外系统命令未被拦截，无源加载或 URL 改变。 |
| `electron/test/render-app-flow.mjs`，`AVHUB_TEST_MOUSE_SEEK=1` | PASS / 0，`build/render-app-flow-UoeeWB/report.json`。真实 Electron + libmpv D3D11，前进后像素编码为 135、后退恢复为 10；标题区域的系统命令不拦截，源加载数不变。其余截图、窗口模式、关闭与纹理释放回归通过。 |
| `electron/test/native-independent.mjs` | PASS / 0，`build/native-independent-QB422h/acceptance.json`。真实 Electron 与独立 MPV，通过其生产 input.conf 注入 MBTN_BACK / MBTN_FORWARD，验证 5 秒往返、暂停状态和源加载次数不变；独立窗口其余原生控件回归通过。 |

初次最终组合中的普通播放器附带“连续两次 Space 激活置顶”断言失败：窗口状态写入会临时禁用按钮，第二次输入未明确恢复焦点。保留原失败目录 `build/electron-mouse-seek-LF0SO1`；测试对第二次激活也等待 enabled 并聚焦后重跑通过，没有把这个失败算作侧键或解码缺陷，也未修改置顶产品逻辑。

输入覆盖是 CDP DOM 侧键、系统 app-command 重放和 MPV IPC 的原生绑定注入；未宣称逐个验证实体鼠标驱动。此次保留播放器外原有事件处理，不增加新的历史导航实现。新成品与外机不在本轮范围。
