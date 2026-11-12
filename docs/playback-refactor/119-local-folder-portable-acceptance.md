# 当前源码本地文件夹便携包验收

2026-11-12。用户授权按成品验收建议继续；本轮仅本地打包和验收，不升版本、不提交/推送/标签/上传Release。HEAD cc2172bbdd61fd0a6c0dff11aa2f7e712ee981c6，保留全部其他未提交修改及用户文件。生产构建仍6bdfe17b3a77f1aa/0.2.20。

## 输入与构建

既有正式发布输入绑定旧构建3b48d95da686b0fd，不可用于当前源码。本轮使用设计用于本地验收的desktop-render.builder.cjs，保持publish:null及--publish never；没有关闭正式发布凭据校验或原生文件hash校验，没有覆盖dist/electron或旧包。

- 当前工作树冻结为独立源码快照，`application-build-replay-WFbKrJ` 正常npm ci、审计（0漏洞）、前端/TS重建、源码/编译输出一致性 PASS / 0。不是干净外机重建。
- 从该快照重建PyInstaller后端，实际启动验证frozen/build identity/SQLite3.54.1；后端notice与固定SQLite校验 PASS / 0。原默认后端保留。
- `m5-controlled-backend-snvd7dbo` 校验未变的Python源码，加入已验证的源码可追溯FFmpeg CLI及notice，保留原后端EXE字节和新前端/metadata。
- 内嵌运行库niAbRE，宿主cef48433ddaab6c5d574037b79eabcb6946309b35635bd85f9a4f268304c10a1，libmpv5b45550f85ace0822f14d17deb7777c76d229e33c572f94a2f66580e631b42b1；独立MPV wn3ju35e。所有layout/manifest/依赖校验通过。
- Electron44.9.3打包目录 `build/m5-final-desktop-20261112/win-unpacked`，未生成单文件自解压EXE（本轮目标为文件夹ZIP）。

## 字节与隐私检查

本地ASAR审计初次手工命令FAIL / 1：Windows ASAR extractFile需要平台路径分隔符，正斜杠查询appIcon.js返回未找到；实际成员列表包含该文件。改为path.join后，43个Electron JS模块逐字节等于当前编译输出，21个前端文件等于新后端静态资源，91个原生成员逐个hash相符，metadata均6bdfe17b3a77f1aa，PASS / 0。没有将查询错误当成产品文件缺失。

`LOCAL-PAYLOAD-AUDIT.json` 保留上述证据。ASAR不包含archive、用户规划文档或数据库，成品无需Start-render-acceptance.cmd。文件夹ZIP按现有严格规则排除私人数据/缓存/视频/日志，验证FFI和运行库/notice/CRC/build identity。

## 实际成品验收

均直接启动本轮AVHub.exe，使用隔离profile；没有以开发Electron代替成品。验收脚本新增成品分支并核对subject.kind/buildId，避免env传了成品路径却仍执行源码。

- `render-app-flow-BrZnyg` PASS / 0：真实原生像素、精确跳播、截图、缩放旋转/控件/窗口与清理。未设开启通知变量，实际requested=true/received=33；默认优化确已打入。
- `native-independent-6oDOOg/acceptance.json` PASS / 0：包内独立MPV、跳播、截图、控制、关闭保存失败恢复、退出及源文件身份。输入注入/光标隔离是测试策略，不冒充人工物理输入验收。
- `render-library-seek-j62AN0` PASS / 0：实际成品播放五个只读真实片源1240/1001/2378/1186/2629（4K60 MKV、TS、H.264 MP4、HEVC短片、VP9/PQ_HDR），120次绝对定位、24组键盘场景，帧继续更新、源加载一次、所有原片身份不变。HDR为功能测试，不是实屏色彩验收。
- `playback-path-cycle-6z1ikT` PASS / 0：内嵌MPV→独立MPV→Chromium，循环两次；暂停/定位/截图、最小化恢复、返回库，两个原生引擎均关闭且画布移除。
- `render-desktop-package-XJE2xG` PASS / 0：正常双运行库及临时缺失各运行库的明确状态提示。只改名新成品自有文件，Electron退出后还原并校验hash，未永久删除或修改用户文件。
- `folder-release-test-ZpIZfB` PASS / 0：真正解压ZIP，启动frozen后端，隔离旧schema样本升级保留进度/元数据/片单；隐私/排序等偏好保存、自定义数据目录迁移、保留旧目录、三次退出重开。手动更新使用明确模拟响应，无自动后台更新查询。不是对用户真实旧数据库备份的迁移保证。

三次库就绪观察1984/1093/788ms。首轮带旧schema迁移，第二轮带数据目录迁移；含轮询粒度且未清空OS缓存，不能宣称严格冷启动基准。无新的长时间稳定性阻塞测试。

## 产物与决定

`build/m5-final-desktop-20261112/AVHub-folder-portable-0.2.20-x64.zip`，301112581 bytes（287.2MiB）。SHA256：

`3ccf898486d0d923de72d373f07a0e34d9d1ebf4d8a69147af74cd57b254fa8c`

同目录含LOCAL-ACCEPTANCE.json（报告索引及哈希）、LOCAL-ACCEPTANCE.md、LOCAL-PAYLOAD-AUDIT.json和SHA256SUMS.txt。完整解压后运行AVHub.exe；这是未发布的当前本地候选，不能与GitHub上旧同版本号ZIP混淆。

本机成品功能验收通过，可进入后续版本发布准备。正式发布仍须按授权更新版本及Release说明、当前源码材料与正式发布凭据，不能沿用旧0.2.20报告。外机、物理HDR色彩、多屏DPI本轮SKIP；不把旧结果冒充新包结论。本轮无版本或远端变化，语法/diff检查PASS / 0。
