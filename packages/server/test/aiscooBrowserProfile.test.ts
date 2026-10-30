import { describe, expect, it } from "vitest";
import { resolveBrowserAccountProfile } from "../src/aiscoo-browser-account/profile.js";

describe("browser account entry profile", () => {
  const env = {
    AISCOO_BROWSER_NEW_API: "1",
    NEW_API_BASE_URL: "https://account.example",
    AISCOO_BROWSER_ORIGIN: "http://127.0.0.1:5173",
    PORT: "3030",
  };
  it("leaves the existing server entry unchanged when disabled", () => {
    expect(resolveBrowserAccountProfile({})).toBeNull();
  });
  it("accepts only its loopback Host and exact browser Origin", () => {
    const profile = resolveBrowserAccountProfile(env)!;
    const request = (host: string, headers: Record<string, string> = {}) =>
      new Request(`http://${host}/ws`, { headers: { host, ...headers } });
    expect(
      profile.acceptRequest(request("127.0.0.1:3030", { origin: env.AISCOO_BROWSER_ORIGIN })),
    ).toBe(true);
    expect(
      profile.acceptRequest(request("127.0.0.1:5173", { origin: env.AISCOO_BROWSER_ORIGIN })),
    ).toBe(true);
    expect(
      profile.acceptRequest(request("evil.localhost:3030", { origin: env.AISCOO_BROWSER_ORIGIN })),
    ).toBe(false);
    expect(
      profile.acceptRequest(request("127.0.0.1:3030", { origin: "https://evil.example" })),
    ).toBe(false);
    expect(
      profile.acceptRequest(request("127.0.0.1:3030", { "sec-fetch-site": "cross-site" })),
    ).toBe(false);
  });
  it.each([
    "http://localhost:5173",
    "https://127.0.0.1:5173",
    "http://127.0.0.1",
    "http://127.0.0.1:80",
  ])("rejects a noncanonical browser Origin: %s", (origin) => {
    expect(() => resolveBrowserAccountProfile({ ...env, AISCOO_BROWSER_ORIGIN: origin })).toThrow();
  });
  it("fails before starting the Host when account configuration is missing", () => {
    expect(() => resolveBrowserAccountProfile({ ...env, NEW_API_BASE_URL: "" })).toThrow();
  });
});
