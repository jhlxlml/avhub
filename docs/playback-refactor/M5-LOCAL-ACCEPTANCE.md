# 本地原生验收指南

这是显式开启的 D3D11 Render API 候选。它与 MPV EXE 窗口模式不同，也不是默认正式播放引擎。已有同机真实 EXE 与 ZIP 搬迁结果；新电脑通过检查前，不宣称干净机器可用。

## 启动与退出试验

1. 把专用本地验收包完整解压到独立目录，保留 resources 和运行库，不能只复制 AVHub.exe。
2. 当前双运行库桌面包直接运行 AVHub.exe，数据默认写到程序旁的 AVHub-data。只有历史专用包使用 Start-render-acceptance.cmd 与 AVHub-data-acceptance；旧包入口要求不适用于新包。
3. 在“设置 → 播放偏好”选择 MPV 并启用 D3D11 试验。先使用项目生成的明确 BT.709 SDR 测试图，再测试个人视频。
4. 记录是否有实际图像、跳播后时间是否继续、截图尺寸是否正确，以及全屏进退和退出后重开结果。短样本播放结束是正常现象，不能把进度文字变化当作画面已显示。
5. 当前视频需要返回旧路径时，点“切换现有播放器”。长期退出试验，在设置中选择现有播放器并关闭 D3D11；保留数据，不要删除个人媒体或覆盖原媒体库。

当前双运行库包直接双击 AVHub.exe 即可检测 D3D11 运行库，再由设置选择启用；独立窗口同时保留。默认播放引擎与已有偏好不变。包内标记、清单和资源必须匹配，开发环境变量不能代替实际交付资源。

## 当前视频准入

| 项目 | 已放行范围 |
| --- | --- |
| 色彩 | 缺失标记保持 unknown；普通 SDR 的色彩解释交给 MPV，不再以 BT.709 标签白名单拒绝 |
| 编码／像素格式／位深 | 由 MPV 实际解码；不再限于 YUV420 或 8/10-bit |
| HDR | 允许尝试 HDR；PQ / HLG 使用 BT.2020 对应传递函数的 F16 纹理，显示及动态元数据效果待验证，不因未验证拒绝 |
| 尺寸 | 不再限制 8K 或固定 256 MiB；保持完整画面尺寸，检查 D3D11 实际纹理上限和可用显存 |
| 几何 | 读取自带旋转与像素比例，扩展画面表面容纳完整画面，不缩小源尺寸来满足预算 |
| 探测 | 有界读取几何信息；读取或源身份错误仍明确报告，不伪装成已播放 |
| 环境 | Windows x64、匹配运行库与 FFI；显示查询作为诊断，不按显示器数量或验收名单拒绝 SDR |

兼容策略与实测范围分开。允许尝试播放不等于已完成所有显卡、多屏 DPI 或物理 HDR 显示验收。当前源码策略及证据见 [取消播放白名单](62-playback-compatibility-without-whitelist.md)；旧 ZIP 不会自动获得这些修改。

## 排障顺序

- 缺失色彩标签：由 MPV 自动解释，不补写源文件标签。
- “当前嵌入播放路径不可用”：真实的宿主启动／纹理尺寸能力限制可以有界自动使用现有原画播放器，保留全局 MPV 偏好，不开启转换权限；源读取、文件身份、保存或退出清理错误不会被自动切换掩盖。
- 缺少验收标记或运行库不可用：检查是否完整解压、是否通过专用启动脚本启动，以及杀毒隔离记录；不要从不明来源补 DLL。
- 宿主退出、纹理导入或设备错误：保留 AVHub-data-acceptance/desktop.log、完整错误文字、Windows／显卡型号和驱动版本。日志分享前检查个人路径。
- 构建身份不一致：开发态先正常退出、重新 npm run build 并重启。打包版应重新解压完整的一致包，不混用新旧 resources。

返回原画链路不会自动授权有损兼容播放，也不会修改源文件。

## M5 源码材料包

专用 M5 成品可使用固定源码构建的独立 FFmpeg CLI，保留原分辨率／位深探测、原画解码和无损封装。它的完整输入、许可证和构建配方与应用／原生运行库源码一起提供；以成品内 `resources/backend/_internal/licenses/FFmpeg-RUNTIME.json` 判断实际组件身份，不能用旧包的版本文字替代哈希核验。

此配置只用于明确指定的本地验收包。普通开发与普通发行配置尚未自动切换到该 CLI。重建此包需要应用源码、原生源码材料以及 CLI 材料三个部分；按材料包说明恢复固定输入，不要混入旧 DLL，也不要从旧 Gyan 版本清单推断当前成品的依赖。

断开的远程桌面可能令 DXGI 无法取得有效输出。请保持桌面连接、解锁，保留真实设备错误日志。显示查询仅作诊断，不再以 SDR 或单屏验收范围拦截播放。

## English summary

This is an explicit native-render local acceptance candidate, not the default release engine. Extract the complete dedicated package, launch Start-render-acceptance.cmd, and select MPV plus the D3D11 trial in playback settings. Test tagged BT.709 SDR patterns before personal videos.

Source codecs, pixel formats, bit depths, missing tags, rotation and pixel aspect ratios are handled by MPV. HDR is allowed: PQ and HLG use matching BT.2020 F16 texture declarations. Physical HDR display fidelity and dynamic metadata remain unverified, not admission restrictions. Actual decoder, texture-size and GPU allocation failures are still reported.

Check visible frames, seeking, screenshots, fullscreen transitions, exit and reopening. Preserve the local desktop log and exact error text for runtime/device failures, checking private paths before sharing. Use “切换现有播放器” to return the current video to the existing original-quality path; select the existing engine and disable D3D11 to leave the trial. Neither action authorizes lossy playback or modifies source media.

Successful same-machine EXE/ZIP tests are recorded separately from uncompleted clean-machine, HDR and physical multi-display acceptance. See numbered M5 reports in this directory for exact artifacts and limitations.

当前 HDR 源码迭代与合成样本验收见 [HDR 播放与验证状态](64-hdr-playback-without-admission-gates.md)。旧验收 ZIP 不会自动更新。
