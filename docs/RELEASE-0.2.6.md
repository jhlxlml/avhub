# AVHub 0.2.6

## 更新

- 新增 GitHub Actions：普通 main / PR 提交执行测试；正式版本标签触发 Windows x64 便携构建、EXE 验收、校验文件生成与 Releases 发布。手动运行 Actions 只构建、不发布。
- 主项目仅维护 Electron 桌面版，统一桌面启动入口与原生文件夹操作；内部 React / FastAPI 与原画播放链路保留。
- 封面墙收藏按钮默认隐藏，悬停或键盘聚焦显示；收藏原位更新，避免重建缩略图和预览造成闪烁。

## 使用与升级

下载便携 EXE 后双击运行。升级前先完整备份并关闭旧版，保留 AVHub-data 与 avhub-data-location.json。原视频保持只读；更换数据目录在下次启动复制媒体库，旧目录保留。

本构建未代码签名，Windows SmartScreen 可能提示未知发布者。请从本仓库 Releases 下载，并核对 SHA256SUMS.txt。release-build.json 可追溯源码提交及界面构建标识。真实 HDR / 长 HEVC 仍受系统和现有样本限制，不代表所有片源都已验证。

## English

Adds tag-triggered Windows portable CI releases, while regular commits run tests only. Includes the desktop-only policy and stable in-place cover-wall favorite changes. Back up first; keep AVHub-data and avhub-data-location.json. Original media stays read-only and original quality remains preferred. Unsigned build; verify SHA256SUMS.txt and consult release-build.json for provenance.
