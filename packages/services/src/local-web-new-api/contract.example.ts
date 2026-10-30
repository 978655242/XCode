import type { LocalWebNewApiAccountFactory } from "./contract.js";

export async function disposeLocalWebAccount(factory: LocalWebNewApiAccountFactory): Promise<void> {
  await factory.dispose();
}
