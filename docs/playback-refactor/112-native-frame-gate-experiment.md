# 原生帧锁实验与负优化回退

2026-11-11。HEAD `cc2172bbdd61fd0a6c0dff11aa2f7e712ee981c6`，保留其他未提交改动与用户文件。不打包、不升版本、不提交/推送/发布。**本轮候选的功能验收通过，但性能不合格，已回退原生源码及本地选择指针。**

## 实际实验

111 发现 `RenderHost.RenderLoop` 在 frameGate 内调用 `D3dSurface.UnlockAfterDraw()`；该函数包含 D3D11 GPU 完成查询等待，而 Frame RPC 同样需要锁。

实验把它拆为锁外 `WaitForDrawCompletion()` 和短锁内 `PublishCompletedDraw()`：仍然等待真实 GPU 查询成功，然后在同一锁内更新 serial/epoch/content、帧计数和 AwaitingRelease。保留纹理尺寸/格式、原画、硬解、色彩、GPU 读取完成、资源回收、错误和关闭检查，没有提前发布纹理。

实际编译并生成本地候选 `build/render-replayed-candidate-a1q3J9`（不是应用安装包）；宿主 SHA256 `1a055d7323b422713590d189daf5e9cb519bd37b35ffd4d269c5c9657c50cbb9`。DLL 仍为既有 `5b45550f85ace0822f14d17deb7777c76d229e33c572f94a2f66580e631b42b1`，没有替换解码器或关闭校验。

## 结果：功能通过不能代替性能通过

候选真实 Electron 流程 `render-app-flow-xlpLHZ` PASS / 0：像素编码精确定位、控制栏正常点击、截图、缩放旋转、全屏、纯净播放、退出资源回收通过。没有以单独 MPV 进程测试代替应用验收。

使用与 111 相同原始只读 4K60 VP9 MKV（索引 1240）、快速模式目标 1040s，每组 300 秒，冻结记录并暂停后导出。原文件身份完全一致，硬解 d3d11va、源加载一次，解码丢帧增量均 0。

| 指标 | 既有宿主 17sz5V | 短锁候选 PncDwz |
| --- | --- | --- |
| GPU 完成确认数 / 秒 | 59.92 | **52.02** |
| 输出丢帧观测增量下界 | 3 | **2370** |
| Frame RPC P95 ms | 7.87 | 0.261 |
| GPU 确认间隔 P95 / 最大 ms | 22.20 / 43.02 | 23.58 / 112.91 |
| 未就绪 Frame 查询数 | 9162 | 12717 |

候选确实更快返回了未就绪，但固定轮询没有及时衔接后续 GPU 就绪，整个交付节奏明显退步。不能把 RPC 时长降低包装为用户播放提速。两轮不是统计充分的全硬件因果实验，不过这些退步已经足够拒绝本次候选。

`render-frame-cadence-PncDwz/report.json` 的原始 `passed:true` 仅代表当时脚本的功能/资源条件，不是性能放行。保留原报告；单独 `build/iteration-112-short-lock-experiment.json` 记录两份原报告 SHA256、同源对照及 performancePassed:false，明确拒绝采用。

## 回退与新增门槛

- 原生两个源码文件已恢复；`git diff --exit-code -- electron/native/render/D3dSurface.cs electron/native/render/RenderHost.cs` PASS / 0。
- 重新编译恢复后的宿主，`build/mkv-index-runtime-staging.json` 恢复指向 `render-replayed-candidate-76Rvvi`。坏候选及冻结源码保留作证据，不作为本地默认选择。正式发布文件完全未改动。
- 测试新增 `AVHUB_CADENCE_MIN_RECEIPTS_PER_SECOND`：仅对明确已知帧率的选定样本显式设置，测量低于门槛直接失败；不从分辨率或文件扩展名猜测帧率。本组已知 60fps 片源使用 57 次 GPU 确认/秒作为明显退步门槛，不等于屏幕 scanout 或跨媒体通用标准。
- 其余生产播放代码没有因本实验新增修改，之前的工作区功能修复继续保留。

回退后的真实应用流程 `render-app-flow-0oIkIH` PASS / 0；一分钟帧交付复核及最终校验结果在下节记录。

## 下一步

单独移动 GPU 等待不适合当前固定轮询架构。更合理的后续候选是实际 GPU 完成后、原子发布完帧身份，再向主进程发出可合并的就绪通知；保留单个 pump、旧宿主的定时轮询回退、会话代次、关闭取消和真实 GPU 完成检查。需要同时修改原生协议、客户端及调度并重跑原画像素/跳播/关闭和对照，不能直接将本轮坏候选扩围，也不采用高频空轮询补救。

## 最终验证

回退后 build/render-frame-cadence-3SXxl6/report.json：真实 Electron、60 秒只读 4K60 快速播放，PASS / 0；GPU 确认速率 59.86/s，通过显式 57/s 门槛，源加载一次、d3d11va、原文件身份不变。输出增量下界 5、解码 0；有一次 125.63ms 间隔（frame RPC 108.26ms），因此现有偶发等待仍在，不能宣称已经修复。它与五分钟候选不能作统计充分的丢帧降幅比较。脚本语法、计数契约 3 PASS / 0、最终 diff --check PASS / 0。无外机/HDR/多屏/新成品验收；本轮仅保留诊断性能门槛和实验记录。
