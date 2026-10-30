# MPV 来源与分发材料准备

这些文件用于固定来源、核查和开发验收，不是完整的再分发材料，也不代表分发审查已完成。
`electron/mpv-distribution.json` 的各项状态继续为 pending；不执行这里保存的上游脚本。

## 当前使用的开发运行库

- 来源：mpv-player/mpv 官方滚动 CI；归档和 EXE/许可摘要见 `electron/mpv-runtime.json`。
- 完整源码提交：`7c4f662c088d55fdb4f7049e9226de061ecad8c5`。
- 构建记录：<https://github.com/mpv-player/mpv/actions/runs/38598545310>。
- `upstream-preview/Copyright`：对应提交的版权说明，保持上游文本。
- `upstream-preview/ci/build-mingw64-full.sh`：该构建方式使用的上游脚本快照，仅作为材料。
- `upstream-preview/ci/publish-release.sh`：说明滚动资产的替换机制；它不能提供长期下载保证。

每个快照的 URL 和 SHA-256 见 `references.json`。这些脚本中仍有动态依赖输入，不能
根据 MPV 的单个提交声称已经取得全部链接依赖的对应源码、许可及可复现构建输入。

## 固定版本候选

- 上游发布：<https://github.com/mpv-player/mpv/releases/tag/v0.41.0>。
- 源码提交：`41f6a645068483470267271e1d09966ca3b9f413`。
- 构建记录：<https://github.com/mpv-player/mpv/actions/runs/20414542745>。
- 外层归档、内层归档、EXE 和 23 个 DLL 的摘要锁定在 `ci/mpv-stable-candidate.json`。
- 该归档是双层 ZIP，Windows 运行库是 EXE + DLL 布局，不可按当前单 EXE 方案打包。
- 发布资产没有声明为 immutable，仍须严格核对已锁定摘要，不允许跟随同名替换。
- 当前只保存在忽略提交的 `build/mpv-stable-candidate/`，未替换 `bin/mpv/`。

候选准备入口：`npm run prepare:mpv -- -Candidate`；有有效缓存时可加 `-Offline`。
它只按固定清单读取双层归档，把 24 个文件发布到 `build/mpv-stable-candidate/verified-runtime/`。
未知 DLL、已存在但不匹配的文件、重复归档成员均会阻止安装；不会覆盖当前运行库。

`candidate-components.json` 归类全部 24 个文件，并显式列出构建脚本中的静态 LuaJIT / MuJS；
它不是完整递归 SBOM。`candidate-binary-versions.json` 记录绑定二进制摘要的 Windows
版本资源；DLL 的 ABI 号或产品版本不能单独作为准确源码提交的证明。

MPV 与 FFmpeg 的两个完整提交源码 ZIP 已收集并锁定到 `ci/mpv-candidate-sources.json`。
使用 `npm run prepare:mpv -- -Sources` 准备这些源码归档，离线可加 `-Offline`；只校验并
保存在 `build/mpv-candidate-sources/`，不解压执行，也不认为两个归档已覆盖全部依赖。
对应提交的 MPV 版权、GPL 文本与构建脚本快照见 `upstream-stable/` 和 `stable-references.json`。

候选尚无完整的许可与依赖源码材料。后续要逐项补齐，或选择能同时提供完整分发
材料的固定构建；不能仅附 MPV 的 GPL 文本就将它标为可交付。

## 检查

`npm run check:mpv` 分别报告运行库完整性与分发准备状态。
`node scripts/check-mpv-readiness.mjs --release` 必须核对固定标签、完整源码提交、
与具体运行库绑定的材料摘要，以及实际桌面/成品验收记录；当前预期失败。
该检查只能确认记录和文件一致，不能替代材料内容审查。
