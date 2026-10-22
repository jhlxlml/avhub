# 自动构建与发布

工作流：`.github/workflows/windows.yml`。主项目构建 Electron Windows x64 单文件便携 EXE 与解压即用的文件夹便携 ZIP，不打包网页版归档。

## 触发规则

| 操作 | 测试 | 打包 | 发布 Releases |
| --- | --- | --- | --- |
| 推送 main / 对 main 提 PR | 是 | 否 | 否 |
| 推送 `vX.Y.Z` 正式版本标签 | 是，先核对同提交候选 | 是 | 是，仅本仓库 |
| Actions → Run workflow | 是 | 是 | 否，仅下载 Actions artifact |

版本标签必须与 package.json、package-lock.json 一致，并有 `docs/RELEASE-X.Y.Z.md`。
正式标签不能作为第一次完整云端验收：必须先完成下述同提交候选流程。

版本号仅在准备用户授权的正式版本标签发布时递增补丁号；本地迭代和普通源码推送不升版。一次正式发布汇总累积改动，失败重试沿用已准备的版本。源码推送只测试，另行推送版本标签才打包和公开发布。已经公开的版本和标签不得作为失败重试覆盖。

```powershell
git add <本次源码与发布说明>
git commit -m "release: AVHub X.Y.Z"
git push origin main
# 在 Actions 手动运行候选验收，mpv_validation=false。
# 确认同一提交的完整流程通过、EXE/ZIP 附件仍有效；期间不再修改提交。
git tag vX.Y.Z
git push origin vX.Y.Z
```

将 `X.Y.Z` 换成真实版本。**推送标签即授权 CI 打包并发布**，普通提交不会生成 EXE。不要只为了测试流程推送正式标签，请使用手动 Run workflow。

## 候选验收与正式标签门禁

1. 经用户授权准备版本元数据与说明，提交并普通推送源码。
2. 经用户授权，在 Actions → Windows desktop CI and release → Run workflow 选择
   相应分支，保持 `mpv_validation=false`。手动流程执行完整回归、打包、真实
   EXE/ZIP 验收和校验清单，只生成 Actions 附件，不发布 Release。
3. 对照运行记录的完整提交 SHA。只有成功的手动流程、成功的打包/两个成品验收/
   清单/附件步骤和未过期的 `windows-portable-<SHA>` 附件才有效。普通 main 成功、
   MPV 专项成功、其他提交的成功、过期附件都不满足门禁。
4. 确认后另行获准推送正式标签。标签流程在工具下载前通过只读 GitHub API
   校验上述证据；缺失、API 不可用或无法确认时阻止后续构建发布，不绕过。
   标签流程仍重新构建和验收自己的成品，不把旧候选包改名上传。

候选通过后如果修复代码、版本或发布说明并形成新提交，必须重新候选验收。
候选附件保留 14 天，过期需重新运行。流程不自动创建、移动标签或公开 Release。
这些措施降低可预防失败，但不能保证下载源、GitHub 服务或 runner 永远无故障。

## 本地与 CI 共用验收命令

准备好 `requirements-ci.txt`、锁定的 npm 依赖与运行库后：

```powershell
python scripts/verify-windows.py
python scripts/verify-windows.py --execute
# 或只执行与 CI 完全相同的某一步：
python scripts/verify-windows.py --execute --step 'Backend regression'
python scripts/verify-windows.py --execute --step 'Windows short-path regression'
```

不带 `--execute` 只列出计划。命令直接读取工作流的源码验证步骤，不另维护一份
测试列表；遇到未处理的条件或 GitHub 表达式拒绝执行。本地入口不安装工具，
不打包、不上传、不发布。渲染器依旧只是 harness，真实 Electron 验收步骤保留。
本地入口设 `CI=true` 复用确定性更新 UI 模拟，不视为真实联网更新接口验收。

`npm run test:backend` 与 `npm run test:backend:short-path` 共用后端报告器，
分别保存 `build/backend-tests/normal.*` 与 `short-path-all.*` 的逐项日志和 JSON。
失败时 CI 收集这些报告，含失败测试名与堆栈；不收集数据库或测试视频。
短路径命令在独立真实 8.3 TEMP 下运行完整后端，而不只运行旧的精选用例。
CI 要求真实别名存在，缺失即失败，不用 SKIP 冒充验收通过；不改系统 TEMP。

