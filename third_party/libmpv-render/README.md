# libmpv Render API PoC 输入

仅用于隔离的 M2 可行性验证，尚非正式分发运行库。

- 提供者为 [zhongfly](https://github.com/zhongfly/mpv-winbuild/releases/tag/2026-10-14-7c4f662c08)，
  属于 [MPV 官网列出的第三方 Windows 构建](https://mpv.io/installation/)，不是 MPV 官方签发的稳定二进制。
- 固定源码 `7c4f662c088d55fdb4f7049e9226de061ecad8c5`，与项目现有开发 EXE 相同；
  实测版本 `mpv v0.41.0-1174-g7c4f662c0`、client API 2.5。
- `ci/libmpv-render-candidate.json` 固定发布标签、构建记录、下载地址、归档和全部六个文件摘要。
  下载后的 DLL 在忽略提交的 `build/libmpv-render-spike/runtime/`；不提交二进制或自动替换生产库。
- 本目录 GPL 与 Copyright 从同一 MPV 源码提交读取：
  [LICENSE.GPL](https://github.com/mpv-player/mpv/blob/7c4f662c088d55fdb4f7049e9226de061ecad8c5/LICENSE.GPL)、
  [Copyright](https://github.com/mpv-player/mpv/blob/7c4f662c088d55fdb4f7049e9226de061ecad8c5/Copyright)。
  这些文本不等于已收集完整的链接依赖通知、对应源码和构建补丁，`distributionReady` 保持 false。

准备：`python scripts/prepare-libmpv-render.py`。已有缓存时使用 `--offline`；
`--offline --verify-only` 只校验。需要本机 7-Zip 解压；运行和编译 PoC 不需要安装 SDK，
使用 Windows Framework C# 编译器及系统 D3D11/OpenGL。

完整测试、适用范围和未验证项见 `docs/playback-refactor/03-libmpv-render-api-spike.md`。
