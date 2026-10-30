# 内存归因与一次性封面观察

## 本轮改动

开发构建 `0.2.16 / 7cd14c5e23c83e2e`，不打包、发布、提交或推送，不升版本。
延续 [上一轮长时验收](EXTENDED-DESKTOP-SOAK-AND-STYLE-OWNERSHIP.md)，不把
附加诊断时的高位工作集直接等同于产品泄漏，也不通过隐藏缓冲提示改善数字。

生产改动只在 `frontend/src/thumbnailVisibility.ts`：图片首次进入预取区后，
先解除其 IntersectionObserver 注册，再通知 React；全部目标处理后断开观察器。
已加载的图片仍保留到页面卸载，不反复移除 src，不强制 GC、不清缓存，也不
降低图片或原视频画质。过期观察器、重复清理和替换目标的迟到回调均有保护。
这减少重复观察/状态回调，不声称解决全部原生内存保留或已经提升了滚动 FPS。

## 诊断入口

- 复用已有无调试器 Electron 入口，补充 Chromium 的原文件播放、五秒跳播、
  新画面回调及返回核对，保留原 MPV 分支。修复旧测试用按钮文字翻页而无法
  识别图标按钮的问题，改按可访问名称查找，并补充边界反转、禁用状态契约。
- 单独的 `memory-resource-preload.cjs` 仅由测试入口注册，不修改正式 preload，
  不在打包白名单中，不增加产品 IPC。只读返回固定数值字段，无计时器、路径、
  标题或写入能力。使用 [Electron webFrame 资源统计](https://www.electronjs.org/docs/latest/api/web-frame#webframegetresourceusage)
  查看部分 Blink 缓存；原始 size/liveSize 计数不当作完整解码图片内存、私有
  内存或显存。缺失计数为 null，不是零。样本统计不会被报告工具升级为通过。
- 将纯帧观察器与 Playwright 驱动分离，无调试器入口和报告摘要无需导入
  Playwright；没有通过调试端口、DevTools 或 Node inspector 采集资源。
- 附加调试的对照支持每轮一次采样、关闭额外 rAF/long-task 统计、固定轮数
  的完整结果。只有完成所有轮次、源身份核对和退出后才标记通过。

## 对照设计

均为真实 Electron、正常 GPU/sandbox，同一构建、2178 条只读复制索引、23 页、
每页最多 96 条、48 轮相同页序；滚动位置为 0/1/.25/.75/0，停留 150 ms，轮间
等待 1 秒，结束空闲 30 秒。封面组复制现有封面；无封面组仅清空克隆库的图片
引用，完全不修改或删除原封面、源视频。复制库暂停封面生成、关闭目录写权限。
关闭悬停预览、隐私滤镜和连播，固定深色/标准卡片，避免用户偏好造成差异。

| 组别 | 页面图片 | Chromium 播放 | 调试传输 |
| --- | --- | --- | --- |
| A | 现有封面 | 无 | 无 |
| B | 现有封面 | 每四轮一次，共 12 次 | 无 |
| C | 无封面引用 | 与 B 相同 | 无 |
| D | 现有封面 | 与 B 相同 | Playwright/CDP |

各组顺序执行，测试专门保持窗口可见但不抢焦点、禁用背景节流；不是默认后台
播放验收。D 每轮一次资源采样并关闭额外动画计时，与无调试器组仍有驱动、
DOM/堆诊断和执行等待差异，不能把所有差值仅归咎于调试协议。A 开始约十几秒
与重点 renderer 回归短暂重叠；不把这组结果称为完全孤立的性能基准。

播放使用 `E:\downloads\Lazy Eye Exercise #01.mp4`（H.264、1280×720、约
6.3 MiB），只读核对源 hash/大小/修改时间，核对实际帧、目标误差、单源加载、
缓冲/掉帧及返回后视频元素。该样本不代表 4K、HDR、长 GOP 或长距离随机拖动。
预先读取 hash 会预热系统缓存，不称为冷盘基准；程序触发应用控件/快捷键，
不是物理鼠标键盘验收。额外资源统计本身也会产生开销。

## 结果

四组均完成 48 轮、自然空闲及实际退出，错误数组为空，源 hash/大小/修改时间
一致；ABC 无 DevTools/debugger/Playwright/Node inspector。全部报告复制并校验
hash 后保存在忽略提交的 `build/memory-attribution-2026-10-24-7cd14c5e/`：

- A：`A-covers.json`，原始 TEMP 为 `avhub-no-inspector-a94spy/memory.json`。
- B：`B-covers-chromium.json`，原始 TEMP 为 `avhub-no-inspector-x71PYn/memory.json`。
- C：`C-no-covers-chromium.json`，原始 TEMP 为 `avhub-no-inspector-hhrb3N/memory.json`。
- D：`D-inspector-chromium.json`，原始 TEMP 为 `avhub-cover-stress-AF3U7X/library-soak.json`。

以下仅统计媒体库 renderer，不是全部进程或显存。中位数统一排除前两轮浏览
采样；A 本身没有十秒播放窗口，因此有效时长短于 B/C/D，不比较其工作阶段斜率。

| 组别 | 有效时长 | 暖轮工作集中位 | 暖轮私有内存中位 | 空闲前 → 30 秒后工作集 |
| --- | ---: | ---: | ---: | ---: |
| A 纯封面 | 91.469 秒 | 268.2 MiB | 192.5 MiB | 274.3 → 176.0 MiB |
| B 封面 + Chromium，无调试 | 216.417 秒 | 232.1 MiB | 146.3 MiB | 236.5 → 229.6 MiB |
| C 无封面 + Chromium，无调试 | 217.327 秒 | 209.9 MiB | 136.7 MiB | 210.5 → 209.6 MiB |
| D 封面 + Chromium，附加诊断 | 220.290 秒 | 340.4 MiB | 244.3 MiB | 398.2 → 386.5 MiB |

### 可确认的结果

- B/C/D 各 12 次原文件单源播放及五秒跳播，实际新帧在目标附近；播放中/跳播后
  waiting 均为 0，各有 12 次正常初始加载 waiting。单次播放最大掉帧 B/D 为 2，
  C 为 1，不能宣称零掉帧。最大目标误差 B 约 42.8 ms、C 约 42.7 ms、D 约
  40.3 ms；各组驱动
  和计时不同，不把跳播时延差异写成生产播放收益。
- A 图片缓存对象峰值 253，空闲末 25；B/D 峰值均 169、空闲末均 25；C 始终
  只有 1 个图片缓存对象（没有卡片图片节点），不是累积保存全部 2178 个对象。
  图片确有暂存与自然回收，不能将高位工作集直接解释为所有旧封面都被永久引用。
- B/D 图片计数和部分资源计数相近，但 D 的进程工作集/私有内存明显更高，说明
  诊断路径自身不可忽略。暂时不能把这部分差值精确归到调试协议、执行等待、
  网络响应保留或某一种分配器；也没有把关闭诊断当作应用性能修复。
- B/C 有封面与占位卡片的渲染路径不同，内存差值不是精确图片预算；C 仍保留
  约 210 MiB 工作集，证明“清掉封面即可让占用归零”不成立。没有修改产品的
  缓存 TTL、分辨率、原视频解码/转码参数或后台回收策略。

### 尚不能确认

本轮固定页集短对照缩小了问题范围，但不是小时/全天稳定性复测，也不是
一次性观察器修改前后的 A/B 测试；不能把以上差值宣布为该代码改动的内存收益。
此前 438 MiB 高位数据属于不同负载与构建，不能用新数字覆写旧结果或声称
全部泄漏根因已经定位。没有测量完整原生堆、显存或硬盘 I/O 吞吐。

下一步不盲目降低全局缓存上限。若正常桌面无调试运行仍出现持续上涨，先采集
同一页集、同一播放模式的按需快照，再按原生分配/网络诊断保留细分；不增加
后台高频轮询，不用强制 GC 或定时重载压低曲线。其后优先处理仍在跟踪的启动
超时和耐久提交长尾，避免在尚未复现的内存假设上继续叠加策略。

### 复现

```powershell
# A/B/C：基本参数相同。A 追加 --phase=scroll；C 追加 --artwork=absent。
node electron/test/desktop-memory-no-inspector.mjs D:\AI\codex\avhub\AVHub-data\library.db --media-id=869 --cycles=48 --walk --playback-engine=chromium --playback-every=4 --idle-seconds=30 --cycle-delay=1000 --resource-probe --test-background-unthrottled
# D：关闭额外 Network/动画统计，每轮采样一次；不关闭 Playwright 自带传输。
node electron/test/desktop-cover-stress.mjs D:\AI\codex\avhub\AVHub-data\library.db --passes=48 --hardware-gpu --walk --playback-id=869 --playback-engine=chromium --playback-every=4 --settle-ms=150 --cycle-delay=1000 --idle-seconds=30 --network-metrics=off --resource-probe --sample-mode=cycle --no-timing
```

复现前必须重新确认获授权的索引和只读样本身份，不能在索引已变时盲用 ID 869。

## 已执行回归

- 构建与 Electron TypeScript 编译通过；一次性封面观察、HTTP 缓存、收藏稳定、
  隐私模式相关 renderer harness 14 项通过。新增断言覆盖 96 张图片只准入一次、
  全部准入后无观察目标、迟到回调、旧 cleanup 不影响替换观察器；保留滚回
  请求次数为 1 的断言。
- 新增资源探针、报告缺失值、打包排除和分页驱动契约，加入现有 CI 测试命令；
  本轮没有触发远程 Actions。CI 配置契约 12 项通过，首次沙箱临时目录权限
  失败后在可写隔离临时环境复验，不修改生产代码迁就测试权限。
- 首轮入口短跑 `avhub-no-inspector-RAUcPB/memory.json` 因旧文字分页选择器
  失败，保留未完成记录。修正后 `avhub-no-inspector-DY8QFO/memory.json` 两轮
  真实解码/跳播/分页通过，源身份不变、正常退出；短跑不是长时间稳定性结论。
- Node 相关状态/资源/样式契约 21 项通过，原有两组报告摘要契约通过；新增
  固定轮数未完成、缺失资源值、禁用动画计时不冒充零值的保护。
- 最终真实 Electron 布局/收藏回归通过：
  `C:/Users/liu/AppData/Local/Temp/avhub-library-polish-RnhBDv/acceptance.json`。
  使用生成媒体，源身份不变、无页面错误、正常退出；该布局用例没有播放视频，
  不把它当作额外播放性能结果。
