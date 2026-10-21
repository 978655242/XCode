import type { ZenAccountContract } from "./contract.js";

/** 调用方示例：恢复后只通过 owner 投影判断身份，不读取凭据。 */
export async function restoreZen(account: ZenAccountContract) {
  const restored = await account.restore();
  return restored ? account.getOwner() : null;
}
