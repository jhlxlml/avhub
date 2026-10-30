# M5：补充三个 CLI 静态依赖的上游源码

本轮没有替换 FFmpeg、编码器、原生渲染宿主或任何运行库。仅在成品长测期间补充独立 FFmpeg CLI 的源码材料；不能用 libmpv 所链接的另一批 FFmpeg／字幕依赖源码冒充 CLI 对应材料。

固定来源写入 `ci/ffmpeg-external-sources.json`，采集脚本为 `scripts/capture-ffmpeg-external-sources.py`，实际材料位于 `build/ffmpeg-external-source-review-eiq0jil3`。

| 组件 | 固定上游提交 | 归档 SHA256 |
| --- | --- | --- |
| x264 | `0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee` | `6aa687a141dcfcfc8fb2c61be29329eb6da5cea4ed781d1358692306352222c6` |
| x265 | `116b87573ed0cec20b75ccacd5641bf06f6e57bd` | `85d17c69f1ef1a067c099021022d71df7f0041a4cc8b6d945ef5104db43e28d1` |
| Rubber Band | `1d95888bec3ae0a17c0c4af791810d5a63f6bc35`（v4.0.0） | `7faff3232f9ae7b810ee5145f3f94cc6502714efc25a20a63f97cd7e054fbc54` |

x264 来源为 VideoLAN 官方 Git 仓库。现有 CLI 在自建 64×64 单帧中实际输出的 SEI 报告 `core 165 r3223 0480cb0`，与完整提交前缀相符。x265 旧 Bitbucket API 返回 404，改从开发者现用的 `Multicorewareinc/x265` 官方仓库解析并取得固定提交；现有编码器单帧输出也含该提交前缀。两个小型自建码流、日志、哈希均保留，未对用户视频编码。

Rubber Band 的版本依据供应商构建信息及官方 v4.0.0 标签；没有伪称从静态链接的运行库读到了其内部 Git 身份。三份归档和原始 COPYING 字节核对通过；两项新增材料审计测试通过。

仍有 **34 项声明的外部库尚未归档**。这三个组件的供应商补丁、完整构建配方及全部传递依赖也没有验证，现有 CLI 没有重建。因此 `allExternalLibrariesCovered`、`vendorPatchesAndBuildRecipesVerified`、`binaryReproduced` 和 `distributionReady` 均保持 false。上游源码捕获不等于整个供应商二进制的对应源码闭包已经齐备，也不是法律认证。

这些材料不会因保留同名依赖而被合并进另一批原生运行库，不扩大已有 HDR／多屏的验收范围。未打包进应用、未上传或推送。
