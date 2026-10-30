# 缺失色彩标记的 MPV 播放修复

本记录取代 45 中“缺失标记必须拒绝播放”的准入策略。此前把带完整 BT.709 标签的验收样本范围直接用于用户文件，导致原生宿主启动前就拒绝大量普通视频。

## 实现

- 后端仍读取流与首个解码帧，保留明确标签并检查冲突；缺失字段原样作为 `unknown` 传递，不填充 BT.709，不写回文件。
- 宿主允许未知字段由 libmpv 自动解释，不强制把自动推断的 BT.601 矩阵当作错误。明确提供的 BT.709 标签仍检查一致性。
- 已知 PQ、HLG 和动态 HDR 仍禁止进入当前 SDR 输出；宿主运行时发现 PQ/HLG 也会在呈现前拒绝。解码帧中的动态 HDR 侧数据纳入检查。
- 保持原尺寸和 8/10-bit 解码，沿用 RGBA16F 共享纹理，无文件转码或浏览器回退。播放信息显示“源色彩标记不完整 · MPV 自动解释”，不把自动解释宣称为已验证源色彩。
- 此次只放宽缺失字段；其他明确色彩组合、像素格式、尺寸预算、旋转及像素比例的原有支持范围没有扩展。

## 验证

后端 `tests.test_native_render_source` 与 `tests.test_native_playback` 共 14 项通过；前端与 Electron TypeScript 构建通过。宿主重新编译，使用新的本地运行库目录 `render-replayed-candidate-O3SKxD`，未打包或发布应用。

实际开发态 Electron 结果：

| 输入 | 结果报告 | 原生解码与跳播 |
| --- | --- | --- |
| 用户录屏隔离副本，2510×1302，H.264，四项标签缺失 | `build/render-untagged-recording-QHFLQg/report.json` | NV12；10 秒目标呈现于 10.0333 秒；继续播放成功 |
| 自有无标签 H.264，640×360 | `build/render-unverified-color-7NOxnj/report.json` | NV12；mpv 自动解释为 BT.601 矩阵；8 秒跳播成功 |
| 自有无标签 H.264，352×288 | `build/render-unverified-color-oszFmk/report.json` | NV12；BT.601 矩阵；8 秒跳播成功 |
| 自有部分标签 HEVC，640×360，10-bit | `build/render-unverified-color-6L0I0O/report.json` | P010 保留 10-bit；8 秒跳播成功 |
| 自有完整 BT.709 标签 H.264，640×360 | `build/render-unverified-color-YEvEzs/report.json` | 原有标签路径正常；8 秒跳播成功 |

这些检查包含原生呈现序号增长、跳播完成的 GPU 帧回执及合成器画面变化、单次源加载、无 HTML video 回退、退出后原生会话关闭。原文件 SHA256 与修改时间不变；真实录屏宿主日志确认进程退出、读租约释放及纹理导入/释放配平。

用户录屏属于真实媒体，其他四项为明确生成的回归样本。画面变化与时间回执不等于像素编码帧号证明，也不构成物理显示器色彩准确性或全媒体兼容性验收。

保留失败记录：首次沙箱中 Electron 未启动；`render-untagged-recording-o7YL7f` 已完成播放和跳播，但测试过早检查异步退出状态，改为等待关闭后通过；`render-app-flow-8ZSV5X` 的广泛控件测试卡在鼠标唤起控件的 class 断言，未通过；`render-unverified-color-nPo3Mc` 的“完整标签”生成参数未实际写全 VUI，修正生成参数后通过。没有为这些测试修改产品控件行为。
