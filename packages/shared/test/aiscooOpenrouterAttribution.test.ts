import { describe, expect, it } from "vitest";
import { withOpenRouterAttributionHeaders } from "../src/openrouter-attribution.js";

describe("Aiscoo OpenRouter attribution", () => {
  it("uses the product name only for OpenRouter without changing other headers", () => {
    const headers = { "X-Title": "User XWork integration", "X-Custom": "unchanged" };
    expect(withOpenRouterAttributionHeaders(headers, "https://openrouter.ai/api/v1")).toEqual({
      ...headers,
      "X-OpenRouter-Title": "Aiscoo",
      "X-OpenRouter-Categories": "programming-app",
    });
    expect(withOpenRouterAttributionHeaders(headers, "https://example.invalid/v1")).toEqual(
      headers,
    );
    expect(headers).toEqual({ "X-Title": "User XWork integration", "X-Custom": "unchanged" });
  });
});
