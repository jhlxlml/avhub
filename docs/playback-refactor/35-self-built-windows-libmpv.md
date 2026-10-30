# M5：字幕链与首批自建 Windows libmpv

2026-10-28。Git 基线仍为 main / 9678689，保留已有修改。本批完成自建原生库的构建与基础验证；**不是新库 Electron 放行、发行许可审核或成品验收**。旧运行库、默认引擎、用户设置、原媒体未改变，未打包、升版本、推送或发布。

## 已完成的构建

新增 build-subtitle-windows-harness.py，以固定 Git 源归档构建 zlib-ng（zlib 兼容 API）、Brotli、libpng、FreeType、FriBidi、HarfBuzz、libunibreak、libass，产物仅在 build/subtitle-windows-cross-3on2liyj。

- FreeType 开启 PNG 字形、WOFF2/Brotli、系统前缀 zlib，以及动态 HarfBuzz 提示支持；bzip2 字体压缩未启用。
- HarfBuzz 保留 libass 所需的字体/文字整形核心；未启用独立 GPU/raster/vector/subset 工具库及可选 ICU/Graphite 后端，不宣称与整个上游包功能等价。
- libass 使用 DirectWrite/GDI 系统字体发现、Unicode 断行、NASM 汇编；large-tiles 保持 false，没有用降低栅格质量换性能。
- libunibreak 使用其上游提供的 src/Makefile.gcc，按原始源文件清单构建静态库，不重写 Unicode 算法或修改原始数据表；pkg-config 从上游模板和 configure.ac 的 8.0 版本生成。
- 系统字体只读使用，没有复制系统字体进运行库。

实际修复：FreeType 的 zlib=external 会选择未锁定 wrap 子项目，已改为 zlib=system 使用本地前缀，继续禁止自动下载。libass 的跨平台 Meson 配置需明确提供 nasm binary；未通过关闭 ASM 绕过问题。失败前缀 jojk4zjc、resume 前报告和最终构建日志保留；resume 只接受本项目自有的未完成字幕构建目录，并核对完成组件对应的固定修订与归档摘要。

## 原画解码与截图基础验证

FFmpeg 固定提交 31855b2a7051d07a370984f5e4029826db06be1d，在已验证 dav1d 基础上显式启用 zlib，补齐 PNG 编码器。最终前缀 build/ffmpeg-windows-cross-_f24han_。

verify-ffmpeg-windows-harness.py 在真实 Windows 执行：

- H.264、4K HEVC、4K 10-bit HEVC、4K AV1 各一个固定生成帧，原尺寸原像素格式 YUV 与现有参考解码器逐字节一致，4/4。
- 8-bit RGB PNG、16-bit RGB PNG 编码后再解码的像素数据与编码前相同，2/2；16-bit 项为 4K、高位深 HEVC 生成样本的截图编码测试。

证据 build/ffmpeg-windows-cross-_f24han_/windows-tests.json。该测试不是 MPV/Electron 截图功能验收，也不证明全部 HDR 或整库内容；未进行有损编码、视频缩放或自动 HDR→SDR。

## 实际字幕验证

verify-subtitle-windows-harness.py 调用上游 Windows checkasm 和 libass_test：

- 官方汇编/C 参考实现比对 **66 项通过**。
- 1280×720 的 UTF-8 ASS，包含中文、韩文、阿拉伯文、粗体、斜体、换行、颜色和两段时间轴。
- 1 秒、3 秒、5 秒实际 PNG 输出验证：两个可见字幕状态与无字幕状态分别有 39191、13851 字节差异，两个字幕图像不同；未发现最终 glyph fallback 失败。已人工查看第一张输出确认文字可见。

证据 build/subtitle-windows-cross-3on2liyj/windows-tests.json 及 subtitle-1.png。此为实际库渲染和时间轴测试，不替代应用字幕轨选择、延迟设置、外挂字幕加载或屏幕叠层回归。未把 UTF-8 结果扩大为所有旧代码页验收。

## 自建 Windows libmpv

固定官方 MPV 提交 baa3e11d42cb7978da634a8a6a3a55fe074d01be，使用本地已构建的媒体、渲染、字幕前缀生成共享库、CLI 及官方测试程序。

最终候选：build/libmpv-windows-cross-06dva4ei/install/bin/libmpv-2.dll

