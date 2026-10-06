# 自动构建与发布

工作流：`.github/workflows/windows.yml`。主项目只构建 Electron Windows x64 便携版，不打包网页版归档。

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
2. 下载固定 Gyan FFmpeg 9.0.2 essentials 压缩包，校验 `ci/ffmpeg.json` 中的 SHA-256；不自动切换最新版本、不上传 FFmpeg 二进制到 Git。
3. 构建 UI / Electron，运行后端、共享界面测试以及真实 Electron 启动/退出验证。
4. 标签或手动运行才调用 Windows 打包脚本，并验证实际便携 EXE 的内部 FFmpeg、默认目录和迁移。CI 中更新提示使用模拟 GitHub 响应，避免共享 IP 限流影响可重复性；真实 GitHub 检查有独立逻辑测试和既往本地 EXE 验收，不把模拟检查声称为联网验收。
5. 生成 EXE、SHA256SUMS.txt、release-build.json；只上传这三个发布文件，不上传整个 build/dist、个人配置、视频或缓存。
6. 独立发布任务校验版本、提交和文件哈希，然后创建私有草稿；文件上传验证后才公开。仅发布任务拥有 `contents: write`，使用 GitHub 自动提供的临时 GITHUB_TOKEN，无需个人 Token。Actions 按已核实的完整提交固定。

需要仓库允许 GitHub Actions 执行该工作流；默认 token 可保持只读，工作流只给发布任务提升 contents 权限。组织策略、Actions 配额、下载源可用性和 Windows hosted runner 行为需要首次云端运行确认。CI 配置本身不会改变应用“仅手动检查更新”的行为。

失败不会把未通过验收的包公开。中断后可重跑，只允许恢复同提交、同说明的本流程草稿；已公开版本不会覆盖，应提高版本号发布新版。Artifacts 保留 14 天。自动包仍未代码签名，SmartScreen 提示不会因使用 CI 自动消失。

手动打包仍可用：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1`。`-SkipDependencyInstall` 仅供已准备依赖的 CI 使用。
