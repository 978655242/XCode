import type { ZenAuthorizationListener } from "./contract.js";

export async function receiveAuthorization(
  listener: ZenAuthorizationListener,
  signal: AbortSignal,
) {
  try {
    return await listener.wait(signal);
  } finally {
    await listener.close();
  }
}
