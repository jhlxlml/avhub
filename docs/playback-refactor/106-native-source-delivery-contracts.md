# 双运行库源码交付核对

2026-11-11，HEAD `f3f65dbc321b54541f09be6b1558fb9e4f5eab27`；版本保留 0.2.19。保留全部此前工作区修改。本轮仅调整 Python 材料收集、只读审计和发布校验，未修改播放器、运行库二进制、画质参数或原始媒体。

## 发现并处理

1. `stage-native-source-materials.py` 之前仅收集历史依赖构建，未明确加入当前 MKV 补丁、兼容构建记录和对应配方。现新增这些输入并保留原有暂存记录的历史测试状态，不改写旧证据。新增 `--audit-only`，只读取和校验，不创建材料副本或更新 latest 指针。
2. `stage-m5-source-delivery.py` 现在拒绝将旧 cohort 的原生 dossier 用于新运行库；确认补丁进入材料索引，并补上此前未交付的 `NATIVE/README.txt`。交付索引新增逐项 `nativeSourceInputs`，含 id、revision、路径及 SHA256；不再只依靠“22 个”的数量判断完整性。
3. `native_source_delivery.py` 为源码生成、`prepare-desktop-release-inputs.py` 和 `ci-artifacts.py` 共用：核对两套 MPV 的源码身份和补丁、精确源码成员、构建配方哈希、补丁前后源码哈希、实际 ZIP 成员哈希，并拒绝未索引成员或重复成员。最终资产检查还把源码包中的两套 runtime.json 字节与实际便携 ZIP 比较，避免内部自洽但属于另一套运行库的材料混入。
4. 新增 `npm run check:mpv:sources`（`audit-dual-mpv-sources.py`）：只读审计当前双运行库的源输入、补丁和配方。不是源码交付 ZIP、许可证认证、GPU 或成品验收。
5. 原生 dossier 测试支持已知的旧/新固定 pin，仍校验所有复制字节。发布前的强制本地材料检查加入新的源码交付契约测试；未移除原有任何实际构建证据组。

## 测试与证据

| 检查 | 结果 | 退出码 | 记录 |
| --- | --- | --- | --- |
| 当前源码只读审计 | PASS | 0 | `build/dual-mpv-source-audit.json`：22 个源码归档（21 个原生依赖与 MPV + LuaJIT），586727608 字节文件校验，copiedBytes=0 |
| 源码交付、CI、便携包、源码身份与 gate 回归 | PASS | 0 | 39 项，无 SKIP；`build/native-source-delivery-regression.log` |
| 强制本地实际构建/历史材料证据检查 | PASS | 0 | 21 项，无 SKIP；`build/source-delivery-local-evidence.log`。包含既有历史材料证据，不是当前成品通过证明 |
| Python compileall | PASS | 0 | 本轮修改的 6 个材料/校验脚本；后续修改由真实导入与回归覆盖 |
| git diff --check | PASS | 0 | 仅 CRLF 规范化警告 |

回归包含同数量替换源码、补丁缺失、旧 cohort、配方缺失、补丁后的源码哈希不同、未索引/损坏 ZIP 成员、源码运行库与实际包不一致等失败契约。ZIP 测试是极小合成文件，不是实际交付包或播放证据；使用临时测试目录，不生成视频副本。

中间失败如实记录：`test_local_build_evidence` 初跑退出 1，其旧断言固定证据组数量为 6；本轮增加第 7 组后失败。改为明确要求原有六组及新组均存在，最终通过，没有删除旧组或允许 SKIP。

## 仍待准备的发布材料

只读审计明确返回 `existingDossierMatchesSelected:false`：现存 `native-replayed-source-materials-4xtgeo89` 属于旧 cohort。它继续作为历史证据保留，不改标签；当前交付入口会拒绝复用。准备用户授权的下一轮成品时，需重新生成当前 cohort 的 dossier、冻结应用/后端源码及重放，再生成源码 ZIP 和当前应用绑定的成品验收/发布凭据。

本轮没有运行交付 ZIP 生成、EXE 打包、HDR/多屏或外机验收（SKIP）；没有升版本、commit/push/tag 或发布 Release。旧 `audit-m5-final-package.mjs` 是固定 0.2.16 的历史审计脚本，未作为本轮或未来新成品的放行入口。

回滚：恢复本轮材料脚本/测试及 package scripts 改动，并移除新增的共用契约和只读审计脚本；无需替换两套运行库或迁移用户数据。现有本地报告保留作历史记录。
