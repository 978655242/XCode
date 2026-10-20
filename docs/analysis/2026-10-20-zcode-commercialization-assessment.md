# ZCode 二次开发与商业化评估

核查日期：2026-10-20 至 2026-10-21。上游：https://github.com/zai-org/ZCode 。
固定研究基线：`3c5b227649371507ddc4eb46ac5133afe6db1cab`，根 package.json 版本 `3.16.2`。

本报告研究公开上游；本地 XWork 下游的定制功能不作为上游能力证据。未执行上游构建、安装包审计、真实模型调用或渗透测试。法律结论为许可证文本解读，不是针对具体发行物出具的法律意见。

## 结论

第一方源码允许二次开发、商业使用、收费分发和闭源衍生开发；Apache-2.0 不要求公开自有修改、不要求向上游贡献、不要求支付代码使用版税。但第三方组件、商标、模型 API 与官方云服务分别受自己的权利和合同约束。

技术上适合作为桌面 Agent 工作台、企业专用客户端及垂直业务 Agent 产品的基础。公开仓库含 Agent CLI 与运行时，不只是 UI；支持自定义模型服务和扩展。不能据此推定包含官方产品完整能力：Computer Use 是占位实现，官方云服务与权益也不能由客户端源码获得。

推荐优先选择独立品牌、客户自带模型凭据或企业模型网关的桌面/单租户方案。共享多租户 SaaS 需要另建执行隔离和运营控制面，不能直接把现有 Web 服务对公网开放后视为已完成 SaaS 产品化。

## 1. 授权与合规

### 1.1 Apache-2.0 的范围

依据 [LICENSE](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/LICENSE) 第 2、3、4、6、7、8 节：

| 事项                         | 结论与条件                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| 修改、复制、商用、分发、销售 | 第一方代码允许                                                                       |
| 衍生产品闭源                 | 允许；原代码及第三方权利不能被自有 EULA 抹除                                         |
| SaaS 提供服务                | 第一方许可证无网络使用触发公开源码条款                                               |
| 向上游开源修改               | Apache-2.0 不强制                                                                    |
| 再分发许可证                 | 向接收者提供 Apache-2.0 副本                                                         |
| 修改标记                     | 被修改文件应带显著的变更声明                                                         |
| 版权与归属                   | 按第 4 节保留适用的原有版权、专利、商标与归属声明，并处理 NOTICE                     |
| 品牌与 Logo                  | 第 6 节不一般授予商标权；描述来源的合理使用另论                                      |
| 专利                         | 仅授予贡献者有权授予且由其贡献必然涉及的相关专利；满足条款所述专利诉讼条件可终止授权 |
| 保证与赔偿                   | 上游按现状提供，不承担下游商业 SLA                                                   |

收费本身不要求另购 Apache 商业授权。具体第三方组件或另购服务仍可能需要单独合同。

[NOTICE.md 第四节](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/NOTICE.md) 明确将第一方 Apache-2.0 与第三方软件、复制代码、原生二进制、字体、图标及网页素材的独立条款分开。不能把全仓库所有文件都重新声明成自有专有软件。

### 1.2 第三方材料存在已登记缺口

实际读取固定基线的 [third-party/inventory.json](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/third-party/inventory.json)，`reviewRequired` 数组为 **19 项**：

- React Best Practices skill。
- 15 个 npm 精确版本条目：unsafe-pointer、react-remove-scroll-bar、quickjs-wasi、@hono/node-ws、strict-event-emitter、lazy-val、semaphore、boolbase、@open-draft/deferred-promise、is-node-process、ansi-to-react、keyv、@arms/rum-browser、@arms/rum-core、@arms/rum-electron。
- Skia、QuickJS-NG、指定 revision 的 Rust 标准库。

主要原因是对应版本原始版权/许可材料不完整，或最终二进制链接来源仍需审计。**这些登记本身不是已确认侵权的证明，也不是所有条目都进入所有发行形态的证明。** 应按实际安装包和依赖闭包判定。

[third-party/README.md](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/third-party/README.md) 的“25 项”是文档数字，与开源树实际 inventory 的 19 项不同。该文档还说明：基础许可/新鲜度检查不等于完成全部发行义务；严格检查仍有缺口，尚未接入所述 SEA CI 和 SMB 上传入口。

上游提供的检查入口：

```sh
pnpm install --frozen-lockfile
node scripts/licenses.mjs notices
node scripts/licenses.mjs check
node scripts/licenses.mjs check --strict
```

本次仅核查命令与材料，未在本地下游运行，以免把下游依赖树结果冒充上游结果。商业发行应在冻结的发行 checkout 中执行，配合安装包实际内容核验。许可证门禁成功不替代对二进制来源、链接方式及特殊许可义务的审查。

