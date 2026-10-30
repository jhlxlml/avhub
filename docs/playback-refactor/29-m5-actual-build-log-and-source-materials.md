# M5：实际日志归档、配置证据与项目源码

2026-10-27，接续第 28 批。M5 仍未完成。未修改播放器产品代码、原 DLL、Vulkan、默认引擎、版本或用户视频，未打包、上传或推送。

## 恢复的实际构建证据

通过已连接 GitHub 的 artifact 接口取得固定上游任务 `40191236015 / Build MPV (64, false)` 的 `64_logs`，artifact ID `12599005134`。ZIP 长度 360,920、SHA-256 `7a25f827f79c2f44bbce7845a75174bcd59e356ddfd9d3d89a90d7b5c18ca65b` 与 API 元数据一致；内含 logs.7z（360,677 字节）。固定身份记录在 `ci/libmpv-render-build-artifact.json`，没有保存临时签名下载 URL。

归档含 1,259 个日志条目，读取前核对相对路径、文本后缀、大小和总量。完整日志留在自有 build 证据缓存，不把无关日志加入分发包。

新增 `scripts/catalog-render-build-logs.py`：校验外层固定 artifact 哈希和内层归档对应关系，再直接从归档读取配置日志，避免复用旧解压目录混淆不同批次。得到 21 份包含项目或依赖信息的配置日志；MPV 的成功依赖解析记录 35 条，25 个配方节点已有映射到的配置版本证据。原始行、归档成员名及文本 SHA 保存在 `third_party/libmpv-render-d3d11/build-observations.json`。

实例：libass 0.17.5、libplacebo 7.387.0、lcms2 2.20、libarchive 3.9.0、dvdread 7.1.1、dvdnav 7.0.1。未找到的依赖保持 found=false，找到但未给出版本的依赖保持 version=null；嵌套子项目和编译器的 Git 提交不会被错认成父项目修订。

上游配置中 Vulkan 为 1.4.366，这是上游构建找到的开发依赖记录；应用本地实际准备的 loader 仍为已验证的 1.4.363.0，二者分开记录，不把配置值写成应用 DLL 版本。本轮没有更换加载器或新增 Vulkan 视频呈现模式。

## 项目源码与许可材料

取得对应已确认提交的官方项目源码归档，均不执行：

| 项目 | 提交 | 归档字节 | 本地记录的 SHA-256 |
| --- | --- | ---: | --- |
| MPV | baa3e11d42cb7978da634a8a6a3a55fe074d01be | 8,144,175 | 95ed6c68bae87e0a6e4fae9afa5ceded710733ce0d21796cf4909a40e3dbf887 |
| FFmpeg | 31855b2a7051d07a370984f5e4029826db06be1d | 24,697,217 | 4e46245ab4141ff9a71c0e35aa3b45e55e085cb3687366c976d02ac251272b2c |

来源是各官方 GitHub 仓库固定 commit 的 codeload 地址；本地哈希用于后续一致性检查，不声称它是上游另外签名的发行校验值。原始归档保存于 `build/m5-source-inputs/`，清单保留来源、提交、大小及 SHA。提取 MPV 两份、FFmpeg 五份原始许可/版权文本到 `third_party/libmpv-render-d3d11/notices/`，不改写原文。

这些只补齐两个项目的对应版本源码，不等于全部静态依赖、缓存修改、完整工具链或分发条件已经齐备。materials.json 中对应项目状态明确为 project archive present / transitive pending；所有传递依赖仍为未全部验证，distributionReady=false。

## 候选目录改进

`stage-render-runtime.mjs` 会将上述已有项目许可文本、build-materials.json、build-observations.json 带入新的自有候选目录；核验文件哈希、源材料与实际 libmpv 的身份。新目录 `build/render-runtime-candidate-O1tX4y` 含 28 个清单文件，记录于 `build/render-runtime-staging.json`。这只是目录组装，不是 Electron 成品或发布。

验收包配置的预检查补验 MPV/FFmpeg 许可文件存在，且材料仍未获分发放行。普通 package.json 构建配置、生产拒绝门槛及默认引擎未改变。

## 测试与限制

日志解析新增 4 项合成测试：嵌套项目/编译器提交隔离、缺失与无版本依赖区分、冲突观测不覆盖、UNKNOWN 不冒充确定版本。它们不证明原生库已解码或许可完整。

相关配置、目录完整性、Vulkan 提取和日志解析测试通过；本批没有产品播放代码变化，因此未把过去的 Electron/十五分钟成绩冒称成新运行库验收。

公开任务页面及总摘要可读，但其中未提供完整依赖提交表；页面引用的 summary_partial 返回 404。已取得的日志还明确显示部分项目避免重复 clone、沿用缓存。因此版本号和配置日志仍不能补齐所有精确源码修订，不作“完整对应源码已齐备”的结论。

剩余关键问题：恢复静态依赖的精确修订、补齐相应源码/notice 与缓存修改记录，以及无开发环境的真实成品验收。若上游材料不能恢复，应选择材料可复现的构建路线并重做相关质量验证；不能仅将 readiness 改为 true。M5 继续保持未放行。
