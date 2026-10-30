# M5：成品长测失败与受限工具路径交互通过

## 实测对象与边界

- 现有本地成品 `build/native-render-acceptance-8iQPIP/win-unpacked/AVHub.exe`，版本 0.2.16，构建 `9aed889e7ca3ca73`。
- 使用真实 Electron 成品。15 分钟长测使用自建 4K25、10-bit BT.709 SDR 连续 960 秒时间线；内容为重复六秒图案，通过应用合成画面中的帧码取样。不是实际电影、物理显示器扫描或精确解码帧数统计。
- 本轮未修改运行时播放代码、未替换 DLL、未重新打包、未推送；保持原默认播放路径与受限 SDR 验收入口。

## 15 分钟：FAIL

原始记录：`build/render-app-soak-oR6bwF/report.json`、`checkpoints.jsonl`。独立汇总：同目录 `review.json`。当时使用的完整测试源码另存为 `harness-used.mjs`，不覆盖失败材料。

| 指标 | 实测 |
| --- | --- |
| 固定预热后的连续采样 | 900.291 秒 |
| 解码掉帧增加 | 0，门槛 0 |
| 输出掉帧增加 | **69，超过原门槛 22** |
| 输出掉帧占估计 25fps 时间线比例 | 约 0.307% |
| 画面帧码推进／墙钟比 | 0.999970 |
| 最大取样画面帧码与状态时钟差 | 5 帧 |
| 原文件加载次数 | 1 |
| 退出后宿主 | 已退出 |
| 文件占用 | 已释放 |
| 纹理导入／释放 | 23231／23231 |
| 租约创建／关闭 | 1／1 |

没有修改既有掉帧门槛，也没有以画面仍推进、平均速度正确或解码零掉帧替代输出性能验收。掉帧在约第八分钟开始增加；尚不能确定是应用帧调度、全画面截图采样干扰、系统调度或其组合。下一轮应先补充采样耗时与输出计数的对应记录，再做相同条件对照，而不是直接修改帧率／丢帧策略掩盖问题。

掉帧断言在后续空闲收敛采集之前失败，因此本轮**没有完成资源收敛验收**。仅可观察到后段私有内存极差约 24.55MiB、句柄极差 17、GPU 用量极差 64MiB＋64KiB；后两项也没有满足原始极差门槛。退出清理由 finally 实际完成并记录，不能把它当作空闲收敛测试通过。

## 移除开发工具搜索路径的成品交互：PASS

`build/render-app-controls-HLaXvV/report.json`：在真实成品子进程中移除开发工具 PATH、PYTHONHOME、PYTHONPATH、NODE_PATH、VIRTUAL_ENV，仅保留 Windows、System32、Wbem 路径。实际成品可启动、扫描、原生播放；验证音轨／字幕／倍速、暂停跳转、播放状态记忆、切换来源、旧会话命令拒绝、返回媒体库停止原生会话。

这是当前 Windows 主机的受限路径验收，不能等同于全新系统或未安装系统运行库的电脑。WASAPI 初始化成功且静音，不代表主观声音同步或 bit-perfect 音频验收。

## 成品缺依赖与默认策略：PASS

`build/render-packaged-policy-yekQWw/report.json`：逐项运行真实成品，验证默认不打开受限原生路径、验收标记缺失、DLL 缺失时可启动及提示／回退。操作仅临时挪开自有测试包文件，各项结束后恢复；测试通过。

## 命令与后续

设置 `AVHUB_TEST_PACKAGED_EXE` 指向上述真实 EXE 后运行：

```powershell
node electron/test/render-app-soak.mjs 900
$env:AVHUB_TEST_NO_DEV_PATH = '1'
node electron/test/render-app-controls.mjs
node electron/test/render-packaged-policy.mjs
```

相关材料与包装回归共 22 项 Python、10 项 Node 测试通过；长测明确失败，不能合并称为全绿。Git 基线仍为 main / 9678689，原有未提交修改保留。

M5 尚未放行：继续调查长时输出掉帧、补齐资源收敛与独立 FFmpeg 静态外部库的对应源码材料。外部物理机所附测试视频播放正常的用户反馈另见 52；它不覆盖这里的量化性能问题。回滚仍为关闭原生嵌入试验或切回现有播放器，不改变默认画质策略。