文档提到的 sharp/libvips、LGPL 与 GCC runtime exception 必须按实际构建判断；不得把内部分支的真实 Computer Use 依赖自动视为开源占位构建也包含的依赖，也不能看到 GPL 字样就推断整个应用须 GPL。

### 1.3 文档技能存在许可声明矛盾

后台专项核查确认，docx、xlsx、pdf、pptx 四个技能的 SKILL.md 均标注 `license: Proprietary. LICENSE.txt has complete terms`，但同目录 LICENSE.txt 为 Apache-2.0。例如 [docx SKILL.md](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/documents-plugin/skills/docx/SKILL.md#L7) 与其 [LICENSE.txt](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/documents-plugin/skills/docx/LICENSE.txt)。其余对应目录为 spreadsheets-plugin/skills/xlsx、pdf-plugin/skills/pdf、presentations-plugin/skills/pptx。

[官方文档插件说明](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/docs/document-skills-plugin.md#L12-L17) 记载这些插件从 2026-10-08 起由非商业许可改为 Apache-2.0。这支持“重许可后遗漏旧标签”的解释，但不等于已经取得权利人对矛盾声明的澄清。不能仅凭 Proprietary 标签认定整个仓库不可商用，也不能在发行审核中忽略该矛盾；若产品包含这些技能，建议留存完整授权证据并取得澄清，或先排除相关组件。

此外，清单存在独立义务：例如 elkjs 的 `EPL-2.0 OR GPL-3.0-or-later` 应按实际选择的许可证审查分发与对应源码义务。JSZip 的 MIT/GPL、node-forge 的 BSD/GPL 和 DOMPurify 的 MPL/Apache 为可选许可表达式，不能只取其中 GPL/MPL 字样判定整个产品必须开源。证据见固定基线的 inventory 与 THIRD-PARTY-NOTICES。

## 2. 实际可复用能力

依据 [README](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/README.md)、[CLI 指南](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/README.md)：

- Electron 桌面、浏览器 UI、HTTP/WebSocket 服务、终端 TUI 与 Agent CLI。
- Agent 核心运行时、工具、权限、会话、子代理及工作流相关源码。
- 共享 UI、业务服务、协议、RPC、Provider 配置与 Node 实现。
- MCP、Skills、Hooks、Plugins 扩展入口；桌面/命令行的发行构建脚本。
- SSH/WSL 等远程运行相关链路与资源准备入口。

这降低了从零开发工作台、工具循环和多端适配的投入，但实际稳定性、模型任务成功率和打包可复现性仍需运行验证。

### 模型能否脱离官方账号

[CLI 配置](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/03-config.md) 提供个人模型配置，支持 `openai-chat-completions`、`openai-responses`、`anthropic-messages`，模型配置与账号登录凭据分开管理。

因此，源码存在使用自有模型端点的正式入口，不是只能消费官方模型套餐。协议兼容不保证任意服务支持可靠的工具调用、多轮历史、流式输出和推理参数；产品选择应以目标模型实际任务验证为准。本结论不涉及具体模型服务的价格与最新合同。

### 开源功能边界

- [NOTICE](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/NOTICE.md) 与 CLI 指南明确 Computer Use 为不可用占位；Browser Use 属于独立能力，需要可用浏览器及对应插件。
- [UI_PLUGIN.md](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/UI_PLUGIN.md) 明确交互页面目前用于桌面本地工作区；Web、手机和远程工作区保留普通 MCP 工具记录，不能宣传同等交互面板支持。
- README 的本地 Web/后端服务不是官方所有账号、订单、支付、额度与内容服务的开源证明。

## 3. 官方服务依赖与独立发行

[.env.example](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/.env.example)、[NOTICE 网络行为](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/NOTICE.md) 展示了产品后端、OAuth、模型业务服务、CDN 和远程资源等外部依赖。

独立产品需要逐项决定自建、替换或关闭：登录与账号、套餐/订单、分享、反馈、营销、插件市场来源、远端资源、手机 relay、下载与更新。客户端有相关调用接口，不等于下游拥有运营该后端或使用官方凭据/服务的授权。

尤其应核验 **官方 Coding Plan 特定端点的网关转发**：NOTICE 明确按 URL 规则命中后会改发产品网关，并保留正文和除 Host 外的头，包括认证信息。用户自行创建 provider 不保证绕过此规则。上线企业网关前，应通过合成凭据与受控网络记录验证实际请求目标，避免把“填了自定义配置”当作流量路径保证。

### 遥测与更新的准确边界

[构建期可选能力](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/docs/desktop/build-time-optional-capabilities.md) 规定：开源构建若未配置端点/开关，ARMS RUM、事件上报、自动更新关闭。内部私有默认配置不在开源导出中。

Agent OTLP 是另一条配置链；[telemetry/bootstrap.ts](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/telemetry/src/bootstrap.ts) 以有效 OTLP endpoint 和禁用标志判断启用。关闭一项桌面开关不证明其他网络行为均关闭。

NOTICE 说明模型输入输出日志在共享 Agent 的开发/生产中默认本地写入，测试除外；凭据也并非统一存入系统钥匙串。私有部署应核验日志、密钥、远端同步、数据保留与导出，不应仅以“模型是私有的”证明整条链路离线。

## 4. 架构适配成本

以下为结合源码结构的工程判断，不是已实测的性能结论。

| 商业形态             | 适配程度         | 主要新增工作                                            |
| -------------------- | ---------------- | ------------------------------------------------------- |
| 企业内部工具         | 较高             | 模型网关、扩展、网络/日志与策略核验                     |
| 收费桌面客户端       | 较高             | 独立品牌、签名/公证、更新分发、激活与支持               |
| 企业单租户私有部署   | 中高             | 企业认证、权限、密钥、审计、升级和隔离                  |
| 垂直业务 Agent       | 中高             | 业务 MCP/插件、领域验收、审批与数据闭环                 |
| 共享多租户云 Agent   | 需要较大改造     | 执行沙箱、租户路由/隔离、资源调度、计费、配额、滥用治理 |
| 通用原生桌面控制产品 | 当前开源能力不足 | 自建或合法采购实际 Computer Use 实现                    |

[packages/server/src/http.ts](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/server/src/http.ts) 展示可选 server authToken、Bearer/query/cookie 验证与 API/WS 保护；[entry-http.ts](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/server/src/entry-http.ts) 从环境注入令牌。这是部署入口认证能力，不足以证明已具备多租户业务权限体系。

NOTICE 明确共享执行适配器默认不提供 OS 沙箱，CLI `--prompt` 未指定模式时使用 yolo。[权限指南](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/05-permissions.md) 也说明 plan/build 等应用权限不是系统隔离。工作区 identity 和进程运行账号的安全边界不同。

建议多租户部署把每个执行环境的文件系统、进程、凭据、网络出口与资源限额隔离，再在控制面建立用户/租户身份与执行实例的明确映射。容器是否足够取决于威胁模型，不宣称容器天然解决全部隔离问题。

## 5. 品牌与维护

换 Logo 之外，应核对产品名、应用 ID、可执行文件名、协议回调、数据目录、浏览器 profile、更新 feed、签名身份、默认市场和支持入口。参考上游 [desktop-product-identity.mjs](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/scripts/desktop-product-identity.mjs) 与 [electron-builder.config.js](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/electron-builder.config.js)。独立产品身份有助于避免覆盖原应用或共享敏感数据；开源归属声明仍应保留。

优先通过现有 Provider、MCP、Skills、插件和依赖注入扩展；把自有业务保持在独立模块。协议、会话/队列状态和远程恢复链路属于高维护成本区域，需控制改动面。

本地仓库已明确采用 XWork 下游策略，详见 [BRANCHING.md](../xcode/BRANCHING.md)。这证明本地在工程上组织了 fork，不替代第三方授权及实际发行物审核。

## 6. 商业策略与验收建议

建议先验证一条狭窄闭环：独立品牌桌面端或单租户部署 + 一个已验证模型网关 + 一个高价值行业工作流。可收费的价值来自业务集成、权限审计、稳定交付、维护和服务；仅改名换皮容易与免费上游直接竞争。

建议按以下顺序推进：

1. 冻结发行 commit、依赖锁与目标平台，完成实际可构建验证。
2. 验证自有模型与 Agent 的工具调用、取消/恢复、长任务、错误和权限场景。
3. 形成外部请求清单；自建、替换或关闭不属于自有产品的云服务链路。
4. 对最终产物生成第三方清单，处理适用的 19 项待核验事项及具体许可义务；缺证据时补齐、替换或移除。
5. 完成产品身份、签名、公证、更新和数据路径隔离。
6. 根据产品形态增加企业认证、审计或多租户执行隔离，并实际验证。
7. 用客户任务衡量成功率、人工接管率、每成功任务成本、交付时间与续费意愿。

成本模型应包含：主模型 + 辅助模型/压缩/标题/记忆 + 子代理/重试 + 执行算力 + 存储/网络 + 支持与维护。仅以单次聊天 token 价格估算 Agent 成本容易低估；本报告未给出未经实测的工期、预算或性能数字。

最终判断：**允许二开与商业化；适合基于现有工作台做有明确场景的独立产品；实际商业发行须完成第三方材料、服务边界和运行隔离的针对性核验。**

## 本次验证记录

本次只新增研究文档，保留本地已有业务改动。当前本地 XWork 工作区执行 `pnpm typecheck` 成功；`pnpm lint` 为 0 errors、315 warnings；本文 `oxfmt --check` 通过。以上属于本地工作区检查，不能当作固定上游基线的构建、测试或许可门禁结果。
