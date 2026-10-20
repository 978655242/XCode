# task-facts

会话事实摄入和命令交接的唯一应用入口。无 SQLite、Agent 进程、计时器、UI 或第二份状态缓存；存储、CLI 来源和事件发布通过端口注入。

- CLI 拥有 title/source、created/updated、lastOutcome 与 deleted；Host 只投影这些事实。
- `ingest` 接收已通过协议 schema 校验的 sessions-index 摘要，不使用 Host 时钟。
- `mutate` 先执行 CLI 原生命令，再 reconcile 确认；失败直接抛出，不乐观写 SQLite。
- `reconcile` 只查询快照缺席或有降级交接意图的行，每批最多 256。缺席/不存在标记 orphan 并保留行，明确 deleted 才隐藏。
- 每次 await 后核对订阅代际/水位；迟到结果不能覆盖新帧。组织态由 project 服务拥有，此模块不修改 pin/archive/read/project。
- XCODE：`refresh` 可携带 Host 内部 `assertCurrent` 准入回调；回源、排队存储与发布前复查，账号撤销后不能把旧导入写进新 owner 的索引。回调不进入 CLI 协议，不产生第二份 owner 状态。
- XCODE：`OffPeakResidentExecutions` 负责 Host 与 CLI 之间的驻留执行/票据交接关联；登记表仅关联 task、session、execution、renewal 与待确认票据，不拥有会话事实、后台工作清单或第二份 accepted 输入队列。完成、释放及用户接管仍以匹配身份的 CLI 通知为准。
- 驻留交接复用注册时传入的 owner 校验回调对象；控制、完成、续票及释放前后保留原校验与 admission 顺序。异步端口不导入 SQLite、Agent 或凭据实现，owner 失效时不借新账号重试旧执行。
- 桌面 continuous / 手机 replayable 共用 CLI owner；协议传输、READY、CommandInbox 的 FIFO 与去重保留在原有协议层。
- 标题/删除意图仅是旧版本交接。bit 1=删除，bit 2=标题，bit 4=orphan，bit 8=归属已判断；确认后的位清理由存储事务完成。

冷恢复 child 索引修复通过最小 listSessions/listTaskMetas/removeSubagentIndexRow 端口执行，每批 64 条、existing-only，逐条核对工作区身份和订阅代际；只删被 CLI 明确标为 subagent_child 的索引，不删正文。
