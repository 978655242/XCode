# Provider regression

独立开发工具，通过 contract.ts 的 run 接口读取显式 Provider 配置与清单，按 Provider / Model / Case 三级上限运行适用用例并持续保存脱敏快照。详细行为唯一来源为 docs/builtin-provider-maintenance/regression-testing.md。

输入配置由 Schema 校验；会话、附件与工具复用公开 ZCode App；专项调用复用产品处理函数和 Model Adapter。临时会话关闭后清理，取消传递给在途请求。保留产品重试，不读取日常用户配置，不修改产品配置。副作用限于指定供应商调用、独立临时会话与报告目录写入。

XCODE: 此独立入口只读取 `api-key`、`zhipu-coding-plan-api-key` 两类静态凭据；缺失 access 仍沿用原有 API Key 规则。`zhipu-account`、`new-api-account` 的 OAuth / Native 凭据由各自 owner 请求期解析，此处在占位 Key 合成和网络请求前拒绝，不读取系统账号、不为账号类型注入占位凭据，也不回退到原厂或环境变量 Key。静态 Key 缺失仍按原有 missingKeys 生成未测项。

执行器独占状态，结果写入队列串行保存不可变快照。首次计划和每项开始 / 结束均须持久化；写入失败停止请求。outputDir 是报告根目录，省略时使用 Provider 配置旁的 reports，每轮创建独立 runId 子目录。HTML 转换入口只读取结果，不加载凭据或请求网络。
