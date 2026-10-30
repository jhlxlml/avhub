# M5：最终包声明门槛与源码重建实测

## 本轮结果

版本仍为 0.2.16，当前 build 9aed889e7ca3ca73。新建独立本地验收成品，旧成品不覆盖，不推送或上传。没有更改原画准入或引擎默认值。

1. 许可证材料检查不再限于构建目录：打包前和最终 ZIP 都核对声明是否存在、是否与清单的大小／SHA 相符。
2. 完成当前源码快照的独立前端／Electron 重建，并与实际构建核对；不宣称清洁环境或后台／原生闭包的完整重建。
3. 新 EXE、最终 ZIP 解压后的真实 Electron 回归均通过，实际包内材料已核对。

## 交付门槛

folder-portable.py 对后台／前端清单和它们引用的文件复用 verify_notices；目录与 ZIP 都检查，拒绝缺失、篡改、越界路径及空清单。根目录 Electron／Chromium 声明和 resources/licenses/AVHub-LICENSE.txt 纳入成品必需项。检查属于交付一致性，不是签名、二进制来源或法律认证。

package.json 的 prepackage:windows 检查后台暂存目录。专用 native-render.builder.cjs 的 beforePack 也执行检查，避免直接使用该配置时漏过。应用 GPL 文本通过通用 extraResources 交付，默认发行目录和原生默认准入保持原样。

本地验收启动脚本与说明现存入 electron/local-render-acceptance.cmd／txt，replayed 本地配置通过 extraFiles 复制到程序旁；不再依赖手工编写脚本。此轮 EXE 初次构建后按这份同字节来源补入入口文件，再组成最终 ZIP；配置检查验证后续构建的映射，不将这一轮补入过程误写成第二次完整 Builder 构建。

## 新成品

- 目录：build/native-render-acceptance-8iQPIP/win-unpacked。
- ZIP：build/native-render-acceptance-8iQPIP/AVHub-M5-local-acceptance-0.2.16-x64.zip。
- 300,971,680 字节，SHA256 68a8fa7c9f1a27cd5d013bc0e68bad27084ad2be8df32530184da6a7da8b8d2e。
- 后台重新由当前源码构建；SQLite 3.54.1 校验通过；30 组依赖／构建器、36 份后台声明与 10 个前端依赖的声明进入实际包。
- 包内应用许可证、启动脚本与仓库来源逐字节一致。清单、成员 SHA 与 ZIP CRC 校验通过。
- 新编译后台声明审阅目录：build/backend-notices-review-n8lqbqw9。
- 汇总：build/m5-notices-artifact.json。

实际成品 build 9aed889e7ca3ca73 的 4K SDR10 流程：build/render-app-flow-Y0nxXV/report.json passed。最终 ZIP 解压到新目录后的实际 EXE：build/render-app-flow-AbGFQ1/report.json passed。前者保留 3840×2160／16-bit PNG、合成画面目标帧和退出资源证据；后者确认成品搬迁后仍能运行。不是外部物理机新成品验收。

## 从冻结应用源快照重建

源码快照 build/application-source-review-4by_uumb，809 文件、5,837,993 字节；记录预期源构建标识，而不复制应重新生成的 build-info.json。

replay-application-build.mjs 在全新 build/application-build-replay-d3KDr8 中逐项验证／复制源文件，再通过锁文件运行 npm ci --ignore-scripts --offline，随后 npm run build 与 build:electron。

报告 build/application-build-replay-d3KDr8/replay-report.json passed：

- 重新生成的 build_id 同为 9aed889e7ca3ca73，版本一致。
- 39 个 Electron JS 模块与实际构建逐字节一致；当前输出无额外子目录模块。
- 前端依赖的名称、版本、声明文件 SHA 与实际输出一致。
- 构建时间字段允许不同，因此不宣称前端所有 chunk 或整个 EXE 字节复现。

使用本机 Node／npm 和离线缓存，不是全新机器；依赖生命周期脚本未运行。没有在这项应用重建中重新编译 FastAPI 后台、libmpv 或完整系统工具链，不能把本项扩大成整套产品可重复构建认证。

首次 build/application-build-replay-4yMzFU 的编译步骤已成功，但检查脚本错误地读取源快照中被正确排除的生成文件 app/build-info.json，最终报告失败。加入 buildIdentityReference 并生成新快照、重新完整执行后通过；旧报告未覆盖。

## 测试

- Python：18 项通过（ZIP 11、后台声明 4、应用源码 2、构建指纹 1）。
- Node：10 项通过（打包配置 4、前端声明 4、终止记录 2）。
- 真实打包应用两项通过；上述快照重建通过。
- 未变更源媒体，未编辑历史归档；git diff --check 通过，保留原有换行提示。

## 仍须保持的边界

最终发布提交的应用源快照仍需绑定。原生 libmpv 依赖的 FFmpeg 使用 31855b2a7051… 源码；后台单独打包的 Gyan 静态 FFmpeg CLI 使用 9.0.2、构建说明指向 946fcce07b，二者不是同一组件，不能以此前原生闭包的源码材料代替 CLI 的对应材料审阅。Python 分发包的声明收集也不等同于二级原生依赖或所有对应源码义务已审阅。

外部物理机目前只有旧验收包 8-bit 完整应用的用户确认。新成品的外机 4K 10-bit、截图／全屏／退出重开与长时使用仍保留待验收；实体 HDR、多屏按用户决定继续待办。M5 不据本轮结果整体放行，也不自动开启普通发行原生准入。
