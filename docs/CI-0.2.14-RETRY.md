# v0.2.14 发布验收修复

## 云端失败证据

- 标签运行 [39219008933](https://github.com/jhlxlml/avhub/actions/runs/39219008933)：编译、后端、全部已配置渲染器分组、真实 Electron 回归及打包通过；`portable-release.mjs:75` 在生成样本查询处抛出 `Cannot read properties of undefined (reading 'find')`。发布任务未执行。
- main 运行 [39219009204](https://github.com/jhlxlml/avhub/actions/runs/39219009204)：回收提示分组 74 条通过，长文件名焦点计时测试失败。同条测试在标签运行通过，原测试在开发机重复 15 次也通过，不认定为稳定复现的产品缺陷。
- 已读取 main 失败追踪：移走焦点后立即推进 11 秒虚拟时间，没有等待 React 被动 effect 清理/重建计时器；DOM 焦点操作完成不等于计时器已重新注册。

## 修复范围

1. 成品验收明确请求 `/api/media?page=1&q=...`，检查 HTTP 状态、分页结构及唯一文件匹配，再执行真实解码帧和源文件哈希验收。不改变生产接口的非分页数组兼容行为。
2. 回收提示测试冻结虚拟时钟，在测试页面观测真实 10 秒计时器的注册/取消，等待 effect 生效后再推进时间。不增加超时、不跳过断言、不更改生产提示时长或行为。
3. 补充提示内部焦点切换、鼠标与焦点交叠用例；二者均离开后，验证第 9,999 毫秒仍在、第 10,000 毫秒消失。
4. 不改播放实现、原画权限、系统回收或版本号；归档源码保持冻结。按用户授权更新尚未发布的 v0.2.14 标签。

## 验证

- 两个计时场景各重复 15 次，共 30 次通过。
- 云端失败的完整分组（回收记录、筛选、来源变化、封面、原生播放器桥接、媒体记忆和界面）76 条通过；原分组 75 条，本轮新增 1 条交叠场景。
- `node electron/test/recycle-shortcuts.mjs` 真实 Electron 系统回收/恢复通过，只操作新建 GUID 临时样本，原内容哈希和收藏、进度保留。
- 本地重新执行 `scripts/build-windows.ps1 -SkipDependencyInstall` 成功，版本仍为 0.2.14，生产构建标识仍为 `14319a3857cb0fee`（本轮不改生产代码）。
- 在 `CI=true`（只模拟检查更新的 GitHub 返回，不模拟媒体查询或视频解码）下，实际单文件 EXE 和实际解压 ZIP 成品验收均通过：真实冻结后端和 FFmpeg、生成 640×360 MP4 的新解码帧、源哈希不变、默认数据目录、自定义目录迁移、设置保留、旧目录保留、三次启动退出。
- 成品报告：`build/portable-release-test-nQVJwM/startup-timings.json`、`build/folder-release-test-FtVjfq/startup-timings.json`。报告及所有二进制、用户数据、下载追踪均在忽略目录，不提交 Git。
- `git diff --check` 和稳定版本/锁文件/发布说明校验通过；不改 README 或历史网页归档。

测试使用新建隔离媒体库和生成 SDR MP4，不访问或修改用户视频。组件计时测试不是浏览器产品验收；成品检查使用真实打包 Electron。云端重试结果由 GitHub Actions 单独判断，不以本机通过替代。
