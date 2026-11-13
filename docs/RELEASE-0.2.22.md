# AVHub 0.2.22

## 改进与修复

- 优化内嵌 MPV 截图交互：画面生成 PNG 后，目标文件保存期间仍可播放、暂停、跳播和调节音量，避免控件看似失灵。
- 修正内嵌播放信息的编码显示，区分定位耗时与包含排队的总等待；明确未采集指标，不显示误导数据。
- 整理播放引擎设置：独立窗口、D3D11 内嵌及旧窗口叠层统一为显示方式选项，保存失败时保留原设置；播放控制试验开关收进高级选项。
- 内嵌 MPV 的上一条、下一条根据真实队列状态启用或禁用，减少无效点击与重复切换。
- 修复鼠标前进、后退侧键的作用范围：视频画面及控制区内对应快进、快退，播放器外保留原有行为。默认 5 秒，可在设置中调整；兼容系统与 DOM 双通道输入，避免一次点击重复跳播。
- 保留 Chromium、独立 MPV 和 D3D11 内嵌三条播放路径，保持已有默认引擎、偏好和原画质量策略。

## 使用提示

- 更改默认播放引擎、显示方式或跳播模式，对之后打开的视频生效。
- “统一播放控制”和“增强会话管理”仍为默认关闭的试验选项。
- 本次更新不宣称所有设备的物理 HDR 色彩、多屏 DPI 或实体鼠标驱动均完成验证。

## English

- Keep embedded MPV transport controls responsive while an already encoded screenshot is being saved.
- Correct codec reporting and distinguish seek completion time from total queued latency.
- Consolidate MPV presentation choices and move experimental playback controls into advanced settings.
- Respect embedded playback queue boundaries and prevent duplicate navigation.
- Limit mouse Back/Forward seeking to the video surface and controls. Preserve normal handling elsewhere, retain the configurable five-second default, and deduplicate OS/DOM input.
- Preserve all three playback paths, existing preferences and original-quality playback policies.
