import { describe, expect, it } from "vitest";
import {
  createZenAuthorizationListener,
  createZenCredentialStore,
  ZenClient,
  createZenAuthorization,
  zenKeychainAccount,
} from "../src/auth/zen/index.js";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Zen loopback callback", () => {
  it("binds random state and an S256 challenge to the actual listener", async () => {
    const authorization = await createZenAuthorization("https://zen.example.com");
    try {
      const url = new URL(authorization.authorizeUrl);
      expect(url.searchParams.get("redirect_uri")).toBe(authorization.listener.redirectUri);
      expect(url.searchParams.get("client_id")).toBe("xwork-cli");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const response = await fetch(
        `${authorization.listener.redirectUri}?provider=new-api&code=${"a".repeat(43)}&state=${url.searchParams.get("state")}`,
      );
      expect(response.status).toBe(200);
      expect((await authorization.listener.wait()).state).toBe(url.searchParams.get("state"));
    } finally {
      await authorization.listener.close();
    }
  });
  it("ignores probes and wrong state, then delivers exactly one bound callback", async () => {
    const state = "s".repeat(43);
    const listener = await createZenAuthorizationListener(state);
    try {
      const result = listener.wait();
      const code = "a".repeat(43);
      expect(
        (await fetch(`${listener.redirectUri}?provider=new-api&state=wrong&code=${code}`)).status,
      ).toBe(400);
      expect((await fetch(new URL("/favicon.ico", listener.redirectUri))).status).toBe(404);
      expect(
        (
          await fetch(`${listener.redirectUri}?provider=new-api&state=${state}&code=${code}`, {
            method: "HEAD",
          })
        ).status,
      ).toBe(405);
      const response = await fetch(
        `${listener.redirectUri}?provider=new-api&state=${state}&code=${code}`,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain(code);
      expect(await result).toEqual({ code, state });
      expect(
        (await fetch(`${listener.redirectUri}?provider=new-api&state=${state}&code=${code}`))
          .status,
      ).toBe(409);
    } finally {
      await listener.close();
    }
    await expect(fetch(listener.redirectUri)).rejects.toThrow();
  });
  it("cancels the wait without leaving the listener open", async () => {
    const listener = await createZenAuthorizationListener("s".repeat(43));
    const controller = new AbortController();
    const pending = listener.wait(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    await listener.close();
    await expect(fetch(listener.redirectUri)).rejects.toThrow();
  });
});

describe("Zen encrypted credential store", () => {
  it("encrypts secrets and atomically rejects stale revisions across store instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zen-store-"));
    let key: string | null = null;
    const keyStore = {
      read: async () => key,
      write: async (next: string) => {
        key = next;
      },
    };
    const origin = "https://zen.example.com";
    const first = createZenCredentialStore<{ secret: string }>({ directory, keyStore });
    const second = createZenCredentialStore<{ secret: string }>({ directory, keyStore });
    try {
      await first.assertAvailable();
      const results = await Promise.all([
        first.compareAndSwap(origin, null, { secret: "private-token-a" }),
        second.compareAndSwap(origin, null, { secret: "private-token-b" }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const saved = await first.read(origin);
      expect(saved?.value.secret).toMatch(/^private-token-[ab]$/);
      for (const name of await readdir(directory))
        expect(await readFile(join(directory, name), "utf8")).not.toContain("private-token");
      expect(await second.compareAndSwap(origin, "stale", null)).toBe(false);
      expect(await second.compareAndSwap(origin, saved!.revision, null)).toBe(true);
      expect(await first.read(origin)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("fails closed on OS credential read failures without creating a replacement key", async () => {
    let writes = 0;
    const store = createZenCredentialStore({
      directory: join(tmpdir(), "unused-zen-store"),
      keyStore: {
        read: async () => {
          throw new Error("locked");
        },
        write: async () => {
          writes++;
        },
      },
    });
    await expect(store.assertAvailable()).rejects.toThrow();
    expect(writes).toBe(0);
  });
});

describe("Zen HTTP boundary", () => {
  // 回归：钥匙串条目曾为固定账户名，不同数据根共享同一 key，删除或换 key 会互相破坏。
  it("scopes the OS keychain entry to the credential directory", () => {
    const first = zenKeychainAccount(join(tmpdir(), "zen-a", ".zcode", "cli", "zen"));
    const second = zenKeychainAccount(join(tmpdir(), "zen-b", ".zcode", "cli", "zen"));
    expect(first).toMatch(/^credential-encryption-key:[a-f0-9]{32}$/);
    expect(first).not.toBe(second);
    expect(zenKeychainAccount(join(tmpdir(), "zen-a", ".zcode", "cli", "zen"))).toBe(first);
  });
  it("uses the CLI client and exact redirect, rejects redirected or invalid responses", async () => {
    let sent: RequestInit | undefined;
    const client = new ZenClient("https://zen.example.com", async (_url, init) => {
      sent = init;
      return Response.json({ success: true, data: {} });
    });
    await expect(
      client.exchange("a".repeat(43), "v".repeat(43), "http://127.0.0.1:49152/oauth/callback"),
    ).rejects.toThrow("XCODE_PROTOCOL_INVALID");
    expect(JSON.parse(String(sent?.body))).toMatchObject({
      client_id: "xwork-cli",
      redirect_uri: "http://127.0.0.1:49152/oauth/callback",
    });
    expect(sent?.redirect).toBe("error");
    expect(sent?.credentials).toBe("omit");
  });
});
