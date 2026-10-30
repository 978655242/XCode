// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let html: string;

beforeAll(async () => {
  html = await readFile("packages/desktop/src/renderer/index.html", "utf8");
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderStartupShell(theme: string | null, systemDark: boolean) {
  localStorage.clear();
  if (theme !== null) localStorage.setItem("zcode-theme", theme);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && systemDark,
      media: query,
    })),
  });
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.documentElement.className = "";
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  const bootstrap = document.head.querySelector("script:not([type])");
  expect(bootstrap?.textContent).toBeTruthy();
  window.eval(bootstrap!.textContent!);
}

describe("desktop startup shell theme", () => {
  it.each([
    { saved: "zai-dark", systemDark: false, expected: "dark" },
    { saved: "zai-light", systemDark: true, expected: "light" },
    { saved: "dark", systemDark: false, expected: "dark" },
    { saved: "light", systemDark: true, expected: "light" },
    { saved: "system", systemDark: true, expected: "dark" },
    { saved: "system", systemDark: false, expected: "light" },
    { saved: null, systemDark: false, expected: "dark" },
    { saved: "", systemDark: false, expected: "dark" },
    { saved: "unknown", systemDark: true, expected: "light" },
  ])(
    "uses $expected for saved=$saved and systemDark=$systemDark before React loads",
    ({ saved, systemDark, expected }) => {
      renderStartupShell(saved, systemDark);
      expect(document.documentElement.classList.contains("dark")).toBe(expected === "dark");
      expect(document.documentElement.classList.contains(`theme-zai-${expected}`)).toBe(true);
      const activeLogo = document.querySelector<HTMLImageElement>(
        `img[data-startup-asset="startup-${expected}"]`,
      );
      const inactiveLogo = document.querySelector<HTMLImageElement>(
        `img[data-startup-asset="startup-${expected === "dark" ? "light" : "dark"}"]`,
      );
      expect(activeLogo).not.toBeNull();
      expect(inactiveLogo).not.toBeNull();
      expect(getComputedStyle(activeLogo!).display).not.toBe("none");
      expect(getComputedStyle(inactiveLogo!).display).toBe("none");
      const styles = Array.from(document.styleSheets[0].cssRules) as CSSStyleRule[];
      const selector = expected === "dark" ? "html.dark #loading" : "#loading";
      const background = styles.find((rule) => rule.selectorText === selector)?.style.background;
      expect(background).toBe(
        expected === "dark"
          ? "var(--color-background, #161616)"
          : "var(--color-background, #f8f8f8)",
      );
      expect(localStorage.getItem("zcode-theme")).toBe(saved);
    },
  );

  it("falls back to dark when theme storage cannot be read", () => {
    renderStartupShell(null, false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    document.documentElement.className = "";
    window.eval(document.head.querySelector("script:not([type])")!.textContent!);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-zai-dark")).toBe(true);
  });
});
