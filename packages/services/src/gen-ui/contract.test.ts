import { describe, expect, it } from "vitest";
import { IGenUiService } from "./index.js";
import { genUiServiceModule } from "./module.js";
import { createGenUiService } from "./node.js";

describe("gen-ui service contract", () => {
  it("keeps the RPC channel name stable", () => {
    expect(IGenUiService.channelName).toBe("gen-ui");
  });

  it("declares the public entrypoints required by the architecture policy", () => {
    expect(genUiServiceModule.id).toBe("gen-ui-service");
    expect(genUiServiceModule.provides).toContain("gen-ui-service");
    expect(genUiServiceModule.publicEntrypoints).toEqual(["index.ts", "contract.ts", "node.ts"]);
  });

  it("exposes the node factory from the public entrypoint", () => {
    expect(typeof createGenUiService).toBe("function");
  });
});