## 流程与安全

1. Windows 2025 runner 准备 Node 24.19.0、Python 3.13.11 和已测试的 Python 直接依赖。npm 使用 package-lock.json。
   Electron 44 的 npm 包不再通过 postinstall 自动下载运行时；CI 在 `npm ci` 后显式运行 `node node_modules/electron/install.js`，并验证 electron.exe 存在及运行时版本与锁定 npm 包一致。下载失败直接阻止发布，不能跳过真实 Electron 验收。
2. 下载固定 Gyan FFmpeg 9.0.2 essentials 压缩包，校验 `ci/ffmpeg.json` 中的 SHA-256；不自动切换最新版本、不上传 FFmpeg 二进制到 Git。
3. 构建 UI / Electron，运行后端、共享界面测试以及真实 Electron 启动/退出验证。另以真实 Windows 8.3 短临时目录运行截图回归，防止 hosted runner 的 `RUNNER~1` 与完整路径差异造成误判；验证保存目录、实际文件位置及 PNG 文件头，不跳过保存断言。
   真实 Electron 启动故障回归另覆盖窗口创建失败、缺失运行时、完整 45 秒健康等待超时及所属进程树退出；测试只使用隔离配置和专门创建的进程。失败保留 JSON/日志，不上传测试数据库。
4. 标签或手动运行才调用 Windows 打包脚本。从同一 `win-unpacked` 构建单文件 EXE 和文件夹 ZIP。分别验收实际便携 EXE 与从最终 ZIP 解压的 `AVHub.exe`：内部 FFmpeg、默认同级数据目录、重启迁移与偏好保留。ZIP 必须有唯一版本化顶层目录，拒绝链接、路径穿越、用户数据库/配置、媒体文件及网页版归档。CI 中更新提示使用模拟 GitHub 响应，避免共享 IP 限流影响可重复性；不把模拟检查声称为联网验收。
5. 生成 EXE、ZIP、SHA256SUMS.txt、release-build.json；只上传这四个发布文件，不上传整个 build/dist。校验和覆盖两个下载文件，构建清单记录各自文件名、大小与 SHA-256；任一缺失或校验失败都阻止发布。
6. 独立发布任务校验版本、提交和文件哈希，然后创建私有草稿；文件上传验证后才公开。仅发布任务拥有 `contents: write`，使用 GitHub 自动提供的临时 GITHUB_TOKEN，无需个人 Token。Actions 按已核实的完整提交固定。

需要仓库允许 GitHub Actions 执行该工作流；默认 token 可保持只读，工作流只给发布任务提升 contents 权限。组织策略、Actions 配额、下载源可用性和 Windows hosted runner 行为需要首次云端运行确认。CI 配置本身不会改变应用“仅手动检查更新”的行为。

失败不会把未通过验收的包公开。中断后可重跑，只允许恢复同提交、同说明的本流程草稿；已公开版本不会覆盖，应提高版本号发布新版。Artifacts 保留 14 天。自动包仍未代码签名，SmartScreen 提示不会因使用 CI 自动消失。

