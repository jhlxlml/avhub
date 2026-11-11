# 多片源跳播与重复指令追踪

2026-11-09。用户授权本地所有视频用于测试，原文件仍只读。本轮延续 94，优先追查额外 5 秒指令，再测试内嵌 MPV 的偶发长等待。不打包、提交或推送，版本保持 0.2.19，保留原有未提交修改。

## 重复写入的进一步证据

`mpv-seek-paired-Wve827/report.json`：FAIL / 1，完成 102 组后指令超时。实际发送记录显示 request_id=943 的同一条 +5 script-message-to 在约 32615.9944 和 32616.3397 ms 两次进入 socket.write；末次实际目标从期望 578.395 变成 588.395 秒。sourceLoads=1、d3d11va、管道未关闭、无缓存等待。这将问题缩小到发送链路，不能再仅归因于解码或提示状态。

随后给发送记录加入调用栈。`mpv-seek-paired-X5MzmD/report.json`：PASS / 0，200 组完成，保留的最近 256 条写入无重复 request_id；尚未取得失败时的重复调用栈，不据此宣布解决。

针对实际重复 request_id，进一步去掉单独的 writes 数组：同一个有界 requests Map 同时拥有命令内容、超时和 sent 标记，发出前先标记 sent，后续 drain 只选未发送请求。仍只等待物理写完成，不等待 MPV ACK 或解码；过期条目直接从同一 Map 移除，无双队列同步。没有吞错或重新执行命令。六项受控 Socket/ACK 合约及 MPV client 合约 PASS / 0，包含 ACK 未返回时反复 drain 仍只发出一次。具体导致此前重复的底层调用栈尚未捕获，不能声称已确认上游缺陷；真实压力复核待补录。

单表发送后的 `mpv-seek-paired-DhPLLE/report.json`：PASS / 0，200 组连续跳播，实际发送记录无重复 request_id、无管道错误、无超时，sourceLoads=1、d3d11va 保持。后续回归增加对重复物理 request_id 的明确断言，发现重复时记录并失败，不丢弃实际命令来掩盖问题。

## 多片源方法

新增 `electron/test/render-library-seek.mjs`：只读 SQLite 备份到应用 build 测试目录，保留指定媒体 ID，清除测试副本的目录写权限及用户偏好。直接只读播放原始路径，不复制大视频，不对源目录进行文件操作。每个片源前后核对完整 SHA256、大小、修改时间。

通过真实 Electron 应用控件测试快速/精确两种策略，暂停和播放中各六次远近跳转，单片共 24 次。核对新的 seekId 对应实际 GPU 完成收据、sourceLoads=1、目标误差、硬解、纠偏、缓存等待、解码/输出丢帧。快速模式按真实关键帧落点报告误差，不虚报精确命中；末尾无后续关键帧时允许已记录的精确纠偏。

选取本地索引 ID 1240（已报告的 4K60 VP9/MKV）、2629（真实 VP9/PQ10 HDR MKV）、1119（约 3.5 小时 H.264 MP4）、2358（4K AV1 MP4）、774（约 2.3 小时 H.264 TS）、721（H.264 MOV）、1186（短 HEVC MP4）、1385（8K AV1 MP4）。结果不包含无关私人标题。

这属于真实应用 GPU 完成及状态确认测量，不等于实体屏幕扫描、HDR 色准或 OS 输入延迟；OS/磁盘/驱动缓存不受控。不同文件和不同策略的差异不直接称为代码优化收益。运行结果完成后补录。

首轮 ss3wma FAIL / 1：脚本误用“播放设置”按钮名，并且未等待 mediaId 切换而采到上一个会话状态。已改用应用现有“跳播与播放设置”入口，打开前清空测试观察值并同时等待当前 mediaId 与 ready。首轮不作为多片源通过结论，也没有据此修改产品或降低断言。

## 已完成的真实片源基线

`render-library-seek-Eh8u9L/report.json`：PASS / 0，8 片共 192 次全部完成，原文件完整身份不变，均 d3d11va，sourceLoads=1；无缓存等待。使用原有 KhYHON 宿主。下表为命令发送到实际 GPU 完成的毫秒数，不是 OS 鼠标输入到实体扫描。

|片源 ID / 格式|快速中位数 / 最慢|精确中位数 / 最慢|
|---|---:|---:|
|1240 VP9 4K60 MKV|61 / 326|495 / 778|
|2629 VP9 PQ10 4K MKV|45 / 59|340 / 602|
|1119 长 H.264 MP4|30 / 60|80 / 200|
|2358 AV1 4K MP4|46 / 62|301 / 492|
|774 长 H.264 TS|74 / 110|165 / 216|
|721 H.264 MOV|68 / 107|43 / 61|
|1186 短 HEVC MP4|68 / 98|31 / 68|
|1385 AV1 8K MP4|69 / 247|440 / 1063|

最慢 4K60 精确样本 restartMs=748.58，GPU 完成 778.45；8K 精确样本 restartMs=1033.95，GPU 完成 1063.11。主要成本在恢复解码前，而不是把加载提示隐藏即可解决。快速策略仍真实报告最高数秒关键帧误差；精确策略不降精度。

## 状态查询优化与测试问题

