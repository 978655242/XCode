# local-web-new-api

独立本机 Web 通过一次性工厂接入现有 NewApiAccountService owner，不接管身份状态、提交或 refresh。

- 仅 Host 调用 factory；工厂初始化时取得独立操作系统安全库 key，先将专属加密文件和 cipher 提供给 Host 装配公共凭据及 provisioning，再创建唯一账号 owner。主账号、官方连接及经凭据服务保存的公开或自定义凭据使用同一文件和 key，公共 RPC 禁止访问私有身份命名空间。
- 本机 Web 不迁移、读取或修改桌面及 CLI 凭据；密钥库不可用或已有数据丢失 key 时失败关闭。未注入 factory 的其他 Host 保持原有路径及 cipher。
- 回环 listener 仅接收当前 state，取消、替换、超时和销毁关闭 listener；code 仅在 Host 内兑换。
- 用户可见失败事件只包含 provider、state 与固定错误类别；迟到代次不能发布事件。
- 工厂的 Host 装配扩展统一校验并冻结凭据存储和 Provider 覆盖项；它提供 Web 私有 Provider 配置及内置 active 文件路径，Host 的 Provider Repository、默认选择、provisioning 和 Worker 使用同一组路径，不导入桌面旧配置，也不启用官方内置配置远端刷新。
- 唯一账号仍由工厂在 Host 网络传输就绪后创建，Host 的 `onOwnerChanged` 只注入一次；缺少或损坏扩展配置在任何账号和公共凭据服务创建前失败关闭。未注入时沿用原 Host 默认值及求值时机。
- Provider 文件沿用私有文件原子写入，现有格式可能明文保存自定义 API Key；这与加密凭据库是不同存储。
- 不改变未注入 factory 的 Server、Desktop 或 CLI 行为。
