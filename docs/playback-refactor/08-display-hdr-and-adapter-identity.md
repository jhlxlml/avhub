# M2：真实显示能力与适配器身份

> 后续HDR离屏数值对照与失败路径见 [09报告](09-hdr-offscreen-luminance.md)，HDR显示仍未验收。

2026-10-25。继续隔离M2 PoC，未更改生产引擎或播放器UI，未进入M3–M5。
仅使用应用生成的测试片，未访问E:\downloads；没有修改Windows HDR、DPI或GPU偏好。
无版本升级、远程推送或正式发布。

## 实际实现

- **DisplayProbe.cs**：只读调用DXGI Output6/GetDesc1和QueryDisplayConfig/GetDeviceInfo，
  读取当前窗口对应HMONITOR、DPI、输出位深/色彩空间，以及高级颜色信息2的HDR支持、用户启用、实际模式。
  API不支持时记录未知；旧版高级颜色信息不冒充明确HDR能力。额外记录目标名称/EDID是否有效，省略完整设备路径。
  COM引用和原生缓冲有明确释放，显示拓扑变化最多重试3次，枚举和分配有上限。
  每次创建新DXGI工厂，避免把旧缓存当作当前显示状态。
- **display-contract.cjs/test**：将支持、关闭、未知、策略限制、矛盾信息分别判断；
  克隆/映射歧义、旧API缺少明确能力时保守处理；窗口在SDR屏时不能借用另一屏HDR能力。
  即使合成输入满足HDR信号资格，仍返回 `hdrPlaybackAllowed=false`，因为播放链路尚未验收。
- **SharedSurface.cs**：存在OpenGL Windows外部内存扩展时，读取当前GL上下文的真实设备LUID，
  与DXGI Adapter1 LUID精确匹配。缺少该扩展时仅保留原有唯一厂商候选规则，多候选继续拒绝。
  未知枚举错误、超容量和匹配歧义均不猜选。
- **RenderHost/spike/package**：新增仅供可信测试调用的display命令；记录普通、菜单、全屏、恢复阶段的状态，
  编译/隔离成品纳入新源文件及源指纹；源查询和显示资格测试加入本地回归/Windows CI。
  生产preload没有新增公开权限或任意命令入口。

来源：[微软GetDesc1说明](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_6/nf-dxgi1_6-idxgioutput6-getdesc1)、
[Windows显示结构定义](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/wingdi.h)、
[Khronos设备LUID规范](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_external_objects_win32.txt)。
高级颜色或高位深本身不能证明HDR当前生效；扩展提供的是实际GL设备身份，不是显卡名称比较。

## 本次环境与真实阻碍

当前活动路径是 `\\.\DISPLAY49`，与前轮路径不同，不能把前轮物理显示条件沿用到本轮。
DXGI枚举到两个同名RTX4090，LUID分别为000000000000BC1E、000000000C44C9B0，另有Intel UHD770。
旧规则在 evidence-10jyo2 因同厂商歧义拒绝启动，保留失败记录。
改为GL设备身份匹配后，evidence-N0R7BT显示GL和D3D11均为000000000000BC1E，正常显示与播放通过。
没有取消歧义检查、指定猜测的适配器序号或更改全局GPU设置。

当前窗口的原生显示证据：

| 字段 | 实测 |
| --- | --- |
| 目标窗口DPI | 120，即125% |
| DXGI物理输出范围 | 1920×1080 |
| 当前位深/色彩空间 | 8-bit / RGB_FULL_G22_NONE_P709（值0） |
| 高级颜色信息2 HDR支持 | true，仅是系统报告 |
| 用户HDR启用/高级颜色活动 | false / false |
| 实际颜色模式 | SDR（值0） |
| 亮度、色度参数 | 全零，不能作为有效物理色彩证据 |
| EDID标识 | 无效，目标名称空，连接类型未指定（-1） |

结论是**当前活动信号为SDR、HDR未开启**。不能据此宣称实体屏幕支持HDR，
也不能把它直接断言为某种特定虚拟显示器；目前缺少可信的实体显示能力证据。
独立PowerShell探测未设置同等DPI上下文，尺寸被虚拟化为1536×864；它仅作API排查，
桌面验收采用实际Electron宿主的DPI感知结果。

## 验收结果

- **evidence-wB8rDd**：开发态4K SDR10、877平台、60次实际像素跳播及渲染错误处理通过；
  连续30次原生显示查询，句柄/私有内存增量均0。
- **evidence-UE9fPi**：最终隔离成品4K F16、877平台通过；60次跳播中59次误差0、1次误差1帧，
  均在沿用的1/25秒容差内，不能写成全部零误差。
  普通/菜单/全屏/恢复均映射至同一真实HMONITOR，DPI120、HDR关闭状态一致。
  显示查询30次增量均0；末轮句柄增长0、暂停采样范围0、私有内存增65,536字节、GPU增量0。
  导入/释放96/96，注入导入故障处理成功，退出约108ms，无残留宿主。
- 成品为 `build/libmpv-render-spike/package-20261025T090414913Z/win-unpacked/AVHubRenderSpike.exe`。
  仅作M2本地目录验证，不是AVHub正式发行包。
- Node源契约/M1/显示资格25/25，C#预算策略8/8，Python运行库10/10、CI配置12/12。
  7项显示资格测试是明确的合成边界测试，不是7次实体HDR验收。
  默认拒绝HDR输入的真实负向样本仍通过，见quality-guards-MQpkGc。

NVIDIA本轮原生GPU用量约2.38GiB，私有内存约2.66GiB，明显高于三份共享表面约190MiB的估算。
这些与前轮Intel条件不同，不能作为同条件性能对比，也不能宣称高位深链路已低内存化。
没有调整原画策略或以更低精度换取内存减少。

## 阶段结论和下一步

**M2整体仍未通过，M3–M5禁止提前开始。** 已补齐真实显示探测并修复真实出现的同名GPU选择阻碍。
HDR仍由源契约拒绝，未使用现有BT.709/sRGB设置接收HDR后冒充原画。

当前Electron44.9.3的实际类型定义包含PQ、HLG、linear-hdr与scrgb-linear-80-nits；
[Electron色彩空间文档](https://www.electronjs.org/docs/latest/api/structures/color-space)也描述这些标记。
这仅说明接口可表达HDR，不证明MPV亮度尺度、VideoFrame转换、WebGPU输出与物理显示已经正确衔接。

下一步可先完善独立HDR像素/亮度尺度对照与低预算失败处理，并评估不降低质量的中间资源复用；
实际HDR输出仍需要可信、已开启HDR的显示路径完成验收。混合DPI、更多GPU、长期压力、发布许可材料仍保留未完成。
本轮package.json及用户架构计划保持M0内容，历史网页版归档未改动。
