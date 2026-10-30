# M5：实际 Vulkan 与独立运行库加载

2026-10-27，接续第 26 批。用户提供 `VulkanRT-X64-1.4.363.0-Components.zip` 后解除先前下载阻碍，改为固定并验证此版本，不再要求旧版 ZIP。

## 输入与实现

官方公开文件目录已留存于 `build/vulkan-runtime-input/files.json`。提供的 ZIP 长度 18,211,191 字节、SHA-256 `a25a927aa8b9f0371048f1861cf88ac3b9bc9b1fb332c42d897c8ab32695769a`，与该目录 windows/1.4.363.0/Runtime zip 完全匹配。来源见 [LunarG 公开目录](https://vulkan.lunarg.com/sdk/files.json)。未执行安装器或修改系统目录。

提取出的 x64 loader 长度 1,729,464 字节、SHA-256 `e1fcfc9489beefa6a6d9d11d6c7517f6a2b7f16e0d3fb8f4103bee0210f314a3`。保留原始包内 `VulkanRT-License.txt`（4,008 字节）和固定 Khronos 源码许可（11,661 字节）；源码标签对应提交 `fa218055ff4948b159f31d43f800c808a13d51df`。未把源码标签当成独立复现二进制的证据。

`ci/vulkan-runtime.json`、准备脚本和测试随该固定版本更新；包内许可也由全 ZIP 哈希和单文件哈希约束。原包只读保留。`stage-render-runtime.mjs` 在足够空闲空间下才创建新的自有目录，不覆盖旧候选；包含实际宿主、原 libmpv、loader、FFI、源码身份与许可材料，分发标志仍为 false。

新增 `electron/src/renderRuntimeLayout.ts`，统一解析开发、显式本地候选及预留 resources/native-render 布局。通过 `AVHUB_RENDER_RUNTIME_CANDIDATE` 只允许选择 build 下格式固定的候选目录名，不能指定任意路径。主进程宿主与纹理 FFI 使用同一个解析逻辑；候选模式必须验证精确 Vulkan 哈希，不能因系统里已有 loader 就忽略缺件。

普通开发路径不变。打包态拒绝新后端的门槛仍保留，不因路径准备完成而开放生产使用。候选目录中的源码副本保持与宿主构建一致，并非删除原有源码一致性检查。

应用 build `c89c483ef60b8035`；宿主仍为 `1b204ba8ec38e5f3df485d583f586ed3e6e8e0aa783a255784e0c53a63f0776a`；libmpv 仍为 `ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74`。未重编译或替换已验证 libmpv。

## 真实 Electron 证据

运行目录 `build/render-runtime-candidate-yLzPvm`，布局记录 `build/render-runtime-staging.json`。

- `build/render-app-flow-v4Aprx/report.json`：实际 Electron 播放、5 个帧码跳播、截图、播放时跳播、旋转缩放、全屏、纯净播放与退出通过。读取**当前客户端拥有的宿主**模块列表，确认 libmpv-2.dll、vulkan-1.dll 的完整加载路径均位于上述候选目录，没有取 System32 loader。
- `build/render-app-flow-qmd5iC/report.json`：实际原尺寸 4K SDR10 播放、帧码跳播与同目录模块路径通过；截图为 3840×2160、PNG 16-bit。合成画面核验不等于物理 HDR 或显示器扫描输出。
- `build/render-ass-seek-Vhy9kw/report.json`：20 次复杂 ASS 目标帧、40 次快速字幕切换、跳播交错、播放意图反转和引擎切回通过。
- `build/render-app-controls-uweRof/report.json`：音轨、字幕、截图、播放状态与播放器切换通过。
- 首次故障测试 `build/render-app-faults-yxRFrO/report.json` 失败，原因是**测试钩子硬编码旧宿主目录**，未能捕获候选子进程。该失败保留；只调整测试钩子按同一解析器选择确切的自有宿主，没有放宽到任意进程。
- 重跑 `build/render-app-faults-edtlPl/report.json`：实际宿主退出、GPU 设备丢失、缺失宿主、缺失 libmpv、文件占用、重试与清理通过。

`npm run build`、`npm run build:electron` 通过；Vite 现有构建提示保留。5 项 Vulkan 准备测试、4 项分发审计契约、1 项真实目录组装边界测试、3 项目录/必需 loader 校验测试通过。契约测试与真实解码证据分开记录。

`build/render-app-soak-KRtmfs/report.json`：候选目录下固定预热 30.184 秒后正式测量 20.174 秒，像素时钟比 1.000244，新解码/输出丢帧均为 0。句柄基线/峰值 807，结束暂停 803；私有内存峰值增长 352,256 字节，显存正向增长 0，原始范围与收敛门槛均通过。1,291 次 GPU 导入、完成与释放匹配；宿主、共享租约、源保护均释放。这是短时预检，不是新布局的十五分钟验收，不能挪用第 24 批旧应用 build 的长测成绩。

`build/render-app-flow-bXqTbu/report.json`：移除候选环境变量后，原开发路径的实际 Electron 回归通过。原先默认加载方式没有被隐式替换。

## 剩余门槛

本机候选加载可用，不等于干净机器或正式成品可用。精确 libmpv 构建的传递依赖、许可/对应源码材料仍待完成；extraResources 尚未接入，生产开关仍关闭。下一步补完这些材料与打包入口，按用户要求才生成 EXE/ZIP 并做实际成品/干净环境验收。实体 HDR、多屏继续按原决定待办。

开发验收选择示例（使用实际新生成的目录名）：

```powershell
$env:AVHUB_RENDER_RUNTIME_CANDIDATE='render-runtime-candidate-yLzPvm'
npm run electron:dev
```

移除该环境变量恢复普通开发路径。应用默认引擎、用户视频、版本号、远程仓库均未改动；本轮无打包和发布。
