# M5：显式本地成品验收入口

2026-10-28。继续报告 42。版本保持 0.2.16，本轮未运行 electron-builder、未生成 EXE/ZIP、未上传或推送。新增的是受限本地验收入口与资源测试，不是成品或干净机器通过证明。

## 入口条件

仅当应用实际为 packaged，且启动环境 `AVHUB_RENDER_LOCAL_ACCEPTANCE=1`，并存在合格的 resources/local-render-acceptance.json 时，才允许新的固定重放候选进入本地验收路径。

标记包含 schema=1、purpose=local-render-acceptance、固定 cohort、候选标识、runtime.json 的 SHA256、distributionReady=false。缺失标记、错误 cohort/schema/路径/状态或清单变化都会拒绝。

- 普通发布没有该启动开关时继续关闭 Render API 打包态播放；不会因开发目录选择变量自动开放。
- 只允许已固定的新重放闭包；宿主、主 DLL、28 个依赖与源码继续执行原有完整性校验，不接受任意库。
- 所有运行库／FFI／原生源码路径均从 resources/native-render 解析，不依赖项目 build 目录。
- RenderPlayer 与 RenderTexture 共用解析入口；主服务成功解析的打包态选择会缓存，控制操作不重复读标记。FFI 仍在会话创建时执行既有校验。
- 该开关不写入播放偏好，也不切换默认引擎；环境变更需重启。标记是本地测试选择，不是数字签名或发行批准。

## 资源配置

专用 electron/native-render.builder.cjs 为重放候选生成独立标记文件，加入 ASAR 外资源；不改写冻结候选。preflight 核对固定闭包和文件清单，并拒绝清单在生成标记后变化。

普通 package.json 的发布配置和产物位置不变；专用配置仍 publish=null、产物标记 acceptance，并拒绝标签发布上下文。配置加载及 preflight 只创建几百字节的测试标记，不调用打包器。

未来经授权生成本地成品后，启动该专用成品仍需显式设置上述环境开关。普通包或缺少标记的目录不因此可用。不能用环境变量跳过 DLL/源码/FFI 校验。

## 本轮测试证据

### 策略与资源布局 harness

相关 Node 测试 **36 项通过**，包含：默认关闭、错误标记拒绝、清单绑定、新旧候选隔离、资源 preflight、标签拒绝及此前实际 ABBA 数据核对。

其中 render-local-acceptance.test.mjs 向纯布局解析函数传入 packaged=true 检查路径策略，明确是 **资源路径／策略 harness**，没有创建或运行 packaged Electron，不能当作实际成品验收。

### 实际搬迁的原生资源

证据 `build/render-local-resources-Y40np8/report.json`：把真实闭包复制到自有隔离 resources/native-render，使用生成的验收标记，限制 PATH 为 Windows 系统目录，然后启动实际 C#／D3D11 宿主和新 libmpv。

验证目标 1.24 秒的截图，640×360 原尺寸、条码第 31 帧正确，源摘要不变，宿主退出正常。参考 FFmpeg 仅以明确的项目路径解码测试 PNG。

该项没有启动 Electron 成品、未检查搬迁后 Electron 合成与 FFI 实际导入，也不是没有开发环境的机器。它验证的是资源搬迁后原生宿主／DLL 路径可用，不能替代干净机器结果。

### 真实 Electron 开发态回归

入口接入后的 build d8d767c323718bd5：

- 4K SDR 10-bit、截图、跳播及窗口流程：build/render-app-flow-rU5yJU/report.json；
- 控制／轨道／播放器切换：build/render-app-controls-E2qbsH/report.json；
- 旧默认路径：build/render-app-flow-jNGkrn/report.json。

三项 passed。随后只修正设置页的状态文案：D3D11 模式显示其自身可用性，不再沿用 MPV EXE 的不可用提示，明确单屏开发／显式本地验收与普通发布范围。最新前端 build b578a8bbb16aa84a 的真实设置回归：build/render-settings-status-RDmGl5/report.json，开关保存、状态显示及正常退出通过。

首次设置回归 build/render-settings-status-rtSpRV/report.json 失败，原始错误为 `uncheck()` 在异步保存完成前检查受控 checkbox 的即时状态；随后测试在设置仍开着时直接退出，进入原生“退出前保存失败”对话框并等待。用户关闭该提示后正常结束，失败记录保留。

测试改为真实点击、等待 PATCH 保存响应和勾选状态、关闭设置，再退出；并在清理前写报告，避免关闭阻塞掩盖错误。没有取消产品的保存保护，没有将首次失败改写为成功，也未据此宣称修复了产品退出缺陷。

## 尚未完成的 M5 条件

当前已具备显式本地入口、资源 preflight、搬迁宿主检查及开发态回归。下一步需要**实际生成并运行专用本地验收成品**，验证 packaged Electron 的前端、后台、FFI 合成、原画播放、退出与故障提示，再做干净机器及发行材料检查。

本轮遵守 AGENTS.md 的迭代约束：`During iteration, do not package or publish unless the user requests it.` 因此尚未执行成品构建。正式发布、默认切换、实体 HDR／多屏以及此前保留的资源波动均没有自动放行。
