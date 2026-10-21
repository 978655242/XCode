import type { ZenAccountContract } from "./contract.js";
export async function restoreZen(account: ZenAccountContract) {
  return account.restore();
}
