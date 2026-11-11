# 独立 MPV 连续跳播的 IPC 写入修复

2026-11-09。HEAD f3f65dbc321b54541f09be6b1558fb9e4f5eab27，保留已有修改，版本仍为 0.2.19，最终本地构建 46f8bf8921310fb8。本轮不打包、提交或推送。原生宿主仍使用 KhYHON；没有改动解码、D3D11/WebGPU 色彩数学或播放质量。

## 实际复现与证据

文档 92 的 OFAWf9/k50nah 只证明连接中断，当时没有错误码，不能事后断言它必然属于同一原因。本轮在真实 Electron 的独立 MPV 路径，增加 4K 10-bit HEVC 暂停状态的连续快进/快退压力用例：四个远近锚点循环，每组连续三个相对命令；核对实际落点、状态、源加载次数和硬件解码。

- `mpv-seek-paired-jFFFnR/report.json`：FAIL / 1，完成 5 组后管道出现 `ERR_MULTIPLE_CALLBACK`。
- `mpv-seek-paired-1sjqrg/report.json`：FAIL / 1，完成 7 组后再次出现同码；错误栈为 `node:internal/streams/writable` 的 `onwrite` / `WritableState.onwrite` / `WriteWrap.onWriteComplete`，当时 pending=2、writableLength=82。
- 两次管道错误发生时 exited=false。后续 SIGTERM 是应用连接关闭后的清理，不能反过来认定最先发生了 MPV 解码崩溃。
- `mpv-seek-paired-UpQJMD/report.json`：FAIL / 1，但 80 组压力本身完成。失败来自测试未恢复起点而使后续原有 fast 断言使用旧锚点；已修正测试恢复起点，保留原失败材料。

Node 官方对 [ERR_MULTIPLE_CALLBACK](https://nodejs.org/api/errors.html#err_multiple_callback) 的定义是回调被调用多次。这里的具体证据落在当前 Electron 的 Windows 管道写完成路径；没有找到足以认定特定上游版本缺陷的证据，故不宣称某个 Node/MPV 上游 bug 已被修复。

## 修改

`electron/src/mpvClient.ts` 将物理管道写入排成 FIFO：收到当前 OS write 回调并离开回调栈后，再发送下一条。它不等待 MPV ACK、解复用、解码或画面完成，因此不同请求的响应仍可独立到达、按 request_id 匹配。没有吞掉重复回调错误或 Socket 错误，没有自动重试、重载源文件或降精度。

保留原有 64 个请求上限及超时；超时和关闭会丢弃尚未发送的命令。诊断增加实际 writeCount/maxWriteQueueMs，seek 发送时间在真正写入时记录。MPV EXE 的首帧呈现时间仍为 null，不能将 playback-restart 当作 GPU 呈现收据。

`electron/test/mpv-write-queue.test.mjs` 的五个受控 Socket/ACK 合约覆盖写入顺序、独立响应、排队超时、错误/关闭、请求上限与真实发送时刻；它们不是原生播放性能证据。该测试加入 `scripts/test-playback.mjs` 和 Windows workflow。

## 验收结果

- Electron 构建、前端构建、MPV client 合约、写入队列 5 项合约：PASS / 0。
- `mpv-seek-paired-8cWOZX/report.json`：真实 Electron，MP4/H.264、TS、4K HEVC/MKV，PASS / 0；额外 80 组连续跳播全部完成，硬解 d3d11va，sourceLoads=1，pipeErrorCode=null。三次退出均正常 exitCode=0。
- 80 组最后记录 writeCount=782，整个会话最大物理写排队约 6.15 ms（包含初始化观察命令，并非 seek 专属统计）。普通 4K HEVC 样本 exact 确认 p50 56.96 ms / p95 116.46 ms，fast p50 5.61 ms / p95 28.17 ms。这是同机生成样本的状态确认时间，不是外机、真实长 GOP 或物理显示延迟承诺。

`mpv-seek-paired-1XzG5o/report.json`：200 组扩展测试 FAIL / 1，完成 179 组后最终相对目标预期 745.404 秒，实际确认 740.404 秒。管道健康、无缓存等待、sourceLoads=1、硬解保持；不能以管道问题消失掩盖这个目标合并问题。已增加按需开启的 Lua 数值事件跟踪（AVHUB_NATIVE_SEEK_TRACE=1），继续定位。

后续一次测试在创建生成样本时 ENOSPC / 1；仅清理本轮重复生成的 HEVC 副本，保留报告、日志及一份生成样本，未触碰 E 盘原视频。ZEcnLT 为前后端构建标识不同导致启动错误 / 1，未进入播放；补齐完整构建后重测，不计为播放验收通过。

带 Lua 事件跟踪的新一轮 `mpv-seek-paired-1PJU3X/report.json`：PASS / 0，200 组全部完成，硬解 d3d11va、sourceLoads=1、pipeErrorCode=null。最后 writeCount=1622，整个会话最大物理写排队 8.05 ms；普通 4K exact 确认 p50 52.58 ms / p95 125.32 ms，fast p50 6.16 ms / p95 27.39 ms。没有以此覆盖前一轮失败。

回查 1XzG5o 的 MPV 日志，36.233–36.235 秒实际收到四条 script-message-to：-5、-5、-5、+5（测试请求为 -5、-5、+5），因此最终落点确实少了 5 秒。额外输入来源尚未建立证据；不能认定 Lua 合并算法必然错误，也不能将后续通过当作该现象已修复。保留为当前待追踪项。

最终统一真实桌面回归 `playback-regression-qZuL4J/report.json`：PASS / 0，16 步全部通过，无未执行项。覆盖前后端构建、五项写入队列合约、MPV 控制/引擎合约、缓存保护、运行库校验、真实控件输入、启动/启动中操作、受控 GPU 失败清理、独立窗口三格式截图/退出、三播放路径切换，以及两条 MPV 路径的 MP4/H.264、TS、4K HEVC/MKV 暂停/播放中精确/关键帧/智能/远跳/连续跳播矩阵。生成片源结果不能替代所有真实长 GOP 文件的体验结论。

最后的跳播矩阵为 `mpv-seek-paired-l8enWV/report.json`；测试已加入最多 256 条非敏感跳播写入记录，记录真实 request_id、命令及发送时刻，用于下次额外输入复现时对照接收日志，不把注入 IPC 命令称为 OS 鼠标/键盘延迟测量。

发送记录接入后的独立 MPV 压力复核 `mpv-seek-paired-aN6H4L/report.json`：PASS / 0，200 组完成，报告保存最近 256 条实际跳播写入。本轮没有复现额外 -5，不能给先前失败下已解决结论；保留发送端和接收端证据链供后续定位。

当前没有新的成品包、外机或物理 HDR 色准验收；原有未验证项不变。回滚仅针对本轮写入队列和对应测试改动，保留其他未提交修改，不能整文件还原覆盖既有工作。
