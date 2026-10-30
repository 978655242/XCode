# Aiscoo 账号默认头像：第三方许可记录

本文件由 Aiscoo 下游维护，独立于上游的 `README.md`、`SPEC.md` 与 `npm-overrides.json`，避免与上游同步产生新增冲突。补充许可材料登记在 `aiscoo-npm-overrides.json`，生成器读取后与上游清单合并。

## 账号默认头像：Multiavatar 1.0.7

`@multiavatar/multiavatar@1.0.7` 的原始许可字段为 `SEE LICENSE IN LICENSE`，对应 **MULTIAVATAR LICENSE v1.0**，并非 MIT。[原始许可](upstream/multiavatar-1.0.7-LICENSE.txt)允许商业软件使用，但禁止重包装或重命名其设计集，也禁止使用设计制作相似、竞争的头像产品或服务；Multiavatar 应为其他产品的附加功能。拟用于账号默认头像，具体产品发行场景仍需法律复核；升级版本或扩大用途须重新核验。

[npm 1.0.7 归档](https://registry.npmjs.org/@multiavatar/multiavatar/-/multiavatar-1.0.7.tgz)的 SHA-256 为 `4ab4a4469aad79bce0096d65c8834a22377e372d1ca54b60df639c410c180f64`。原始许可 SHA-256 为 `39f19f0d872c650261c399ced4bb621f8d3a79352a1cee8af44a00433fd47cf2`，原始[元数据](upstream/multiavatar-1.0.7-package.json) SHA-256 为 `bcdca308e34f5526299715ce1217f3f129ea4bf760893f9d7150d247f215a09d`。

包内嵌 CryptoJS 3.1.2 的 SHA-256 实现及版权头，但未附完整条款；其[原始 BSD-3-Clause 条款](upstream/cryptojs-3.1.2-LICENSE.txt) SHA-256 为 `6718c0ad644b5e025b9fc6580636b12244eafc727a237a3ddf2da656441a1863`，源于[官方归档](https://storage.googleapis.com/google-code-archive/v2/code.google.com/crypto-js/wiki/License.wiki)。[版本元数据](upstream/cryptojs-3.1.2-package.json)与[固定上游 rollup](https://raw.githubusercontent.com/brix/crypto-js/7e09961c6174bb23912d95e42fec340f38babdb0/build/rollups/sha256.js)的比对证据见 `aiscoo-npm-overrides.json`。BSD 条款要求分发保留版权、条件与免责声明；不得套用其他版本的 MIT 许可。

许可门禁只接受这个精确包名、版本与原始许可值；声明生成器从实装包收集 Multiavatar 原文，并通过精确版本 override 附加 CryptoJS 条款。既有材料缺口仍须独立处理，不以此记录宣称发行许可通过。

release 的已有 `@lobehub/icons-static-svg@1.95.1` npm 包未附完整 LICENSE，导致声明生成阻断。其 README 指向上游许可，版本对应的 npm `gitHead` 为 `49a2130df7bfa5eb1b088261bff20a37e2967789`；该提交的包元数据确认名称、版本与 MIT 标识。已核对[固定提交原文](https://raw.githubusercontent.com/lobehub/lobe-icons/49a2130df7bfa5eb1b088261bff20a37e2967789/LICENSE)与[本地快照](upstream/lobehub-icons-static-svg-1.95.1-LICENSE.txt) SHA-256 均为 `add9d7531d1b21646317a8958e38fc727506fa39d24bdecb44154d943c82753a`，只为该精确版本追加材料，不改变其他许可分类或既有缺口。

2026-10-30 在 release `152a337e` 的隔离工作区以完整安装图重新生成声明，涵盖 1230 个精确包版本、12 个复制组件及 18 个原生归档。生成后的基础许可标识和声明新鲜度检查通过；严格检查因 `inventory.json` 中 19 项 `reviewRequired` 失败，这 19 项与生成前 release 清单逐项相同，仍需发行前补齐或核验。它们包括部分 npm 包的原始版权/许可材料、React Best Practices 许可原文、Skia 与 QuickJS-NG 链接来源及指定 Rust 标准库原文；完整清单以 inventory 为准。上文的历史数量不代表本次 release 清单的当前数量。

## 精确许可复核规则（对应 SPEC）

- 仅复核 `@multiavatar/multiavatar@1.0.7` 且原始 `package.json.license` 严格等于 `SEE LICENSE IN LICENSE` 的发布包；专用许可为 `MULTIAVATAR LICENSE v1.0`，不得标为 MIT，也不将其他 `SEE LICENSE IN ...` 加入通用 allowlist。包名、版本或原始许可值变化时须重新核验。
- 拟用于商业应用账号默认头像这一附加功能，不得将现有头像设计集重打包、改名为另一产品，或制作相似或竞争的头像产品/服务。是否满足具体发行场景仍需人工法律复核。
- 复核谓词由 `scripts/aiscoo/multiavatar-license.mjs` 维护，以原始包元数据调用。npm 包的 Multiavatar 许可及内嵌 CryptoJS v3.1.2 的 BSD-3-Clause 原文保存在 `third-party/upstream/`；生成器读取实装包许可并通过精确版本 override 附上 CryptoJS 原文。来源与哈希见本文件上半部分。
- 定向测试覆盖精确三元组通过及其他包、版本、许可的拒绝。此登记不关闭既有 `reviewRequired` 缺口，也不替代发行审计。
