import { describe, expect, it } from "vitest";
import { localWebExample } from "./contract.example.js";
import { aiscooLocalWebModule } from "./module.js";

// HTTP/WS 行为与安全边界由 packages/server/test/aiscooLocalWebHttp.test.ts 真实网络验证。
describe("Aiscoo local Web module contract", () => {
  it("declares its public boundary and an explicit loopback origin", () => {
    expect(aiscooLocalWebModule.publicEntrypoints).toContain("index.ts");
    expect(localWebExample.allowedOrigins).toEqual(["http://127.0.0.1:5173"]);
  });
});
