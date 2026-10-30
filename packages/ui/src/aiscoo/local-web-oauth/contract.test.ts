import { describe, expect, it } from "vitest";
import { aiscooLocalWebOAuthLifecycle } from "./index.js";

describe("本机 Web OAuth 生命周期合同", () => {
  it("暴露登录、会话视图和退出工厂", () => {
    expect(Object.keys(aiscooLocalWebOAuthLifecycle).sort()).toEqual([
      "createLogin",
      "createLogout",
      "createSession",
    ]);
  });
});
