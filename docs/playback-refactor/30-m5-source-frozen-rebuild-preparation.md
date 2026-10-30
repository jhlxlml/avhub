# M5：新候选的源码固定与构建输入快照

2026-10-27，接续第 29 批。本批为**新运行库候选**准备源码与构建证据，不把当前远程分支提交回填成旧 DLL 的历史。现有 libmpv、Vulkan、播放器产品代码和默认策略均未变；没有编译新 DLL、打包、升版本、推送或发布。M5 尚未完成。

## 实际环境与配方结论

此前 Windows 上没有 C++ 构建工具，不等于本机完全没有构建环境。本批只读确认已有 Ubuntu WSL：Ubuntu 24.04.4 LTS、x86_64、CMake 3.28.3、GCC 13.3.0、Git 可用；缺少 Ninja、Meson、Clang、MinGW x64 gcc/windres、pkg-config、NASM。记录 `build/native-rebuild-environment.json`。没有安装系统包或修改已有发行版配置。

从已固定的上游工具链源码分析到两个关键事实：

1. `cmake/custom_steps.cmake` 的 force-update 会 fetch 并重置到跟踪分支，构建末尾 cleanup 还可能恢复或清理源码；仅保存配方或最终 Git HEAD，无法完整表达实际编译输入。
2. Opus 配方会复制 DNN 文件，libplacebo 配方会链接 glad/fast_float 源码目录。因此必须记录实际参与构建的额外文件和链接内容，而非只收集仓库的干净版本号。

以上是对本地固定来源参考的只读分析，没有运行其中的 reset、cleanup、安装或构建脚本。

## 新候选源码引用草案

新增 `scripts/resolve-native-rebuild-lock.py`，使用显式 `--resolve` 查询公开 Git 引用，固定完整提交；区分远程 HEAD、分支、轻量/附注标签，并拒绝含糊的分支/标签同名结果。没有对应 ref 时不会擅自改用 master。查询不加载任何第三方脚本。

实际在 Ubuntu 中生成草案，82 项配方输入中：

- 78 项 Git 修订解析完成。MPV/FFmpeg 保留已确认的固定项目提交，其余当前引用为**新候选**输入，不能证明旧 DLL 的依赖版本。
- 4 项是配方声明校验和的源码归档，Git 引用解析成功不等于归档或源码已经全部准备完成。
- 原有三个条件表达式仍待构建配置实际展开，不能宣称完整条件依赖闭包已固定。

Windows 对 uchardet 的官方 GitLab 地址出现 TLS 失败，Ubuntu 对同一地址读取成功；没有换用未确认的镜像。草案保存为 `ci/native-rebuild-source-proposal.json`，所有 sourceVerified/buildVerified/distributionReady 的未验证状态如实保留。

## 实际源树快照工具

新增 `scripts/capture-native-source.py`：仅接受自有 build 目录内、确实拥有独立 Git 顶层的源码树，避免误捕获 AVHub 父仓库。记录基准提交、Git tree、原始修改状态、每个实际文件的大小/哈希，包含未跟踪及被忽略的构建输入。自有目录内的源码链接会展平并记录来源，循环或指向工作区外的链接被拒绝；不复制 .git 配置与对象数据库。

单个快照默认上限 512 MiB，并在输出前检查剩余空间；新目录输出，不覆盖旧证据。固定 ZIP 时间戳、文件顺序，记录主机平台及观察到的文件模式。该工具只证明某时点的源树内容，不提供完整离线编译环境、所有传递依赖或二进制可复现承诺。构建流程仍需在清理前、适当的源码稳定阶段调用，并保存工具链/配置/补丁等其他输入。

实际取得固定 MPV Git 提交 `baa3e11d42cb7978da634a8a6a3a55fe074d01be` 到新的自有目录；两次干净源树快照均包含 982 个文件，归档 SHA-256 一致：`4f2242aba79715587bc0907b3686ad79c29808d6ff752e2d60f82882ece82d2e`。最新记录 `build/native-fixed-mpv-capture.json`，快照 `build/native-source-mpv-e1dip8l2`；旧一致快照保留。包含原始许可文本，不含 .git。没有把这些真实源码操作冒称成编译、解码或显示验收。

## 归档准备与真实超时

后续第 31 批确认模型功能原本默认关闭，已为新候选采用显式免模型 profile。下表对应的原始模型参与版本报告保留于 `build/native-rebuild-archives/report-with-model-required.json`；当前 report.json 只反映免模型提案的三个归档，原失败没有被改写成成功。

`build/native-rebuild-archives/report.json`：

| 输入 | 实际结果 |
| --- | --- |
| libiconv 1.18 | 5,822,590 字节，匹配配方 SHA-256 |
| libopenmpt 0.7.12 | 1,679,743 字节，匹配配方 SHA-256 |
| LZO 2.10 | 600,622 字节，匹配配方原 SHA-1；另外记录 SHA-256 c0f892943208266f9b6543b3ae308fab6284c5c90e627931446fb49b4221a072，但不冒称已获独立的上游强校验 |
| Opus DNN | 官方模型请求长期未返回数据，未取得、未校验，不使用不完整文件 |

初次网络尝试仅靠 urllib 的单次超时，未及时结束；已核对本轮父进程/命令身份后，仅停止其下载子进程，保留有效归档，没有终止应用或其他进程。

新增 `scripts/prepare-native-rebuild-archives.py`：默认离线复核，显式 `--download` 才取缺件；每个下载放在独立、无子进程的 worker，由监督进程施加 **45 秒总时限**，校验后才以不覆盖方式发布，超时删除本次临时文件。重新实测 Opus DNN 得到 `hard-deadline-45s`，任务已结束，不留后台下载，报告没有标成成功。容量与空间限制保留。

## 测试

- Ubuntu：`python3 -m unittest tests.test_native_rebuild_refs tests.test_native_rebuild_archives tests.test_native_source_capture tests.test_render_build_logs tests.test_vulkan_prepare`，21 项通过，含真实隔离目录链接用例。
- Windows：相同 Python 测试 20 项通过、1 项因创建链接权限跳过；该用例已在 Ubuntu 覆盖。最初合成样本的 Windows 文本换行差异已改为显式字节样本，没有改动真实源码换行。
- Windows Node：候选构建配置、路径/必需依赖、分发审计与目录组装 11 项通过。
- 固定 MPV 的两次实际源码捕获与哈希比较通过；这与合成单测、实际播放器验收分别记录。

## 下一步与放行条件

接着准备工作区隔离的交叉工具链，补足模型输入和归档强校验，初始化准确的全部源码/补丁并在清理前捕获实际输入；再做真实新 DLL 构建。之后必须重跑 Render API、原尺寸/位深/色彩、实际 Electron 播放和长时验收，才能评估是否替换当前库。旧 DLL 的材料缺口不会因新草案而自动消失，M5 和正式发布继续不放行。
