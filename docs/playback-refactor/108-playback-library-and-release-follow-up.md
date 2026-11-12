# 1 → 2 → 3 → 4 迭代记录

2026-11-11。基线 HEAD：cc2172bbdd61fd0a6c0dff11aa2f7e712ee981c6。
版本仍为 0.2.20；本轮开发构建 ac489eebb31754b8。未打包、未提交、未推送、未发布。原始视频只读，保留用户根目录 AGENTS.md 和规划文档改动。

## 1. 真实播放与跳播

使用真实 Electron、隔离索引和原始文件，六个视频共完成 144 次快/精确模式跳播，以及 24 组连续请求压力检查，全部通过；每个视频加载次数为 1，目标 GPU 回执与当前请求匹配，原始文件哈希不变。记录 `build/render-library-seek-7AS2i9/report.json`，这是修改前排查基线，不冒充同模式优化后的加速比较。

| 索引 ID / 真实片源 | 快速模式最大 GPU 完成 ms | 精确模式最大 GPU 完成 ms |
| --- | ---: | ---: |
| 1240 / 4K VP9 MKV | 67.9 | 778.7 |
| 195 / 4K VP9 MKV | 56.7 | 857.0 |
| 2378 / 4320×2160 H.264 MP4 | 94.5 | 125.2 |
| 1001 / 4K H.264 TS | 97.6 | 328.3 |
| 1186 / HEVC MP4，约 11 秒 | 108.2 | 122.6 |
| 1384 / 8K AV1 MP4 | 92.3 | 2220.7 |

命令排队通常低于 1ms；慢的精确定位主要发生在重启解码之前。快速关键帧允许数秒落点偏差，未把它当作精确定位。2378 的 MPV 自动选择软件解码，其他样本使用 d3d11va；未关闭硬件加速、强制不支持的硬解、转码或改变画质。HEVC 真实长片样本仍不足。

**修复实际问题**：应用此前声称快速默认，但 settings、RenderPlayer、IndependentPlayer 和旧 NativePlayer 在缺少 mpvSeekPolicy 时仍回退 exact。现将应用入口和控制 UI 的缺省值统一为 fast；用户已保存的 exact/smart 不迁移、不覆盖。底层 MpvClient 的未配置测试调用不改语义。独立控制器的初始主题脚本默认同步。

真实设置回归覆盖两条 MPV 路径，每条分别验证缺省、显式 exact、显式 fast，共六次打开，以及临时切换不覆盖默认：`mpv-seek-settings-cDLLkJ`，PASS/0。本轮不是通过隐藏等待提示加速；未修改等待提示阈值或伪造呈现完成事件。

精确像素/字幕测试现在明确设置 exact，不再依赖隐含默认值。`render-app-flow-EcqLHo` PASS/0；`render-codec-seek-SJZqkf` 四个 HEVC/AV1/SDR10 MKV/MP4 样本各 40 次精确定位及额外关键帧像素验证 PASS/0；`render-ass-seek-XUSwQD` 20 次字幕像素定位 PASS/0。原有精确断言未放宽。

## 2. 已发布成品的 20 分钟并发验证

扩展现有 soak 支持实际 packaged EXE，清除开发运行库覆盖，使用 desktopTestSubject 记录实际 EXE/ASAR/资源身份。运行的是**已发布构建 3b48d95da686b0fd**，不能与上述新默认值修复的源码测试混为一谈。

`build/render-concurrent-soak-oImVRJ/report.json`：PASS/0，1200021ms，106 次资源采样、18 次跳播，最大跳播 GPU 完成约 138ms。后台任务与播放会话同时存在；播放优先时封面生成退让，暂停窗口恢复生成，不声称三项工作始终同时占用解码器。扫描和封面无错误，原文件哈希不变。

| 资源 | 前段中位数 → 后段中位数 |
| --- | --- |
| 原生进程私有内存 | 572432384 → 577511424 bytes |
| 原生句柄 | 877 → 875 |
| Electron 全进程私有内存合计 | 605224 → 671508 KiB |
| 原生 GPU 用量 | 523878400 → 523616256 bytes |

退出：63198 次纹理导入/释放全部配对，时钟请求/释放 25/25，源租约释放，宿主退出。末次采样解码丢帧 0、输出丢帧 39；这是跳播可能重置的当前读数，**不是整段累计**。109 复核确认该记录存在 16 次计数下降，稀疏采样可确认的输出增量下界为 524，不是精确总数。此前对话将 39 称作累计的表述有误，已更正。不宣称零丢帧或全天无泄漏。长测期间同机进行了源码/组件检查及短暂的另一个桌面库测试；并非隔离 OS 性能基准。实体 HDR、多屏与外机验证仍未新增。

