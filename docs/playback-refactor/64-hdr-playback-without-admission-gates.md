# HDR 播放与验证状态

2026-10-30。按用户要求：允许 HDR 原片尝试 MPV 播放，未验证只作记录，不构成播放白名单。未修改默认引擎、版本或历史已验收成品。

## 实现

- 后端原生源合同保留 HDR / 动态 HDR 信息，不再拒绝 PQ、HLG 或 Dolby Vision / HDR10+ 描述。原生窗口色彩检查也不再拒绝 HDR。
- Render API 宿主按探测及解码得到的传递函数选择输出：SDR 维持 BT.709 / sRGB，PQ / HLG 使用 BT.2020 及对应传递函数。target-peak 保持 auto；没有设置视频滤镜或转码任务。
- 解码器在起播后才发现 HDR 时重新配置目标色彩，递增帧代次，退役旧代次未发布帧后再导入新画面，避免把旧色彩画面贴上新标记。
- RGBA16F 共享纹理携带实际输出色彩声明。预加载使用现有 extended RGBA16F WebGPU 画布，由 Chromium / 系统处理最终显示转换；不把 HDR 纹理错误声明为 sRGB。SDR 显示器不能显示真实 HDR 峰值，这与修改源文件、转码是不同层次。
- 设置说明与播放诊断显示 HDR 效果待验证。Dolby Vision 动态元数据、HDR10+、实体 HDR 显示与跨屏准确性未取得证据；没有将其声称为原始信号直通或已认证效果。

## 真实 Electron 验收

本次开发候选 `render-replayed-candidate-VuzF8C`；没有重新打包、上传或推送。

| 样本 | 报告 | 结果 |
| --- | --- | --- |
| 合成 HEVC PQ 10-bit 640×360 | build/render-unverified-color-RA0L2S/report.json | 通过 |
| 合成 HEVC HLG 10-bit 640×360 | build/render-unverified-color-NDqxpq/report.json | 通过 |
| 合成 H.264 BT.709 SDR | build/render-unverified-color-sD9zQj/report.json | 通过 |

每项均在应用实际窗口中验证起播、从 2 秒续播、暂停后准确跳至 8 秒、实际画面变化、源加载一次、零重启、没有 HTML5 回退或转换请求、退出后文件只读身份不变。HDR 验证了实际 VideoFrame 的 BT.2020 / pq 或 hlg 声明及 10-bit 解码，不只是检查后端合同。

这不是实体 HDR 显示亮度、色域、动态元数据或真实长片质量验收。SDR 屏幕截图不能用于证明 HDR 无损直通。尚无新的个人 HDR 长片测试。

16 项 Python 原生源／租约测试、4 项 Node 恢复分类测试、前端及 Electron TypeScript 构建通过。宿主 C# 编译通过。

失败记录保留：早期 FFV1 和 HEVC 生成器未写入完整 VUI，后改用显式 x265 VUI 参数并核验真实导入标记；一次增量构建前后端指纹不同导致启动拒绝，完整重建后通过；VideoFrame 实际使用 Electron 的 pq / hlg 枚举，测试按实际 API 校正。没有删失败记录或降低目标定位精度。

## 依据与后续

[MPV 官方手册](https://mpv.io/manual/stable/) 的 target-prim / target-trc / target-peak；[Electron ColorSpace](https://www.electronjs.org/docs/latest/api/structures/color-space) 的 PQ / HLG 声明；实际本地 Electron 类型定义与 VideoFrame 回执。

原 M5 SDR 成品包的已验收 SHA 与状态保持不变。本次 HDR 是后续源码扩展；普通成品集成及实片／实体显示验收继续单独推进，不用历史 ZIP 证明本次 HDR 变更。
