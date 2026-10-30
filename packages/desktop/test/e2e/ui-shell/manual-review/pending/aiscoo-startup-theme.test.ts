type StartupFrame = {
  dark: boolean;
  theme: string;
  background: string;
  logo: string[];
  imageReady: boolean;
};

type StartupTrace = {
  frames: StartupFrame[];
  removed: boolean;
  ready: boolean;
};

describe("桌面启动壳主题", () => {
  it("启动壳按已保存主题显示，并与 React 接管保持一致", async function () {
    this.timeout(90_000);
    const current = await browser.getWindowHandle();
    const target = (await browser.getPuppeteer())
      .targets()
      .find(
        (candidate) =>
          candidate.type() === "page" &&
          (candidate as unknown as { _targetId?: string })._targetId === current,
      );
    if (!target) throw new Error("缺少桌面主窗口的 renderer target");
    const page = await target.page();
    if (!page) throw new Error("无法连接桌面主窗口");
    const originalTheme = await page.evaluate(() => localStorage.getItem("zcode-theme"));
    const cdp = await page.createCDPSession();
    let identifier: string | undefined;
    const observer = `(() => {
      const trace = window.__aiscooStartupTrace = { frames: [], removed: false, ready: false };
      addEventListener('zcode-react-startup-ready', () => { trace.ready = true; });
      let seen = false;
      function frame() {
        const shell = document.querySelector('#loading');
        if (shell) {
          seen = true;
          const images = Array.from(shell.querySelectorAll('img[data-startup-asset]'));
          const visible = images.filter(image => getComputedStyle(image).display !== 'none');
          trace.frames.push({
            dark: document.documentElement.classList.contains('dark'),
            theme: document.documentElement.classList.contains('theme-zai-dark') ? 'dark' :
              document.documentElement.classList.contains('theme-zai-light') ? 'light' : 'none',
            background: getComputedStyle(shell).backgroundColor,
            logo: visible.map(image => image.getAttribute('data-startup-asset')),
            imageReady: visible.length === 1 && visible[0].complete && visible[0].naturalWidth > 0,
          });
        } else if (seen) {
          trace.removed = true;
          return;
        }
        if (performance.now() < 15000) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    })();`;
    try {
      await cdp.send("Page.enable");
      ({ identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: observer,
      }));
      const cases = [
        { saved: "zai-dark", system: "light", expected: "dark", reduced: false },
        { saved: "zai-light", system: "dark", expected: "light", reduced: false },
        { saved: "system", system: "dark", expected: "dark", reduced: false },
        { saved: "zai-dark", system: "light", expected: "dark", reduced: true },
      ];
      for (const item of cases) {
        await page.evaluate((theme) => localStorage.setItem("zcode-theme", theme), item.saved);
        await cdp.send("Emulation.setEmulatedMedia", {
          features: [
            { name: "prefers-color-scheme", value: item.system },
            { name: "prefers-reduced-motion", value: item.reduced ? "reduce" : "no-preference" },
          ],
        });
        await browser.refresh();
        await browser.waitUntil(
          () =>
            page.evaluate(() => {
              const trace = (window as typeof window & { __aiscooStartupTrace?: StartupTrace })
                .__aiscooStartupTrace;
              return (
                trace?.removed && trace.ready && trace.frames.some((frame) => frame.imageReady)
              );
            }),
          { timeout: 15_000, timeoutMsg: "未观察到完整的启动壳和已解码的 Logo" },
        );
        const trace = await page.evaluate(
          () =>
            (window as typeof window & { __aiscooStartupTrace?: StartupTrace })
              .__aiscooStartupTrace!,
        );
        const loadedFrames = trace.frames.filter((frame) => frame.imageReady);
        expect(loadedFrames.length).toBeGreaterThan(0);
        for (const frame of trace.frames) {
          expect(frame.dark).toBe(item.expected === "dark");
          expect(frame.theme).toBe(item.expected);
          expect(frame.background).toBe(
            item.expected === "dark" ? "rgb(22, 22, 22)" : "rgb(248, 248, 248)",
          );
        }
        for (const frame of loadedFrames) {
          expect(frame.logo).toEqual([`${item.reduced ? "mark" : "startup"}-${item.expected}`]);
        }
        const reactTheme = await page.evaluate(() => ({
          dark: document.documentElement.classList.contains("dark"),
          theme: document.documentElement.classList.contains("theme-zai-dark")
            ? "dark"
            : document.documentElement.classList.contains("theme-zai-light")
              ? "light"
              : "none",
        }));
        expect(reactTheme.dark).toBe(item.expected === "dark");
        expect(reactTheme.theme).toBe(item.expected);
      }
    } finally {
      if (identifier) {
        await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
      }
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      await cdp.detach();
      await page.evaluate((theme) => {
        if (theme === null) localStorage.removeItem("zcode-theme");
        else localStorage.setItem("zcode-theme", theme);
      }, originalTheme);
      await browser.refresh();
    }
  });
});