基线原生 trace 多次出现 property:current-ao 约 20 ms 的同步等待。MpvCore 将状态快照中非控制边界属性也注册为 MPV 属性观察，RenderHost 已有的 frameProperties 从真实属性事件复制有界值，避免每次快照同步取约二十项属性。暂停、time-pos 以及关键帧实际落点仍按原逻辑即时读回；GPU 收据、色彩、硬解、seek 命令和 EOF 纠偏不改。构建后的本地新候选为 Aqm5oW，DLL pin 不变且运行库校验照常，应用源码构建标识仍为 983ff28c29433ce8（C# 宿主另以 runtime.json 源码/宿主哈希区分）。这不是安装包或发布。

`render-library-seek-XfbfvL/report.json`：FAIL / 1，两个用例在诊断已完成后，最新普通重绘 seekId=0，测试要求“最新快照必须仍是定位完成帧”而漏掉此前的真实带标签 GPU 收据。已改为在 onRenderState 接收时保存满足 pending=null、presented.seekId=diagnostic.seekId 的真实完成事件，再轮询该事件；仍要求新 seekId、真实 GPU 收据、落点和源加载断言，不改产品输出或伪造事件。首次 FAIL 材料保留，修正后重测结果待补录。当前时间按客户端记为 2026-11-10；原始工具日志保留其实际时间戳。

`render-library-seek-C3u1cp/report.json`：修正观察器后 PASS / 0，8 片、192 次全部完成，源文件不变、d3d11va、sourceLoads=1。属性事件候选 Aqm5oW 相对原基线快速模式中位数有升有降（4K60 61→47 ms，TS 74→83 ms，其他差异较小），不能把波动解释为全面提速。trace 已没有 current-ao 的同步等待，但 TS 的一次快速定位出现 property:pause=396.78 ms，GPU 完成 442.51 ms，定位期间即时快照读取仍会造成真实阻塞。

针对这一实际阻塞，RenderHost.Snapshot 仅在 seekRequested=true 时，对已观察到的 pause/time-pos 也使用 MPV 事件副本，避免在待渲染期间等 VO；其他时候仍同步读取控制时钟。Frame 在 playback-restart 后仍读取真实 time-pos，实际 GPU 完成收据、匹配落点、结束纠偏以及错误保护均未改变。没有用目标时间替代实际帧时间。新候选为 aDEW1T，源码/宿主哈希记录在其 runtime.json，未修改 DLL。

最终多片源复测 `render-library-seek-AF2Joa/report.json`：PASS / 0，8 片共 192 次，sourceUnchanged=true、d3d11va、sourceLoads=1。每次完成都保存了真实的新 seekId/GPU 收据。下表仍为命令发送至实际 GPU 完成毫秒数：

|片源 ID|快速中位数 / 最慢|精确最慢|
|---|---:|---:|
|1240|48 / 294|751|
|2629|45 / 68|615|
|1119|35 / 68|168|
|2358|46 / 58|491|
|774|79 / 109|221|
|721|72 / 97|64|
|1186|64 / 96|62|
|1385|67 / 101|1036|

最终 trace 没有 pause/current-ao 的长同步读取；8K 一次 paused-for-cache 查询仍记录 20.34 ms，未将这些状态等待全部宣称消失。快速中位数与最初基线有升有降，磁盘/驱动缓存也未控制，因此不宣称表中所有差异都是代码收益。已消除定位期间快照的具体同步 pause/time-pos 查询路径；精确定位的长 GOP 解码成本保持真实，未变更其策略或精度。

## 当前源码综合回归

- `playback-regression-Hlirp5/report.json`：PASS / 0，16 步全部完成。包括 6 项发送合约、引擎/会话合约、启动/控件竞态、受控 GPU 初始化失败清理、独立 MPV 三格式截图及退出、三引擎切换，以及真实 Electron 双 MPV 路径的 MP4/H.264、TS、4K HEVC/MKV 精确/快速/智能、暂停/播放中、连续/远跳矩阵。对应最终原生候选 aDEW1T。
- `render-app-flow-W25iyY/report.json`：PASS / 0，真实 Electron 4K SDR10 像素码定位及 PNG16 截图，保留 3840×2160 与高位深；无 lossy/降质回退。
- `mpv-seek-paired-BcwFmh/report.json`：最终独立 MPV 压力 PASS / 0，200 组连续跳播，重复物理 request_id 断言通过，wireDuplicates=[]、无 pipe-error/超时，sourceLoads=1、d3d11va。与前一轮 DhPLLE 合计两轮各 200 组通过；不冒称已确定此前底层重复回调的上游原因，也不保证所有环境永不出现故障。
- 编译、脚本语法、git diff --check：PASS / 0；行尾提示只是既有 CRLF 工作副本的归一化警告。

为避免再次占满 D 盘，测试结束、真实进程退出后，仅移除已知应用生成的重复 HEVC4K.mkv 测试副本，保留原始报告/日志、唯一重用生成样本与全部用户原视频。未删除用户媒体、索引、观看记录或其他未知目录。

回滚本轮时，只撤销 requests 的单表发送改动，以及 observedFrameProperties 扩充与 Snapshot 的 seekRequested 分支；旧管道诊断、字幕、画质、界面、所有引擎及其他已有未提交修改必须保留。回滚后需要重新编译和生成匹配源码哈希的本地宿主测试候选，不能直接使用与源码不同的运行库绕过校验。

本轮已完成两项建议的本机源码修复和验收。保留限制：精确模式真实长 GOP 解码仍可约一秒，磁盘冷缓存未受控；缺失 HEVC HDR/AV1 HDR/HLG 真实片源及外机/物理 HDR 色准不在这次结论范围。没有通过隐藏等待、关闭硬解、改变分辨率/位深/色彩、转码或伪造呈现收据达到 PASS。未升级版本、提交、推送或打包。
