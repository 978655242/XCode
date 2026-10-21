import assert from "node:assert/strict";
import test from "node:test";

import { loadCliKeyringModule } from "./contract.js";
import { cliSeaKeyringModule } from "./module.js";

// 契约测试只经由 contract 与 module；SEA 解包、哈希拒绝与缓存复用见 tests/sea-keyring-runtime.test.ts。
test("cli-sea-keyring declares its manifest and uses the normal module outside SEA", async () => {
  assert.equal(cliSeaKeyringModule.id, "cli-sea-keyring");
  let imported = false;
  await loadCliKeyringModule({
    sea: { isSea: () => false, getAsset: () => "", getRawAsset: () => new ArrayBuffer(0) },
    importModule: async () => {
      imported = true;
      return {} as never;
    },
  });
  assert.equal(imported, true);
});
