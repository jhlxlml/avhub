# M1 统一 HTML5 播放接口

基于 M0 工作区副本渐进修改，未重置 HEAD/用户修改，不引入 Cinema OS，不改变媒体库或播放页布局。

## 修改文件与边界

| 文件 | 作用 |
|---|---|
| `frontend/src/playback/types.ts` | MediaSource、PlaybackState、Track、PlaybackEngine；时间/延迟使用秒，音量 0–1 |
| `Html5Delivery.ts` | Hls.js 动态加载、配置、事件归一化、播放列表刷新与释放；保留原缓冲/索引参数 |
| `Html5Engine.ts` | video 控制、状态观察、轨道业务端口、latest seek、超时与幂等销毁 |
| `PlaybackController.ts` | load generation、取消、命令退出屏障、旧状态隔离、共享 dispose promise |
| `EngineSelector.ts` | 新控制器本阶段仅注册 HTML5，不因后缀切换原生引擎 |
| `frontend/src/Player.tsx` | 改用传输模块；开关开启时 play/pause/seek/volume/mute/rate 经 Controller，UI/权限与原业务保持 |
| `NativePlayerSettings.tsx` | 增加一个必要的默认关闭开关，即时反馈、保存失败回滚，下一次打开视频生效 |
| `app/preferences.py` | 新增严格布尔 `playbackControllerEnabled`，不改旧键语义或 SQLite 数据结构 |

媒体 ID 仍由现有 API 解析，原文件路径不传给新 HTML5 接口。URI 仅允许同源对应媒体的
file/prepared，或现有随机 token 的 HLS 路由；不新增远程 URL、文件读取或执行能力。
媒体服务创建/退休 token、源质量许可、索引 seek 计划、进度持久化、字幕转换、队列和
编辑保护继续使用旧业务逻辑。TrackPorts 复用源身份绑定的轨道/延迟服务，不猜测相邻文件。

旧显式 `playerEngine=mpv` 仍走已有 NativePlayerLaunch，未强制关闭或迁移其偏好。
规范中的新 `nativePlaybackEnabled` 和 auto-MPV 策略暂不启用；M2 通过前不注册 MpvEngine。
设置显示“统一播放控制（试验）”，缺失时为 false，开关不更改旧播放引擎。

## 生命周期与可观测性

- 每个 load 有 generation，旧 load 的 promise 在取消时明确拒绝，迟到模块/流事件不附着。
- 新 seek 取消旧 promise，但仍由真实 `seeked` 及目标位置确认；不以赋值或 ACK 标记到达。
- 位置更新按事件合并到约 5 Hz，暂停、轨道/音量与错误事件及时处理，没有常驻轮询。
- dispose 幂等，取消 pending 操作，移除监听、计时器与 HLS 实例；DOM 的旧保存/退休流程保留。
- `data-playback-controller` 为诊断测试标识，不是新可见 UI。

契约单测使用假媒体事件，仅证明接口/竞态，不冒充解码或窗口嵌入。生产类型检查使用
`npm run build` 的 Bundler 配置；Node 契约测试通过现有 tsc 的单独 emit 执行相同模块，
不依赖 TypeScript 7 已不提供的 JS 编译 API。

## 回滚

在播放偏好关闭该开关（或 PATCH `values.playbackControllerEnabled=false`），下次打开
视频绕过新 Controller，恢复原有直接 video 控制。共享传输模块仍保留；若需撤销传输层
迁移，按本阶段差异恢复 Player 的 HLS 区块与模块，参照 M0 的完整源码副本，不能用 git HEAD
覆盖先前用户修改。新增偏好字段可不删除，旧数据格式没有破坏性迁移。

## 结果记录

初轮新路径 direct/TS/remux 与旧路径回归通过；发现新增 checkbox 等待 API 后才变更，
导致点击即时反馈不一致，已改为即时显示、失败回滚并补测试。未通过之前未进入 M2。
最终命令/统计和真实 Electron 开关对照记录追加在本文件及 `benchmarks.md`。

### 最终测试（2026-10-25）

| 命令/范围 | 结果 |
|---|---|
| `npm run build` / `npm run build:electron` | PASS；构建 `6f5b5c90628f1b9d`，未提升应用版本 |
| `npm run test:backend` | 总计 665 项，664 通过、1 跳过；153.782 秒，`build/playback-refactor-20261025/m1-backend.log` |
| `node --test electron/test/playback-engine.test.mjs` | 9/9 PASS；包括取消、旧 load 隔离、seek 竞态/超时、多次 dispose、轨道与 URI 边界 |
| `npx playwright test tests/ui/playback-engine.spec.ts tests/ui/playback-lifecycle.spec.ts tests/ui/playback-upgrade.spec.ts tests/ui/seek-feedback.spec.ts tests/ui/media-playback-memory.spec.ts tests/ui/native-launch-lifecycle.spec.ts tests/ui/native-player-controls.spec.ts --workers=1` | 64/64 PASS；1.4 分钟；`build/playback-refactor-20261025/m1-final-renderer.log` |
| `node electron/test/playback-refactor-benchmark.mjs m1` / `m1-legacy` | 真实 Electron 两侧均完成，三格式各 20 次目标帧确认跳播；源摘要不变、正常退出；见基准文档 |
| `git diff --check` | PASS；仅有既存文件的 Windows 行尾提示 |

Playwright spec 是明确的 renderer/decoder harness，不能替代原生窗口桌面验收；后者单独在 M2
执行。未执行全仓库所有 UI spec，不据此宣称全应用所有功能通过。测试不访问私人源媒体。
本阶段不改变编码、分辨率、位深、色彩或转码许可；flag 默认为关闭，也未修改原生偏好默认值。

M0 起始 117 个脏文件逐项摘要对照：其中仅本阶段预期的 `Player.tsx`、`NativePlayerSettings.tsx`、
`app/preferences.py`、`.github/workflows/windows.yml` 有后续修改；其余原有脏文件保持原样。
测试新增/修改另外列于本阶段和 M2 文档，归档及用户改造方案未修改。

**退出决定：M1 通过。** 下一阶段仅做 M2 PoC；不得把已存在的独立窗口或测试注入的候选
运行库视作正式 MpvEngine/成品交付。真实媒体/硬件性能矩阵尚未齐全，不能切换默认引擎。
