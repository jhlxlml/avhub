# AVHub 0.2.7

## 修复

- CI 显式安装并校验锁定的 Electron 运行时，修复 npm 依赖安装成功但缺少 electron.exe 的启动验收失败；保留真实启动和退出检查。
- 设置中的“关于”整合为“帮助”，提供使用指南、真实已支持的键盘与鼠标操作，以及关于和手动检查更新入口；统一深浅色与窄窗口样式。
- 修复共享界面截图测试中短路径与完整路径的比较差异。统一隔离测试根目录，并检查截图实际位置及 PNG 文件头；CI 增加真实短 TEMP 下的截图回归。
- 修复云端 Windows 临时目录使用 RUNNER~1 短路径时，迁移、截图、字幕及扫描测试的路径写法不一致。测试夹具遵循生产目录注册的规范路径约定，不跳过原有失败断言。
- 目录注册仅解析一次规范路径；根目录索引保持纯路径比较，不给万级目录扫描增加逐文件磁盘探测。
- 增加真实 Windows 8.3 别名、注册去重、嵌套目录归属及 CI 专项回归。

本地普通路径与真实短路径两种环境均完成全套 294 项回归：293 项通过、1 项跳过。云端结果以对应 Actions 运行记录为准。播放、跳播、原画优先及原文件只读策略不变。

## 升级提示

正式 EXE 只在推送版本标签并通过 CI 验收后发布，普通源码推送不打包。升级前关闭旧版并备份，保留 AVHub-data 与 avhub-data-location.json。便携构建未代码签名，请从本仓库下载并校验 SHA256SUMS.txt。

## English

Fixes CI path fixtures under Windows 8.3 temporary-directory aliases and adds real alias regressions. Root registration resolves once; large-scale root lookup remains filesystem-free. Both full local suites pass (293 passed, 1 skipped each); cloud results must be checked separately. Original-quality playback and read-only source media are unchanged.

Settings now includes Help with an offline guide, supported keyboard/mouse controls and About/manual updates. Screenshot renderer fixtures use a canonical root, verify the saved PNG location and run against a real short TEMP in CI. Local renderer tests: 27 passed; short-TEMP screenshot tests: 7 passed. Electron startup and the final portable build must pass the tagged CI run before release.
