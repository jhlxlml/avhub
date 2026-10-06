# AVHub 0.2.3 / Release notes

Windows x64 便携版，下载 EXE 后双击运行，无需安装 Python、Node.js 或 FFmpeg。

## 新增与优化

- 设置 → 关于：版本号旁新增手动“检查更新”。仅点击后联网，不后台检测、不自动下载或安装；查看 GitHub 正式发布与 Windows 下载包，更新说明安全地按纯文本显示。
- 左侧多级目录树默认收起，按需展开、逐层分页、视频数量、键盘导航、深层目录定位；支持万级目录的有界展示。
- 默认按添加时间排序，排序字段与升降序保存到媒体库。分辨率筛选独立放在右侧工具区；统一 4K、2K、FHD、HD 等徽标。
- 设置中新增关于与应用介绍，修复重复打开后的残留提示。
- 默认数据目录为应用旁的 AVHub-data，可在数据管理中选择自定义空目录；下次启动迁移数据库、记录、封面，旧目录保留。

## 升级提示

请先完整备份并关闭旧版本。保留 AVHub-data 和 avhub-data-location.json；不要把数据目录当作缓存删除。自定义数据路径保持原绝对路径，迁移上限 2 GB；原视频和截图不会搬动。原文件始终只读，原画优先，不自动降低画质。

便携 EXE 未进行商业代码签名，Windows SmartScreen 可能提示未知发布者。请只从本仓库 Releases 下载，并核对同页 SHA-256。

## 验收与限制

完整后端回归：285 项通过、1 项跳过。已验收真实便携 EXE 的内置 FFmpeg、零后台更新检测、手动 GitHub 检查、默认数据位置与重启迁移。长期 HEVC / HDR 原画播放仍受系统解码能力和现有样本限制，不代表所有片源均已验证。

构建依赖审计仍报告 10 项构建工具链告警（含 2 项高等级）；相关 npm 构建工具与 node_modules 不在应用包内，未在本轮强制变更依赖链。此说明不等同于对整个运行环境作无漏洞保证。

## English

Portable Windows x64 build, with Python, FFmpeg and Electron bundled. Manual update checks live next to the version in About; no startup checks, automatic downloads or installation. Includes the lazy directory tree (collapsed by default), persistent sorting, resolution filters/badges, improved About UI, and restart-time migration to a custom data directory while retaining the old library.

Back up and close the old app before upgrading. Keep AVHub-data and avhub-data-location.json. Original media remains read-only and original quality remains preferred. This build is unsigned; download only from this repository and verify the SHA-256 asset.
