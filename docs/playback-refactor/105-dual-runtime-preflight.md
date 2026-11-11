# 双 MPV 运行库与成品入口衔接

日期：2026-11-11。HEAD：f3f65dbc321b54541f09be6b1558fb9e4f5eab27。
沿用未提交修改；版本仍为 0.2.19。本轮不打包、不提交、不推送、不发布。

## 实际问题与修改

- `native-render.builder.cjs` 仅接受旧布局 scope，且验收标记固定写旧 cohort，不能正确接入已测的 MKV Cues 修复 DLL。新增 `render-candidate-policy.cjs`，按已固定的 cohort/DLL 对选择布局与标记；旧运行库仍可使用。未知对象、错误 scope 或自行提升 distributionReady 均拒绝。
- `resolveRenderRuntime` 的两种成品标记入口也仅接受旧 cohort。现接受两种固定 cohort，保留原有目录、清单哈希、二进制/依赖校验；额外要求标记 cohort 等于实际清单 cohort。并非允许任意新 DLL。
- 新增 `npm run check:mpv:dual`：只读检查本地已选双运行库、全量 native layout、独立 EXE/依赖、共同源码版本/补丁，以及补丁与 LuaJIT 源码的原始/暂存哈希、原生宿主源码哈希。报告明确 `distributionReady:false`。加 `--release` 始终拒绝以本预检替代正式发布证据。
- 现有 schema-2 发布证明、真实成品测试、源码 ZIP 成员验证和 `prepare-desktop-release-inputs.py` 均未削弱，亦未生成新发布凭据。历史材料和历史报告不改写。
- 将标记/发布证明契约测试纳入串行播放回归入口。修正既有两个标记测试固定旧 cohort 的假设，使其绑定复制的实际清单；新测试独立覆盖旧/新 cohort 和错配。

## 验证记录

| 检查 | 结果 | 退出码 | 证据/范围 |
| --- | --- | --- | --- |
| build:electron | PASS | 0 | TypeScript 编译 |
| npm run build | PASS | 0 | 应用 build 52cb48e6622d3a81；保留 Vite 配置/分块警告 |
| 19 项标记、目录和发布证明契约 | PASS | 0 | build/dual-mpv-policy-tests.log；不是解码验收 |
| 双运行库/源码材料预检 | PASS | 0 | build/dual-mpv-preflight.json |
| 预检尝试作为发布证明 | 预期拒绝 | 1 | build/dual-mpv-release-blocked.json |
| 只加载 desktop-render 配置 | PASS | 0 | build/dual-mpv-builder-load.json；新 cohort、publish:null；没有调用打包 |
| 真实 Electron 内嵌播放 | PASS | 0 | build/render-app-flow-iGkzOv/report.json；跳播像素、截图、资源释放；开发成品非 EXE |
| 真实 Electron 独立窗口音轨/字幕 | PASS | 0 | build/independent-tracks-cjqwUL/report.json；双音轨、字幕截图像素、重开恢复、样本未变 |
| git diff --check | PASS | 0 | 有 CRLF 规范化提示，无空白错误 |

失败记录保留：首轮契约 17/19（退出 1）发现既有测试复制新清单却写旧 cohort；修改 fixture 后 18/19（退出 1）遗漏原测试仍使用的 pin import，补回后 19/19。独立字幕首轮 `independent-tracks-ddRdi2` 退出 1：测试未等待第一次字幕切换即再次点击，最后观察到关闭；现在每次点击等待 sid 真正变化后再决定是否继续，重跑通过。没有降低字幕断言或隐藏错误。

## 尚未放行

新 EXE/ZIP、迁移、外机、物理 HDR/多屏及正式源码交付均未在本轮验证（SKIP），不能继承旧成品结论。现有源码交付流程仍有旧固定材料数量及旧基线审计，需在下一轮按真实材料清单核对；本轮预检不是完整许可证/对应源码交付认证。正式发布仍 BLOCKED，需用户授权打包后，为最终应用与双运行库生成新的成品验收、源码材料和 schema-2 凭据。

回滚本轮：恢复 builder/resolveRenderRuntime 两处入口及测试改动，移除新增预检/策略入口即可；两套二进制、开发默认引擎、用户设置及原始视频均未修改。此前修复运行库回滚方式仍见 103、104。
