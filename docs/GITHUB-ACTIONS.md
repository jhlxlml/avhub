# 自动构建与发布

工作流：`.github/workflows/windows.yml`。主项目构建 Electron Windows x64 单文件便携 EXE 与解压即用的文件夹便携 ZIP，不打包网页版归档。

## 触发规则

| 操作 | 测试 | 打包 | 发布 Releases |
| --- | --- | --- | --- |
| 推送 main / 对 main 提 PR | 是 | 否 | 否 |
| 推送 `vX.Y.Z` 正式版本标签 | 是 | 是 | 是，仅本仓库 |
| Actions → Run workflow | 是 | 是 | 否，仅下载 Actions artifact |

版本标签必须与 package.json、package-lock.json 一致，并有 `docs/RELEASE-X.Y.Z.md`。例如下一版准备好后：

版本号仅在准备推送源码时递增，本地连续迭代不逐次升版；一次推送汇总为一个版本，失败重试不再递增。已准备好但尚未推送的版本继续沿用，不重复升版。源码推送与正式发布仍分开：源码推送只测试，另行推送版本标签才打包和公开发布。

```powershell
git add <本次源码与发布说明>
git commit -m "release: AVHub X.Y.Z"
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

将 `X.Y.Z` 换成真实版本。**推送标签即授权 CI 打包并发布**，普通提交不会生成 EXE。不要只为了测试流程推送正式标签，请使用手动 Run workflow。

## 流程与安全

1. Windows 2025 runner 准备 Node 24.19.0、Python 3.13.11 和已测试的 Python 直接依赖。npm 使用 package-lock.json。
   Electron 44 的 npm 包不再通过 postinstall 自动下载运行时；CI 在 `npm ci` 后显式运行 `node node_modules/electron/install.js`，并验证 electron.exe 存在及运行时版本与锁定 npm 包一致。下载失败直接阻止发布，不能跳过真实 Electron 验收。
2. 下载固定 Gyan FFmpeg 9.0.2 essentials 压缩包，校验 `ci/ffmpeg.json` 中的 SHA-256；不自动切换最新版本、不上传 FFmpeg 二进制到 Git。
3. 构建 UI / Electron，运行后端、共享界面测试以及真实 Electron 启动/退出验证。另以真实 Windows 8.3 短临时目录运行截图回归，防止 hosted runner 的 `RUNNER~1` 与完整路径差异造成误判；验证保存目录、实际文件位置及 PNG 文件头，不跳过保存断言。
4. 标签或手动运行才调用 Windows 打包脚本。从同一 `win-unpacked` 构建单文件 EXE 和文件夹 ZIP。分别验收实际便携 EXE 与从最终 ZIP 解压的 `AVHub.exe`：内部 FFmpeg、默认同级数据目录、重启迁移与偏好保留。ZIP 必须有唯一版本化顶层目录，拒绝链接、路径穿越、用户数据库/配置、媒体文件及网页版归档。CI 中更新提示使用模拟 GitHub 响应，避免共享 IP 限流影响可重复性；不把模拟检查声称为联网验收。
5. 生成 EXE、ZIP、SHA256SUMS.txt、release-build.json；只上传这四个发布文件，不上传整个 build/dist。校验和覆盖两个下载文件，构建清单记录各自文件名、大小与 SHA-256；任一缺失或校验失败都阻止发布。
6. 独立发布任务校验版本、提交和文件哈希，然后创建私有草稿；文件上传验证后才公开。仅发布任务拥有 `contents: write`，使用 GitHub 自动提供的临时 GITHUB_TOKEN，无需个人 Token。Actions 按已核实的完整提交固定。

需要仓库允许 GitHub Actions 执行该工作流；默认 token 可保持只读，工作流只给发布任务提升 contents 权限。组织策略、Actions 配额、下载源可用性和 Windows hosted runner 行为需要首次云端运行确认。CI 配置本身不会改变应用“仅手动检查更新”的行为。

失败不会把未通过验收的包公开。中断后可重跑，只允许恢复同提交、同说明的本流程草稿；已公开版本不会覆盖，应提高版本号发布新版。Artifacts 保留 14 天。自动包仍未代码签名，SmartScreen 提示不会因使用 CI 自动消失。

手动打包仍可用：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1`。`-SkipDependencyInstall` 仅供已准备依赖的 CI 使用。

本地复现短路径截图回归（先安装依赖并运行 `npm run build`）：`python tests/check_path_alias.py --ui`。仅在子测试进程中设置临时目录，不修改系统 TEMP，不访问真实媒体库；系统未提供不同的 8.3 别名时明确报告 SKIP，不能视为短路径验收通过。

成品验收 `node electron/test/portable-release.mjs` 与 `--folder` 模式会在各自测试报告目录保存 `startup-timings.json`：启动器到 Chromium/媒体库可操作的总时间，以及桌面日志中的启动阶段。三次启动分别是首次测试启动、显式迁移、无迁移再次启动。采用隔离空库、不清空 OS 缓存，不能代表受控冷启动或所有用户媒体库；只有显式验收/标签构建才生成这些数据。

## 两种下载方式

- `AVHub-folder-portable-<version>-x64.zip`：推荐日常使用。解压整个目录到可写位置，再双击其中 `AVHub.exe`。每次启动无需外层自解压，仍需正常初始化 Electron 和后端。不能只复制 EXE、直接在压缩包内启动或删除旁边的运行依赖。
- `AVHub-portable-<version>-x64.exe`：保留现有单文件体验，启动时解压到临时目录。

两者播放链路与原画策略相同，默认数据均在各自运行位置的 `AVHub-data`。文件夹版升级前关闭应用，解压新版本，再将旧 `AVHub-data` 与 `avhub-data-location.json` 保留到新 `AVHub.exe` 旁边；自定义数据目录维持原配置，不要覆盖或合并不同的媒体库。历史已公开版本不会自动补 ZIP，新格式仅随后续授权发布提供。
