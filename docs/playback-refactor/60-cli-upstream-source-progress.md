# M5：CLI 上游源码材料推进到 20 项

本轮根据现有 FFmpeg 构建信息里的明确 Git 提交后缀，向各项目官方组织仓库解析完整提交，没有选取“最新 HEAD”替代对应版本。新增工具 `scripts/resolve-ffmpeg-source-pins.py`，固定结果仍在 `ci/ffmpeg-external-sources.json`。

新材料：`build/ffmpeg-external-source-review-uxs1l_zl/report.json`。共 20 项声明依赖的上游源码归档，约 356.78MiB，包括前一轮已捕获的 x264、x265、Rubber Band，以及本轮的 AMF、fribidi、harfbuzz、libass、libwebp、OpenAL Soft、Opus、SDL、Speex、SRT、vid.stab、VMAF、Vorbis、VPX、zimg、AviSynthPlus、ffnvcodec。

采集器复用并复核旧三份归档，没有重新抓取它们。支持从自有未完成目录恢复及增量复核，改变组件版本时不能覆盖原材料。既有三项的旧报告与原始材料仍保留在上一轮目录，未改写其历史数量。

## 许可来源与体积控制

- AviSynthPlus 的许可来源在 `distrib/docs/english/source/avisynthdoc/license.rst`，不在仓库根目录；ffnvcodec 许可嵌在 `include/ffnvcodec/nvEncodeAPI.h` 头部。没有因为找不到根目录 COPYING 就认定无许可证，也没有移用另一版本的文本。原始完整来源文件随归档保留。
- AMD SDK 的首次 Git 获取超过 120 秒，已到达本地的固定提交对象随后被复核并复用。FFmpeg 9.0.2 的 `amfenc.h` 和 configure 实际使用 `AMF/core`／`AMF/components` 头文件及动态加载入口。
- AMF 归档明确限定为该固定提交的 `LICENSE.txt` 与 `amf/public/include`，665600 字节；不称为整个 SDK 或显卡驱动的源码。多余 SDK Git 下载缓存 **344954474 字节**在归档测试通过后移除，记录 `build/m5-amf-cache-cleanup.json`，未删除项目主 Git 或用户文件。

## 没有解决的闭包缺口

仍有 17 项声明依赖未采集：aom、cairo、freetype、gsm、lame、libgme、libopencore-amrnb、libopencore-amrwb、libssh、libtheora、openjpeg2、openmpt、VAAPI、vo-amrwbenc、VPL、xvid、zeromq。

本轮还实际检查到 Git 子模块目标未包含在顶层 Git archive 中：

- SRT：`submodules/abi-compliance-checker`，提交 `7c175c45a8ba9ac41b8e47d8ebbab557b623b18e`。
- zimg：`graphengine` 提交 `cb5b2ce13384ec2491f0c37256ea210034799f69`；`test/extra/googletest` 提交 `6910c9d9165801d8827d628cb72eb7ea9dd538c5`。
- AviSynthPlus：`filesystem` 提交 `3f1c185ab414e764c694b8171d1c4d8c5c437517`。

这些目标已列入报告，没有标成已采集；是否参与实际供应商构建还需配方证据。上游归档也不能证明供应商没有额外补丁或自动生成材料。因此完整外部闭包、供应商配方／补丁验证、二进制重现与 distributionReady 均仍为 false。

两项实际材料审计测试通过，验证 20 项固定提交、全部归档哈希、原始许可来源字节和已有两组编码器单帧证据；不是模拟下载成功。此项没有更换运行库、修改视频、重新打包应用或发布。
