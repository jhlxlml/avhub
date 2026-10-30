# M5：媒体解码与字幕字体链重放

2026-10-28。继续报告 39，版本仍为 0.2.16。未替换应用 DLL、切换默认引擎、打包或推送；原视频未修改。

## 重建结果

从冻结材料 `build/native-source-materials-rxwt3srw` 重建以下独立前缀，三份报告记录相同的 inventorySha256：

| build 下的新目录 | 重建内容 | 验证 |
| --- | --- | --- |
| dav1d-source-replay-4_j6b2d7 | dav1d，保留 8-bit 与高位深编译分支 | 经新 FFmpeg 强制选择 libdav1d，8-bit／10-bit 实测通过 |
| subtitle-source-replay-c6vp31en | zlib-ng、Brotli、libpng、FreeType、FriBidi、HarfBuzz、libunibreak、libass | 66 项汇编测试、多语言渲染通过 |
| ffmpeg-source-replay-wesx64x9 | 固定 FFmpeg 及本轮新建 dav1d、zlib | 4 组原生 YUV 帧、8／16-bit PNG 往返通过 |

本轮覆盖 10 个固定源归档。编译器／工具链继续复用；dav1d 和字幕构建只从上一轮 render-deps-replay-n9lsb7gr 读取交叉编译配置模板，没有链接旧媒体或旧字幕前缀。FFmpeg 显式选择上述两个新前缀，并要求其来源清单一致、字幕 Windows 验证通过。

原有 dav1d-windows-cross、subtitle-windows-cross、ffmpeg-windows-cross 指针仍分别指向 cs5m_0nk、3on2liyj、_f24han_，没有改写当前候选。

## 实际画质与功能检查

新 Windows FFmpeg 对项目自有生成样本在指定位置解码，禁止硬件解码，保留探测到的原始 YUV 像素格式。H.264、4K HEVC 8-bit、4K HEVC 10-bit、4K AV1 的目标帧均与原参考工具输出逐字节一致。这里只验证指定样本与帧，不宣称覆盖所有文件和跳播性能。

额外强制选择新 libdav1d，避免仅凭默认解码器结果推定其通过：

- 4K 8-bit AV1：12,441,600 字节 YUV 帧与参考结果完全一致。
- 自有 128×72、三帧 10-bit AV1 梯度：82,944 字节 yuv420p10le 与参考结果完全一致。梯度独立预检包含 876 个亮度级，参考编码／解码往返与原始梯度完全相同，证据为 build/media-fixture-preflight-lsgywzmu/report.json。
- 参考 FFmpeg 未编入 libdav1d，因此参考侧保留其原有解码器，新构建侧明确使用 `-c:v libdav1d`。没有假定两个工具拥有相同可选库。
- 8-bit RGB、16-bit RGB PNG 均通过编码／解码字节往返对比；4K 16-bit RGB 检查为 49,766,400 字节一致，不只是检查 PNG 文件头。

高位深梯度由参考工具在项目自有测试目录生成，没有编码用户媒体。每次验证创建单独的小目录，不覆盖上次样本；源文件身份在解码前后核对。

libass 使用真实 Windows checkasm（66 项）及多语言 ASS：1 秒与 3 秒的字幕画面不同，均与 5 秒的空字幕画面对比，确认实际可见输出；未检测到缺字回退失败。系统字体只读使用，没有打包复制字体。这些是库和图像检查，不等同于 Electron 控件、音画同步或物理显示验收。

## 修复帧对比失败仍被记为成功

verify-ffmpeg-windows-harness.py 原先可能在帧矩阵存在失败项后仍写入 `windowsExecutionPassed: true`，并以退出码 0 结束。现改为根据所有帧检查结果记录状态，失败时返回 1；强制 dav1d 的失败项也进入失败清单。

负向测试在隔离目录中编译了一个正常退出但完全不输出帧的测试程序，参考侧仍解码项目自有样本。实测四组对比全部失败、Windows 状态为 false、验证脚本退出 1。它只是质量门禁的合成负向测试，不计为真实解码验收。

相关 Python 回归共 41 项，通过 40 项、跳过 1 项（已有目录链接测试的环境限制）。覆盖实际产物身份、三层来源一致性、原指针保留、解码精度、PNG 往返、字幕和负向门禁。

## 证据与边界

摘要：build/media-source-replay-result.json；实际结果分别在上述新前缀的 report.json、windows-tests.json 及日志。验证工具在冻结材料生成后补充了高位深检查，实际执行版本的 SHA256 记录在摘要的 validationRecipes，未回写冻结材料冒充原内容。

至此 MPV 单层、渲染链、媒体与字幕链均有独立重放证据，但还没有将全部新前缀组合为一个新的 libmpv 闭包，也没有对该闭包做 Electron 桌面验收。现有原生候选的桌面结果不能转移到新 DLL。

下一步显式组合这些新前缀重建 libmpv，核对闭包，再进行真实 Electron 功能和稳定性验收。完整应用源码与发行材料审核、经授权的成品／干净机器验收，以及此前保留的资源观察继续待办。M5 尚未完成，发行标志保持 false。
