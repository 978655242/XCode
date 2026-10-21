SEA 单文件包分发 Zen 安全存储所需的原生钥匙串绑定。

- 资源由 `scripts/sea-keyring-assets.mjs` 按目标收集：`@napi-rs/keyring` 加载器 + 恰好一个目标平台原生绑定（Linux 为 glibc gnu，Windows 为 MSVC）。
- 运行时逐文件校验 sha256；任一不符即失败并删除临时目录，不留下部分缓存，不降级到其他存储。
- 缓存目录随 CLI 版本、目标与内容哈希变化；同哈希复用。
- 非 SEA 进程不经过本模块的解包路径。adapter 通过 `setZenKeyringModuleLoader` 注入加载器，不感知打包形态。