SHA-256：2cf60d001765b91cf3f40a7ef115da010385ecc46442d609d8a75d3db3defa88

文件大小 3,603,290 字节，仅为主 DLL，依赖库另计，不能当作完整运行库体积。

启用 D3D11、D3D11VA/DXVA2、WASAPI、Win32 threads、shaderc、SPIRV-Cross、LCMS、libass、zlib。初版精简配置没有显式打开 D3D 硬解，已保留为 hzizi21h 控制基线；最终配置显式要求两个硬解选项，核对 config.h 为 1。不改变应用默认设置；Vulkan/OpenGL 和其他可选 MPV 功能没有被当成已放行范围。

实际版本标识修复：FFmpeg 从 Git 源归档展开到 AVHub 工作区后，曾误读上层 AVHub 提交 9678689。脚本现在隔离 Git 向上搜索，并用上游版本生成器写入明确固定的 git-31855b2a7051。生成器使用相对头文件输出路径；修正自己缓存的旧生成头后重编译了受影响对象。MPV 同步重新链接，消除编译期/运行期版本差异；构建器和验证器新增一致性断言。此前报告、版本日志及修复日志保留，没有把错误版本字符串当作来源证据。

最终版本输出为 mpv v0.41.0-UNKNOWN（上游无 .git 归档的回退文本）、libplacebo v7.387.0、FFmpeg git-31855b2a7051；MPV 的精确源修订以固定源归档与本报告为准，不将 UNKNOWN 伪装成正式标签。

## 新 DLL 的实际 Windows 测试

build/libmpv-windows-cross-06dva4ei/windows-tests.json：

- 客户端 API 2.6，CLI 和 DLL 实际加载通过。
- 选取的 10 项官方核心测试全部通过：chmap、codepoint-width、format、gl-video、json、language、linked-list、paths、swresample、timer。gl-video 是上游核心算法测试名称，不代表 OpenGL 后端已放行。
- 4 个生成样本实际加载、解码元数据与 1.24 秒 seek 状态控制通过，分辨率保持 640×360/3840×2160；10-bit HEVC 显示 yuv420p10。
- H.264 使用含中文、韩文、emoji 的复制样本路径，观察 hwdec-current=d3d11va-copy；其余三项明确软解，未把它们报告为硬解通过。
- 所有库控制样本用 null VO/空音频输出。**不证明可见新帧目标精度、实际桌面呈现、音频设备同步、零拷贝路径或跳播速度**。copy 是本轮硬解烟测方式，不是应用播放策略调整。

FFmpeg 当前 avutil 61 对应的新图像格式参考不在该 MPV 固定源码的上游 refdir 条件范围内，img-format/scale-sws 这类参考测试未生成；没有修改上游版本条件或期望值来制造通过。已用独立原尺寸/原位深目标帧和 PNG 往返测试补充有限证据，仍需真实 Electron 矩阵。

## 依赖核验与回归

新增 audit-libmpv-imports.py：针对最终 29 个候选 DLL 的已记录摘要和 PE 导入表盘点包内依赖，另 21 个外部静态导入由真实 Windows 以 LOAD_LIBRARY_SEARCH_SYSTEM32 成功解析，记录实际模块路径。没有从 System32 拷库或联网补 DLL。

证据 build/libmpv-windows-cross-06dva4ei/import-audit.json。dynamicImportsVerified、distributionReady 仍为 false；静态表与本机加载成功不替代延迟加载、驱动以及未配置开发环境的机器验收。

本轮构建准备回归 22 项：Windows 21 通过/1 项链接权限跳过；Ubuntu 22 项通过。新 Python 脚本语法检查通过。最终版本修正后重跑了 4 个帧比对、2 个 PNG 往返、10 个官方核心测试、4 个库加载/控制样本和导入审计，均通过。

## 下一步与边界

完整 libmpv 已生成，但 **M5 未完成，新库尚未被 Electron 接受，也未替换现有应用库**。RenderHostClient 仍只接受既有固定 DLL 摘要及旧候选依赖清单，不通过绕过校验或猴子补丁伪装应用验收。

下一步整理自建候选的精确来源、依赖与许可材料，建立明确的实验候选校验，再在真实 Electron 中验证 Render API、原画精度、截图、音轨字幕、可见 seek、全屏/纯净播放和退出；最后重跑长时与分发验收。实体 HDR、多屏继续保留待办。当前证据不授权或构成发布放行。