## 3. 大媒体库交互

- 修复暖缓存分类/筛选/排序变化后仍停留旧列表深处的行为。按实际查询身份回到首行；播放返回和历史恢复拥有更高优先级，保留其恢复位置逻辑。封面大小/布局等不改变查询的操作不会因此重置。
- 组件回归新增无额外媒体请求的暖分类滚动重置；分类缓存、封面观察器和路由恢复共 22 项 PASS/0（明确是 renderer harness）。
- 改造旧 desktop-library-baseline：移除旧的 disable-gpu/no-sandbox 参数；支持只读索引和最多 288 张真实自动封面的独立复制/哈希记录，所有运行材料位于 build；原视频不复制、不播放。封面路径限制在原缓存内，目标限制在新测试 profile，不跟随链接或绝对路径。
- `build/library-baseline-ReaJQV/baseline.json`：正常可见 Electron，2356 条索引，288 张封面共 5254612 bytes；两次启动约 980/915ms，非冷缓存。暖分类 DOM 提交约 4–33ms；六轮、共 180 次程序化滚动跳转中首张已加载封面没有重取。rAF 最大间隔多为约 32ms，一次约 62.8ms；滚动期间全 Electron 私有内存从约 596232 到 572592 KiB，不据此证明长期无泄漏。程序化跳转不是物理滚轮输入延迟。

保留无效测量：dkQ9nz 原脚本使用 HEADLESS_TEST=1，窗口隐藏造成 rAF 约 1Hz；其功能断言虽通过，滚动流畅度数据无效。改成可见窗口并断言 visibilityState 后重测；不能把 1000ms→32ms 宣称为应用性能提升。

## 4. 本地发布与材料管理

新增统一入口：

```powershell
npm run check:release:plan
npm run check:release:local
node scripts/desktop-release-check.mjs --run --journal=build/release-check-review
# 当前源码必须与目标成品相符，否则失败：
node scripts/desktop-release-check.mjs --run --package-dir=build/release-candidate
```

入口只验证，不打包/提交/推送/上传。它串联双运行库、实际源码材料、保留构建证据；按需再检查当前包凭据和最终字节。失败停止后续阶段，日志与每次尝试独立保留；继续执行会重新验证所有前置条件，且源码在检查期间变化时拒绝 PASS。

三项 runner 契约 PASS/0；`build/release-check-iteration108/journal.json` 当前 source-only 检查 PASS/0。用旧 release-0220-final 凭据检查已改动源码时，current-package-proof 按预期 FAIL/1，后续字节检查未运行；不是本轮旧发布包损坏。

清理前完整比较两个解包目录，首次“完全相同”检查失败，发现正式目录多了打包器生成的 resources/elevate.exe。改用并明确记录“候选所有文件都有正式字节相同副本”的包含关系，688 个文件、763925744 bytes 逻辑大小验证通过。确认固定绝对路径、无 reparse 成员、无候选进程后，只删除 `build/release-0220-acceptance/win-unpacked`。正式目录/EXE/ZIP、源码包、绑定文件、验收报告、原生运行库、对照基线和共享媒体全部保留。记录 `build/release-0220-duplicate-cleanup.json`；不把逻辑字节数冒充实际物理空间净增。

组件服务的 120 秒 MP4、TS 和内嵌字幕 MKV 也已接入共享 recipe；此类测试会改名/删除样本，因此每次使用独立可写副本。首次迁移启动 FAIL/1：池正确拒绝系统 TEMP 下的输出；将隔离测试 profile 移到项目 build 后 22 项通过，没有放宽池校验。

## 汇总与边界

- 当前源码完整播放回归 `playback-regression-vgj0kx`：26 步 PASS/0，无 SKIP/unrun；包括缺省设置和发布 journal。
- 构建、上述像素/字幕、组件及实际桌面验收 PASS/0；git diff --check PASS/0。
- 用户选择的精确模式在长 GOP 8K 文件上仍可能等待约 2 秒，本轮不声称消除所有精确解码成本。
- 本轮没有生成含新修复的安装包，也未更新正式标签；下载的 0.2.20 与当前开发源码是不同构建。首次发布新修复时，必须重新完成对应成品验收并按授权更新版本。

下一步优先实际使用反馈；若继续性能迭代，针对明确的长等待视频/目标位置收集同一请求的解码与 GPU 时间，不做无证据的缓存或解码参数调整。后续可补 HDR/多屏和更多长 HEVC 实片，不能用生成样本替代真实片源结论。
