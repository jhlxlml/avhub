# 冻结的浏览器版 / Frozen browser edition

2026-10-05 保存现有浏览器版的完整源码快照（基线构建 `45e39b81b16823bc`，包含当时未提交的修改）。本次仅归档，不改变主项目支持范围、启动方式、播放逻辑或后续迭代政策；快照不自动同步后续修改。

快照保留原 `run.py` 浏览器启动行为、前后端、依赖锁及当时的文档/测试。为复现原有共享构建标识，历史 Electron 源文件也作为快照内容保留；这只是完整可复现的源码快照，没有拆分或迁移主项目。快照不会被主项目打包引用。

不包含个人视频、数据库、截图、缓存、node_modules、FFmpeg 可执行文件或 EXE。不复制 `.git`、本机代理状态及用户规划文件。原视频均保持原位。

如需复现，在本目录单独安装依赖并执行：

```powershell
python -m pip install -r requirements.txt
npm ci
# 单独提供 FFmpeg/FFprobe（bin 或 PATH），无需复制个人视频
npm run build
python run.py
```

默认使用本目录自己的数据目录；不要设置指向当前桌面库的 `AVHUB_DATA_DIR`。数据迁移应使用应用备份/恢复，不直接让两版共用数据库。首次安装需要网络，日常使用可离线。冻结版不保证兼容未来依赖/系统。

This directory retains a frozen browser-edition source snapshot, including its original launcher and dependency lock. Archiving alone does not change the main project's supported runtimes, launchers or development policy. No personal media/data or executable dependencies are included. Reproduce it independently inside this directory, never sharing the current data directory. It is not a packaging dependency.
