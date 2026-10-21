# cli-zen-auth

独立 CLI Zen 的外部 I/O 边界：回环监听、安全存储、HTTP。bootstrap 仅通过公开端口调用。

- callback 只接受当前 listener 的精确 URI 与 state；无关请求不消耗登录，取消释放端口。
- 系统安全库存储随机 key，独立 CLI 文件以 AES-GCM 保存 bundle，原子写入和跨进程锁保证 CAS。
- 固定 `@napi-rs/keyring@2.1.2`：核对其 AsyncEntry 异步 API；macOS Keychain、Windows Credential Manager、Linux Secret Service。Linux 显式固定 secret-service，禁止 kernel keyring 自动 fallback。
- 原生加载错误和安全库读取错误不得伪装为缺失记录，不降级明文或机器派生 key。
- 本模块不发布账号事实，不读取桌面 active pointer。新目录已登记架构；共享协议通过 shared 公开入口。
