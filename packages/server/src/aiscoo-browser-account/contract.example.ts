import type { IChannelClient } from "@zcode/rpc";
import { createBrowserAccountBridge } from "./index.js";

/** Parent registers only authority.oauth and disposes the attachment when its socket closes. */
export async function browserAccountBridgeExample(client: IChannelClient) {
  const bridge = createBrowserAccountBridge("https://account.example.test", {
    onOwnerChanged: async () => {
      /* Invalidate the existing Host account catalog. */
    },
  });
  const attachment = bridge.attach(client);
  await attachment.ready;
  return {
    oauth: bridge.authority.oauth,
    dispose: () => {
      attachment.dispose();
      bridge.dispose();
    },
  };
}
