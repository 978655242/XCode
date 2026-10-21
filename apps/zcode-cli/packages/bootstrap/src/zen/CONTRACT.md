# cli-zen-account

独立 CLI Zen 账号的唯一 owner。bootstrap 通过 adapters 端口执行外部操作，不依赖桌面 Services 实现。

- owner = origin/userId/SID/generation，异步返回必须同时满足当前代次和存储 revision。
- 登录总期限 10 分钟；取消先失效代次，已兑换而未接受的 SID 精确补偿撤销。
- 系统库 unavailable 在授权之前失败；503 不删除凭据，明确会话撤销立即使 owner 不可执行。
- 刷新使用跨进程租约、后继重读与 CAS；换号与退出不能被旧刷新覆盖。
- onDidChange 只通知读投影，不传密钥。AccountProviderService 独占模型授权投影刷新。
