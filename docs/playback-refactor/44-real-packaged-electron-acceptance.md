# M5：真实成品与 ZIP 搬迁验收

本轮用户授权本地打包，并允许在合适时推送／上传。实际生成并运行了独立验收成品；未推送、上传、打正式标签或提高版本号。版本仍为 0.2.16，前后端 build b578a8bbb16aa84a。

## 成品与入口

- 配置：electron/native-render.builder.cjs，候选 render-replayed-candidate-Aa7Otl。
- 真实程序：build/native-render-acceptance-Aa7Otl/win-unpacked/AVHub.exe。
- 重新运行 PyInstaller 构建当前后台；内置 SQLite 3.54.1 校验通过。Electron Builder dir 构建成功，Electron 44.9.3，无签名证书。
- ZIP：build/native-render-acceptance-Aa7Otl/AVHub-render-local-acceptance-0.2.16-x64.zip。
- ZIP 300,866,229 字节，解压文件共 749,446,922 字节／549 文件。SHA256：93ba725a69341de1eb469fa257576969edc82932ac8110a5394b1c1cec6320ad。
- ZIP 内 Start-render-acceptance.cmd 设置显式验收开关，并将数据隔离到程序旁的 AVHub-data-acceptance。设置中仍需主动选择 MPV 与 D3D11 试验，不迁移或改变普通用户默认引擎。
- 成品内包含本地验收说明与 AVHub LICENSE；这不是完整公开发行材料已审核的声明。

首次受限网络构建因 github.com DNS ENOTFOUND 失败，保留输出；允许网络的重试完成官方 Electron 下载并成功构建，没有替换为模拟成品。

## 真实 Electron 证据

render-app-flow.mjs 和 render-app-controls.mjs 增加 AVHUB_TEST_PACKAGED_EXE 入口：直接启动指定 EXE，断言 app.isPackaged 为 true。流程还核对真实 process.execPath、process.resourcesPath、已加载原生 DLL 路径；没有覆盖这些属性或从开发源码替换播放实现。PID／音频／计时观测钩子仅包裹成品中原有方法，不改变返回值。

| 验收 | 证据 | 结果 |
| --- | --- | --- |
| 初次 4K HEVC SDR10 成品流程 | build/render-app-flow-JXFDQH/report.json | passed；初次报告未记录退出资源统计 |
| H.264 Unicode 文件与目录 | build/render-app-flow-spdQnG/report.json | passed，含退出资源断言 |
| 4K AV1 MKV Unicode 文件与目录 | build/render-app-flow-ESQXj5/report.json | passed，含退出资源断言 |
| 4K HEVC SDR10 再验 | build/render-app-flow-e14baC/report.json | passed，3840×2160／16-bit PNG |
| 音轨、字幕、保存与播放器切换 | build/render-app-controls-hgNE9L/report.json | passed，真实静音 WASAPI 初始化；非主观音画同步或声音质量验收 |
| 成品准入／缺少资源 | build/render-packaged-policy-Qv3gT8/report.json | 三种情形 passed，见下文 |
| ZIP 解压到新目录后 4K HEVC MKV | build/render-app-flow-mP6vRa/report.json | passed，DLL 从解压目录加载 |

流程以生成视频的真实合成画面条码核对多个跳播目标，检查播放中跳播、空格、缩放、旋转、全屏、纯净播放及截图尺寸。原视频副本 SHA／mtime 不变。记录退出统计的流程确认 helperAlive=false、sourceLeaseReleased=true、纹理 imports=released、leases=closedLeases。它们是合成器像素证据，不是物理屏幕扫描输出时间或主观画质等价认证。

新增 render-packaged-policy.mjs 在自有验收包上逐一测试：

1. 不提供验收开关，即使存在开发候选环境变量，status.available=false，attach 拒绝；原有 Chromium 播放器实际解码帧数增长。
2. 暂时移出验收标记，真实 IPC 明确返回缺少标记；设置显示不可用，仍可关闭设置并退出。
3. 暂时移出主 libmpv DLL，status.available=false，设置不谎报运行库就绪。

每项恢复原资源；不触碰用户视频。该测试没有模拟运行库加载，也没有把拒绝后的视频播放成功冒充原生播放成功。

相关 Node 策略／布局／锁定／播放控制测试 36 项全部通过。git diff --check 通过（现有换行提示保留）。

## ZIP 检查发现与发行边界

现有通用 folder-portable.py 禁止所有 node_modules；而已锁定的原生 FFI 依赖位于 resources/native-render/ffi/node_modules。直接套用普通 ZIP 检查会拒绝这些运行时文件。这是后续原生正式发行需要处理的打包整合项。

本轮没有放松普通发行包过滤规则。本地验收 ZIP 只对 layout.json 中已逐项验证大小／SHA 的原生资源允许该路径，其余沿用普通过滤；ZIP CRC 检查通过。解压后再次运行真实 EXE 验收通过。后续正式 ZIP 应使用明确的原生资源清单白名单，并补齐针对该范围的测试，不能全局放开 node_modules 或隐私目录。

## 当前结论

M5 的**同机、单屏 SDR、本地实际成品与解压搬迁**验收已有证据。默认原生准入、公开发行就绪和完整 M5 没有因此自动放行。

仍需处理：干净机器依赖检查、完整应用及第三方对应源码／许可证发行核查、普通正式 ZIP 的原生资源整合。此前长测原始资源范围观察值仍保留，未宣称消除。实体 HDR、多屏 DPI 继续按用户决定待办。本轮不具备足够证据上传公开正式原生发行版；先提供本地验收包并推进发行检查。
