# M5：实际构建材料与独立验收包配置

2026-10-27。接续第 27 批。未改变播放器产品代码、运行库和版本，未执行 Electron 打包、上传或远程推送。

## 精确构建绑定

从固定 DLL 对应的[上游工作流](https://github.com/zhongfly/mpv-winbuild/actions/runs/40191236015)取回 `Build MPV (64, false)` 任务 `121162536770` 的日志，核对普通 x64 GPL 分支，而非 x64-v3、ARM 或 LGPL 分支：

- 构建包装仓库提交 `b120d7d8a64d17bd40b893f585429ef3845ac766`。
- 实际检出的工具链仓库提交 `1f8d2e76255abc48f0456d9be99b4cab9c6566e6`。
- 实际应用的两项配方补丁：ffmpeg remove opengl，以及 spirv-cross/shaderc skip unused stuff。
- 固定 MPV 源码 `baa3e11d42cb7978da634a8a6a3a55fe074d01be`。
- 日志中的 FFmpeg 短提交 `31855b2a7`，在其官方仓库解析为 `31855b2a7051d07a370984f5e4029826db06be1d`。

受信本地探针只初始化实际已核验的 libmpv 并读取属性，不载入用户视频，不修改原生宿主。`build/libmpv-metadata/versions.json` 实际返回 MPV `v0.41.0-1308-gbaa3e11d4`、FFmpeg `N-128094-g31855b2a7`、libass 原始数值 `24137728` 和编译配置。MPV/FFmpeg 标识与构建记录匹配；没有把未确认的 libass 数值强行解释为源码提交。探针不是 Electron 播放或性能验收。

包装仓库的原始工作流、脚本、两份补丁及 MIT 许可保存在 `third_party/libmpv-render-d3d11/build-reference-20261025/builder/`；对应散列在 `build-reference-files.json`。日志只保存相关 checkout/补丁/FFmpeg 摘录，未把无关认证配置日志加入源文件。

工具链固定源码归档 SHA-256 `5933a6e0bb035c6472d820d61344a60ab21d2ac6bc5355b00417f58df91b33dd`，来源固定 commit 的官方 codeload 地址。该固定树未找到根许可声明，源码参考只留在 `build/m5-source-inputs/toolchain-reference/`，不作为已获许可的源文件加入分发包。此事实不替代正式许可审查。

## 依赖清单的含义

新增 `third_party/libmpv-render-d3d11/materials.json`，绑定上述 DLL、MPV、FFmpeg、包装器及工具链提交，并记录 82 项从 MPV 配方依赖遍历到的节点、各配方哈希和 Git/URL 字段。

这不是完整二进制 SBOM：上游使用源缓存、更新步骤、分支与条件变量。`${ffmpeg_x265}`、`${ffmpeg_davs2}`、`${ffmpeg_uavs3d}` 仍明确标为未展开条件；每项静态依赖的实际二进制包含关系、精确源码修订和对应 notice 仍是 pending。`transitiveDependenciesVerified:false` 和 `distributionReady:false` 保持不变。不能把配方中的 master/main 或某下载版本直接写成这份 DLL 的已证实版本，也不能借用旧 mpv.exe 的组件清单。

离线分发审计现在展示与当前 DLL 绑定的材料数量和范围，若材料指向另一 DLL/MPV 则另列阻塞项。**收集到构建配方并没有解除原有分发材料门槛。**

## 独立本地验收包入口

新增 `electron/native-render.builder.cjs`，只在显式设置已生成的 `AVHUB_RENDER_RUNTIME_CANDIDATE` 后加载：

- 继承原应用构建设置，额外将该实际候选目录放入 `resources/native-render`，包括原生 DLL、N-API、源码身份与已有许可文件，位于 ASAR 外。
- 输出在 build 下独立验收目录，产物名含 render-acceptance，不覆盖 dist/electron 中的正式便携文件。
- `publish:null`；在稳定标签上下文拒绝运行。
- 构建前实际核验宿主、源码、固定 DLL/loader，以及布局每个文件的大小、哈希与真实路径。

**没有调用此配置执行打包**，普通 package.json、Windows 打包脚本及 GitHub Actions 发布流程未切换到它。它不是完整发布入口；当前产品中的 `app.isPackaged` 门槛仍拒绝新后端。因此不能声称已经交付能播放新后端的成品。后续必须在实际成品验收设计和用户打包授权下处理该门槛，不能仅删除拒绝逻辑来宣布完成。

`node --test electron/test/render-builder-config.test.mjs`：3 项通过，分别检查实际运行库预核验/ASAR 外资源、本地与正式输出隔离、稳定标签拒绝。这是配置与文件预核验，没有调用 electron-builder、没有生成 EXE/ZIP。既有运行库与适配测试继续保留，各类合成证据不冒充实际播放。

## 下一步

优先补齐上游日志或构建产物中的静态依赖精确修订、必要的对应源码及 notices；若上游没有可恢复的完整材料，应评估可复现地构建一个材料齐全的候选，随后重跑质量与播放验收。实际打包前仍需明确 Framework/系统依赖、缺件退回、无开发环境加载、退出、升级及本地验收开关的边界。

M5 尚未完成，原默认引擎与画质策略均不变。本批仅新增材料/审计/本地构建配置；无需回滚产品播放逻辑。
