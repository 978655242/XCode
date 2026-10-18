import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

function readWebIndexHtml(): string {
  return readFileSync(resolve(process.cwd(), "packages/web/index.html"), "utf8");
}

function createBootstrapDocument(theme: "zai-dark" | "zai-light"): JSDOM {
  return new JSDOM(readWebIndexHtml(), {
    beforeParse(window) {
      window.localStorage.setItem("zcode-theme", theme);
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: () => ({ matches: false }),
      });
    },
    runScripts: "dangerously",
    url: "https://zcode.example/remote",
  });
}

describe("web remote control bootstrap shell", () => {
  it.each([
    ["zai-dark", "dark", "#161616"],
    ["zai-light", "light", "#f8f8f8"],
  ] as const)(
    "在业务 bundle 执行前把 %s 同步到浏览器主题表面",
    (storedTheme, resolvedTheme, expectedColor) => {
      const dom = createBootstrapDocument(storedTheme);
      const { document } = dom.window;

      expect(document.documentElement.getAttribute("data-zcode-browser-theme-surface")).toBe(
        resolvedTheme,
      );
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
        expectedColor,
      );
      expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(
        resolvedTheme,
      );

      dom.window.close();
    },
  );
});
