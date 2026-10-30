import assert from "node:assert/strict";
import test from "node:test";
import { browserWebProfile } from "./browser-web-profile.mjs";

const env = { AISCOO_BROWSER_NEW_API: "1", NEW_API_BASE_URL: "https://account.example" };
test("disabled profile leaves existing Web configuration unchanged", () => {
  assert.equal(browserWebProfile({}), null);
});
test("profile only adds public origin, fixed loopback and same-origin proxies", () => {
  const profile = browserWebProfile(env);
  assert.equal(profile.origin, env.NEW_API_BASE_URL);
  assert.deepEqual(profile.server, {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: false,
    allowedHosts: ["127.0.0.1"],
  });
  assert.equal(Object.keys(profile.proxy)[0], "/api/xcode/v1");
  assert.equal(profile.proxy["/api/xcode/v1"].target, env.NEW_API_BASE_URL);
  assert.equal(profile.proxy["/ws"].target, "ws://127.0.0.1:3030");
});
test("entry boundary runs before Vite and rejects cross-site and editor actions", () => {
  let middleware;
  browserWebProfile(env).plugin.configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
  });
  for (const [headers, url, accepted] of [
    [{ host: "127.0.0.1:5173" }, "/", true],
    [{ host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" }, "/ws", true],
    [{ host: "evil.localhost:5173" }, "/", false],
    [{ host: "127.0.0.1:5173", origin: "https://evil.example" }, "/@fs/file", false],
    [{ host: "127.0.0.1:5173", "sec-fetch-site": "cross-site" }, "/", false],
    [{ host: "127.0.0.1:5173" }, "/__open-in-editor?file=private", false],
  ]) {
    let reached = false;
    const res = { end() {} };
    middleware({ headers, url }, res, () => {
      reached = true;
    });
    assert.equal(reached, accepted);
    if (!accepted) assert.equal(res.statusCode, 403);
  }
});
test("authorization callback permits only a cross-site top-level navigation", () => {
  let middleware;
  browserWebProfile(env).plugin.configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
  });
  for (const mode of ["navigate", "no-cors"]) {
    let reached = false;
    middleware(
      {
        method: "GET",
        url: "/oauth/callback?provider=new-api&code=synthetic&state=synthetic",
        headers: { host: "127.0.0.1:5173", "sec-fetch-site": "cross-site", "sec-fetch-mode": mode },
      },
      { end() {} },
      () => {
        reached = true;
      },
    );
    assert.equal(reached, mode === "navigate");
  }
});
test("invalid origins never turn into a proxy target", () => {
  for (const origin of [
    "http://evil.example",
    "https://user:pass@account.example",
    "https://account.example/path",
  ]) {
    assert.throws(() => browserWebProfile({ ...env, NEW_API_BASE_URL: origin }));
  }
  for (const browserOrigin of [
    "http://localhost:5173",
    "http://127.0.0.1:80",
    "https://127.0.0.1:5173",
  ]) {
    assert.throws(() => browserWebProfile({ ...env, AISCOO_BROWSER_ORIGIN: browserOrigin }));
  }
});
