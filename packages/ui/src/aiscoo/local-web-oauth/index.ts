import type { OAuthLifecycleExtension } from "./contract.js";
import { createLocalWebLogin } from "./login.js";
import { createLocalWebSession } from "./session.js";
import { createLocalWebLogout } from "./logout.js";

export type * from "./contract.js";

/** 由本机 Web 装配，桌面和其他 Web 环境不注入。 */
export const aiscooLocalWebOAuthLifecycle: OAuthLifecycleExtension = {
  createLogin: createLocalWebLogin,
  createSession: createLocalWebSession,
  createLogout: createLocalWebLogout,
};
