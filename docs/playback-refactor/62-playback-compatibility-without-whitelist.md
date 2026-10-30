# 播放兼容性：取消验收样本白名单

本记录取代旧指南把 M2 验收样本范围当作产品准入的做法。目标是让 MPV 自行解码正常文件；实测覆盖与允许尝试播放分开。

## 实现与边界

- 后端不再限制 YUV420、8/10-bit、BT.709 或编码种类。缺失标记保留 unknown，解码帧标签优先于容器描述，不写回源文件。
- 读取旋转和 SAR，扩展原生渲染表面容纳完整画面；不通过缩小画面满足内存预算。MPV 继续负责实际旋转、像素比例和 SDR 显示色彩转换。
- 去除固定 256 MiB、8192 单边和显存四分之一门槛。分配前按 DXGI 可用预算检查，并受真实 D3D11 16384 单边纹理能力限制；分配失败不降画质。
- 去除 MPV EXE 路径的 8-bit 准入门槛，解码位深交给 MPV。
- 不再按单屏数量或显示查询的验收状态拒绝 SDR。保留显示信息诊断；没有因此宣称多屏 DPI 或物理 HDR 已通过。
- 当前共享纹理导入与前端色彩空间为 sRGB。不能简单取消 HDR 检查使 MPV 隐式映射 HDR；可识别的 HDR 输出不匹配会有界自动切换现有原画路径，不启用视频/音频转码权限。
- 明确的运行库初始化失败、宿主启动退出、HDR 输出不匹配、实际纹理尺寸超限可自动回退一次。源文件不存在/变更/读取失败、保存失败和清理未完成不会作为自动回退条件。恢复仍需完成会话退出与读租约释放，保留进度、暂停状态和全局 MPV 偏好，防止循环。

## 本机构建及实际 Electron 验证

版本保持 0.2.16；源码、前端与 Electron 构建标识 f70c85299841a0f0。运行库目录 `build/render-replayed-candidate-NuOYHv` 为本轮重新编译的宿主与固定 libmpv 闭包，不是新发行包。

| 场景 | 报告 | 结果 |
| --- | --- | --- |
| 12-bit 4:4:4 FFV1 | build/render-unverified-color-puqfts/report.json | MPV 解码 yuv444p12；8 秒定位；无 HTML 回退或转码 |
| SAR 2:1 | build/render-unverified-color-pjtmCv/report.json | 640×360 源在 1280×360 表面显示；8 秒定位 |
| 文件 90° 旋转 | build/render-unverified-color-N5X4Hc/report.json | 360×640 表面；8 秒定位 |
| 明确 BT.601 SDR | build/render-unverified-color-UQI2jn/report.json | 原生播放、8 秒定位 |
| 7680×4320 FFV1，2 fps | build/render-unverified-color-4t4YQo/report.json | 原尺寸表面与跳播通过；不代表 8K 60fps 性能通过 |
| 完整控件、保存、切换 | build/render-app-controls-QA5GWU/report.json | 通过 |
| 4K 10-bit 播放、截图、全屏 | build/render-app-flow-mengAh/report.json | 通过 |
| 有界回退与第二次失败不循环 | build/render-app-faults-handoff-5mtcEg/report.json | 通过 |
| 宿主退出、设备丢失、缺 DLL、文件锁/损坏/缺失及 HDR 分流 | build/render-app-faults-iiky4j/report.json | 通过；默认 MPV 偏好保留，资源释放配平 |

新增兼容矩阵均为生成样本，真实 Electron/真实 libmpv/真实 GPU 呈现与跳播，没有模拟成功响应。保持原文件 SHA256 和修改时间；sourceLoads=1、restarts=0。该矩阵不是全部编码/长视频/所有硬件的认证，也没有证明像素级物理显示色彩准确性。

Python 后端与租约测试 15 项通过；Node 恢复分类、时钟与宿主退出诊断 9 项通过；前端和 Electron TypeScript 构建通过。生成旋转样本最初未写入显示矩阵，改用实际 display_rotation 并核实；MPV yuv444p12 与 FFprobe yuv444p12le 命名差异已在测试中明确接受。早期测试的目录参数错误、构建标识不同步和旧交互预期失败记录保留，没有当作播放成功。

## 尚未完成

- HDR 原样嵌入需要对应的纹理色彩空间、呈现和实体显示验证；当前不假定支持。
- 动态分辨率片源的中途表面重建尚未实现，仍会报告尺寸变化，不能宣称全部视频兼容。
- 本轮新宿主未重新打包，旧 ZIP 不包含本轮修改。成品与相应源码需重新冻结和核验，M5 保持未完成。
- 物理多屏、HDR 与跨机最新成品验收仍需单独进行；没有自动发布或升级版本。

开发态复测（在项目目录 PowerShell）：

```powershell
$env:AVHUB_RENDER_RUNTIME_CANDIDATE='render-replayed-candidate-NuOYHv'
npm run dev
```

设置中选择 MPV 并启用 D3D11 候选。关闭试验可切回现有播放器；无需删除数据库或媒体。
