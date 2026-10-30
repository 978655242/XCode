import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeZCodeRuntimeEnv, buildZCodeToolEnvPassthroughEnv } from "@zcode/shared";
import { createCredentialService } from "../src/credential/credentialService.js";

test("Host private namespaces are denied for every public credential operation", async () => {
  const service = createCredentialService();
  for (const key of ["new-api:origin:active", "official-cloud:origin:user"]) {
    const denied = (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "XCODE_CREDENTIAL_SCOPE_DENIED";
    await assert.rejects(service.load(key), denied);
    await assert.rejects(service.save(key, "attacker-replacement"), denied);
    await assert.rejects(service.delete(key), denied);
    await assert.rejects(
      service.recoverUnreadable(key, () => {}),
      denied,
    );
  }
});

test("Main-only keystore key cannot survive runtime or tool passthrough env sanitization", () => {
  const env = {
    XCODE_PRIVATE_CREDENTIAL_SECRET: "private-os-key",
    AISCOO_ADMIN_BASE_URL: "http://127.0.0.1:3001",
    ZCODE_TOOL_ENV_PASSTHROUGH_JSON: JSON.stringify({
      XCODE_PRIVATE_CREDENTIAL_SECRET: "private-os-key",
      HTTP_PROXY: "http://proxy.example",
    }),
  };
  const runtime = sanitizeZCodeRuntimeEnv(env);
  assert.equal(runtime.XCODE_PRIVATE_CREDENTIAL_SECRET, undefined);
  assert.equal(runtime.AISCOO_ADMIN_BASE_URL, "http://127.0.0.1:3001");
  assert.equal(
    JSON.parse(runtime.ZCODE_TOOL_ENV_PASSTHROUGH_JSON ?? "{}").XCODE_PRIVATE_CREDENTIAL_SECRET,
    undefined,
  );
  const tool = buildZCodeToolEnvPassthroughEnv(env);
  assert.equal(tool.XCODE_PRIVATE_CREDENTIAL_SECRET, undefined);
  assert.equal(
    JSON.parse(tool.ZCODE_TOOL_ENV_PASSTHROUGH_JSON ?? "{}").XCODE_PRIVATE_CREDENTIAL_SECRET,
    undefined,
  );
  assert.equal(
    JSON.parse(tool.ZCODE_TOOL_ENV_PASSTHROUGH_JSON ?? "{}").HTTP_PROXY,
    "http://proxy.example",
  );
});
