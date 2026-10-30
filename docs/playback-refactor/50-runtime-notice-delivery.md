# M5：后台与前端声明的实际交付

本轮继续发行准备，版本保持 0.2.16。没有放宽视频准入、修改播放核心、提高版本、推送或发布；没有更新之前给用户的 EXE／ZIP。

## 后台成品中的材料缺口

实际 PyInstaller Analysis-00.toc 中的外部模块映射到 29 个 Python 分发包，而原成品集中 licenses 目录只有 FFmpeg／SQLite 声明，部分 .dist-info 目录没有整体收录。

新增 scripts/prepare-backend-notices.py，按实际 Analysis 中的模块／扩展模块映射已安装分发包，记录精确版本并复制原始许可证文件；另外收录 PyInstaller 引导器／构建器和 CPython 声明。检查分析结构、未映射依赖、缺失／空声明、已分析依赖或元数据在分析后发生变化等情况，不将错误默认为通过。

当前实际材料为 build/backend-notices-review-pl74x7_m：30 组记录（29 个依赖加 PyInstaller）、36 份文件（含 CPython）。已安装到后台构建暂存目录 _internal/licenses/python-distributions，附 inventory.json 与可读索引。

scripts/build-windows.ps1 在 PyInstaller 与 SQLite 校验之后、Electron 打包之前显式执行该步骤；失败阻止后续打包。既有 Windows CI 调用此脚本，因此准备步骤随脚本接入，但本轮没有运行或宣称云端 CI 成功。

这里交付的是实际版本与声明文件，**不等于已完成所有依赖对应源码、二级原生依赖、许可证义务的最终审阅**。Analysis 对应的是当前既有后台暂存构建，不能据此声称先前已分发 ZIP 自动获得这些新文件。

## 前端实际模块声明

原 public/third-party-ui-licenses.txt 仅是本地改造 UI 的手工声明。新增 scripts/frontend-notices.mjs，利用当前安装的 Vite/Rolldown generateBundle 输出中的 moduleIds 收集实际出现在 JS chunk 清单中的 npm 依赖，与 package-lock 版本一致后复制其原始 LICENSE／NOTICE 等。

生成 app/static/third-party/frontend-notices.json 和对应第三方文本，当前 10 个包，覆盖 React、React DOM、scheduler、HLS、Lucide、Radix、clsx、CVA、tailwind-merge。没有把全部构建工具误称为随前端运行的依赖，没有在输出中泄露本地绝对模块路径。原 UI 改造声明继续保留。

缺少声明或锁文件版本不匹配时构建失败。该插件只生成静态文件，不注入播放逻辑。后续正常后台构建会通过现有 --add-data app/static 将它们带入成品。

## 构建与源码一致性

初次 TypeScript 编译发现 mjs 插件缺少声明，补齐 scripts/frontend-notices.d.mts。随后源码快照测试又发现仓库 *.mts 视频忽略规则排除了该声明；只为这一个源码声明增加精确例外，不放开媒体忽略规则。源码快照选择也支持 .mts／.cts 源码扩展名。

把插件作为构建指纹输入时，首次真实 Electron 检查发现 Node 前端指纹与 Python 后端指纹的输入未同步，因而阻止启动。失败报告 build/render-app-flow-quhbpR/report.json 保留。同步 app/build_info.py 与 write-build-info.mjs 后，补充现有构建指纹测试，验证修改该插件会让两侧摘要同时变化，生成静态输出不会影响摘要。

最终 build=9cba1b2f29e99fee。当前应用源码审阅快照 build/application-source-review-7a6nno9v，806 文件、5,825,099 字节；包含新增构建器、类型声明和后台声明收集器。旧快照未改写，最终发布提交快照仍需另行绑定。

## 验证

- Python 18 项通过：后台声明边界 4、ZIP 9、应用源码快照 2、新原生材料 2、构建指纹 1。
- Node 14 项通过：前端声明 4、宿主终止记录 2、本地准入 4、打包配置 4。
- 实际 npm run build／build:electron 通过；首次缺失类型声明与指纹不同步均先失败后修正，未取消保护。
- 真实 Electron build 9cba1b2f29e99fee：build/render-app-flow-PdN9wA/report.json passed。4K SDR10 的合成目标帧、播放中跳播、空格、原尺寸 3840×2160／16-bit PNG、缩放旋转、全屏纯净模式与退出资源释放均通过。源 SHA／mtime 不变，52 次纹理导入全部释放，宿主退出、源租约释放。
- 实际材料哈希核对：build/m5-notice-delivery-audit.json。后台安装文件与 10 个前端包的输出文件匹配其清单。
- git diff --check 通过，保留原有换行提示。

M5 尚未整体放行。下一步继续核对对应源码与发行交付，并在最终成品中复核新增材料。外部物理机仅有用户确认的 8-bit 完整应用成功；4K 10-bit／交互／长时结果仍不能由本机或单样本代替。
