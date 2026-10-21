/**
 * cli-sea-keyring 对外契约：SEA 单文件包内原生钥匙串模块的加载入口。
 * 非 SEA 进程直接导入 node_modules 中的 @napi-rs/keyring；SEA 进程从内嵌资源校验哈希后解包到
 * 按内容哈希命名的缓存目录再加载。哈希不符时拒绝并清理临时目录，不回退到明文或其他存储。
 */
export type { LoadCliKeyringOptions, SeaKeyringModule } from "./runtime.js";
export { loadCliKeyringModule } from "./runtime.js";
