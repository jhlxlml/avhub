# M5：Opus 模型依赖核查与免模型构建

2026-10-27。固定 Opus 源码为 `a8b2545eec71e0f53ecead2d583e7b6baa42684d`，与此前上游日志中 `1.6.1-85-ga8b2545` 对应。当前应用运行库未替换，M5 未放行。

## 核查结论

固定版本的 [meson_options.txt](https://github.com/xiph/opus/blob/a8b2545eec71e0f53ecead2d583e7b6baa42684d/meson_options.txt) 将 deep-plc、dred、osce 默认设为 disabled。它们对应模型增强功能，不能把模型归档当成普通 Opus 编解码必需输入。

固定版本的 [dnn/meson.build](https://github.com/xiph/opus/blob/a8b2545eec71e0f53ecead2d583e7b6baa42684d/dnn/meson.build) 和 [CMakeLists.txt](https://github.com/xiph/opus/blob/a8b2545eec71e0f53ecead2d583e7b6baa42684d/CMakeLists.txt) 表明模型功能受对应选项控制。原上游配方没有启用这些选项，却无条件依赖 opus-dnn、复制模型源文件并在全局包列表中加入下载项。这条无条件依赖可从新候选准备中去掉，同时保留标准 Opus 编码/解码和原有默认功能。

不能将该结论推广为“所有 Opus 增强功能都不需要模型”。若将来启用其中任一项，必须重新引入匹配的模型及验收，不允许无声省略。

## 真实构建与官方测试

从官方仓库获取同一完整提交，未复制外部模型，用已有 Ubuntu GCC/CMake/Make 在隔离目录 `build/opus-model-free-mr7oapgd/` 进行**Linux 原生库验证**。明确设置 DEEP_PLC/DRED/OSCE/PFA 为 OFF、FLOAT_APPROX 为 OFF；浮点 API 与 CPU intrinsics 保留。

真实库构建完成，5 项官方测试均通过：test_opus_decode、test_opus_padding、test_opus_api、test_opus_encode、test_opus_extensions，合计 24.75 秒。实际 compile_commands 中普通 opus 库有 154 个编译单元，DNN 编译单元为 0。

证据 `build/opus-model-free-mr7oapgd/report.json` 记录固定提交、原始源码文件哈希、生成库哈希、配置/编译/测试日志。此结果不是 Windows 交叉编译，不是新 MPV/Electron 播放验收，不证明与旧 Windows DLL 的全部输出逐位相同，也不替代后续音频轨道、时钟同步与真实媒体回归。

## 新候选准备调整

- 新增 `ci/native-rebuild-profile.json`：固定 Opus 提交，显式关闭三个模型选项，保留标准 codec。原应用与旧 DLL 的材料清单不改写。
- `resolve-native-rebuild-lock.py` 根据明确 profile 保留 Opus、排除 opus-dnn；未知/auto 选项不能触发省略。重新启用任一模型选项则保留模型输入。
- 更新新候选源码提案为 **78 项 Git 修订 + 3 项归档，共 81 项输入**。旧二进制的 82 项配方参考仍保留，不把新策略伪装成旧构建历史。
- `prepare-native-rebuild-archives.py` 离线复核现在只处理三个有效归档，不再反复请求模型。之前的下载超时报告另存为 `build/native-rebuild-archives/report-with-model-required.json`，没有改成成功。
- `prepare-model-free-opus-overlay.py` 从固定且校验通过的工具链源码归档生成两份**本地派生覆盖文件**：移除 Opus 的模型依赖、复制/清理动作，以及全局包下载列表中的 opus-dnn；固定 Opus 的 Git 提交并显式写入模型关闭选项。原工具链参考缓存不修改，派生文件不作为已获许可的上游源码加入仓库或分发包。

实际覆盖输出 `build/native-opus-overlay-x_3324eb/`、记录 `build/native-opus-overlay.json`。只生成覆盖文件，还未执行上游完整交叉构建；不能凭这两份文件声称全部源码已固定或新 DLL 已构建。

## 回归与下一步

增加模型关闭/开启/未知设置的提案测试，以及同时移除局部依赖、复制动作和全局下载项的覆盖文件测试，防止仅从提案删去模型却仍被全局 download 目标取回。

模型下载不再是当前新候选的阻塞项。后续继续准备隔离交叉工具链，展开其余条件依赖、完成对应源码与 notices，实际构建新 Windows DLL，再执行质量、实际 Electron、音轨和长时验收。现有播放器、解码权限、原画策略、用户媒体及版本号不变；本轮无应用打包或远程操作。