手动打包仍可用：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1`。`-SkipDependencyInstall` 仅供已确认依赖准备完成的环境（例如 CI）使用。

SQLite 通过 `app/sqlite-runtime.json` 固定官方 x64 下载、压缩包 SHA3-256、DLL
SHA-256 及源码标识。CI 先运行 `scripts/prepare-sqlite.py`，再以
`scripts/python-runtime.py` 执行后端测试，保证使用与 Electron 相同的引擎，不替换
runner 的 Python DLL。直接 `python -m unittest` 不是这条运行库的验收入口，使用
`npm run test:backend`。启动时不下载、校验失败不回退。

Windows 构建配置显式收集项目 DLL 与 manifest，运行时 hook 在应用导入前验证；
后端收集后再次验证仅包含一个 SQLite DLL 且与固定哈希匹配，防止自动依赖分析
捡到系统旧版。正式包和 ZIP 的实际启动验收另断言后端报告的引擎版本/校验状态。
这些配置的本地迭代不等于已做冻结成品验收；只有后续获准打包或标签 CI 才执行。

## 回归覆盖与构建依赖

Mira 深浅主题、无边框控件、内容反馈、弹窗、目录、表单说明、导航、分页、
播放队列、设置滚动及跨模块一致性均进入普通源码推送的组件回归步骤。这些是
明确标注的 renderer harness；不能替代后续真实 Electron 启动、窗口或成品验收。
`tests/test_ci.py` 检查这些用例文件及命令仍存在，防止只在本地运行而漏入 CI。
保存屏障、播放时间线和稳态帧观测的纯逻辑回归也在 CI 中运行。
锁定依赖安装后执行 `npm audit --audit-level=moderate`，已知中危及以上告警或
审计服务不可用会阻止后续步骤，不静默跳过安全门禁。

Vite 固定为已验证的精确版本，传递依赖通过锁文件更新，不使用强制修复或打包工具
降级。旧下载器的可选代理链仅定向覆盖到 `global-agent` 4.1.3，移除未修复的
`sprintf-js` 链。`node electron/test/build-dependency-policy.mjs` 使用本地回环服务
验证打包工具实际依赖的下载器可初始化代理、HTTP 代理路由和 NO_PROXY；不下载
运行库，也不把这个测试当作 HTTPS CONNECT 或外网下载验收。真正运行库下载与
成品测试仍由既有流程负责，失败不得绕过。

经用户授权也可本地发布：先对同源码的实际 EXE/ZIP 执行成品验收，再运行 `python scripts/ci-artifacts.py` 生成校验清单，最后 `python scripts/publish-release.py --publish`。发布器核对干净工作区、远端 main 与正式标签、版本及四项发布文件。需要现有 Git 凭据，不在命令行或日志输出凭据。

手动上传中断后，先核对 GitHub 草稿，再显式执行 `python scripts/publish-release.py --publish --resume`。仅恢复相同提交、相同说明且带本发布器所有权标识的未公开草稿；哈希一致的文件跳过，草稿内失败的同名文件重新上传，最终独立读取远端全部文件的大小/哈希后才公开。不会自动重试写请求、覆盖已公开版本或清空不明草稿。新的本地构建验收不能标注为云端 Actions 通过。

本地复现短路径截图回归（先安装依赖并运行 `npm run build`）：`python tests/check_path_alias.py --ui`。仅在子测试进程中设置临时目录，不修改系统 TEMP，不访问真实媒体库；系统未提供不同的 8.3 别名时明确报告 SKIP，不能视为短路径验收通过。

成品验收 `node electron/test/portable-release.mjs` 与 `--folder` 模式会在各自测试报告目录保存 `startup-timings.json`：启动器到 Chromium/媒体库可操作的总时间，以及桌面日志中的启动阶段。三次启动分别是首次测试启动、显式迁移、无迁移再次启动。采用隔离的合成旧结构库、不清空 OS 缓存，不能代表受控冷启动或所有用户媒体库；只有显式验收/标签构建才生成这些数据。

成品测试现使用隔离的合成旧结构库（一个离线媒体记录和一个片单），由冻结后端
实际升级，逐次断言标题、收藏、标签、评分、进度及片单成员保留；不再先用当前
源码 bootstrap() 升级后才启动成品。该样本不等同用户真实旧库全量验收。第二次
启动仍验证数据目录迁移。经用户授权的本地候选包可使用
`--artifacts-dir=build/<候选目录>`，ZIP 工具相应使用 `--directory`，避免覆盖
默认 dist/electron 中旧包与数据；CI 默认路径不变。

## 两种下载方式

- `AVHub-folder-portable-<version>-x64.zip`：推荐日常使用。解压整个目录到可写位置，再双击其中 `AVHub.exe`。每次启动无需外层自解压，仍需正常初始化 Electron 和后端。不能只复制 EXE、直接在压缩包内启动或删除旁边的运行依赖。
- `AVHub-portable-<version>-x64.exe`：保留现有单文件体验，启动时解压到临时目录。

两者播放链路与原画策略相同，默认数据均在各自运行位置的 `AVHub-data`。文件夹版升级前关闭应用，解压新版本，再将旧 `AVHub-data` 与 `avhub-data-location.json` 保留到新 `AVHub.exe` 旁边；自定义数据目录维持原配置，不要覆盖或合并不同的媒体库。历史已公开版本不会自动补 ZIP，新格式仅随后续授权发布提供。
