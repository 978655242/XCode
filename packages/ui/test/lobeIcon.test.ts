import { describe, expect, it } from "vitest";
import { resolveLobeIcon } from "@/components/LobeIcon.js";

// 测试环境把小 SVG 内联成 data URL；比较图标 <title> 来源而非文件路径。
async function title(name: string) {
  const url = await resolveLobeIcon(name)!.load();
  return /<title>([^<]*)<\/title>/.exec(decodeURIComponent(url))?.[1];
}

describe("resolveLobeIcon", () => {
  it("按后端图标名选择彩色或单色资源", async () => {
    expect(resolveLobeIcon("Claude.Color")?.mono).toBe(false);
    expect(resolveLobeIcon("OpenAI")?.mono).toBe(true);
    expect(await title("Claude.Color")).toBe("Claude");
    expect(await title("OpenAI")).toBe("OpenAI");
    expect(await title("ZAI")).toBe("Z.ai");
    expect(await title("DeepSeek.Color")).toBe("DeepSeek");
  });

  it("没有彩色资源时回落单色，未知名称返回 null", () => {
    // OpenAI 只有单色资源，与管理端 getLobeIcon 的回落规则一致。
    expect(resolveLobeIcon("OpenAI.Color")?.mono).toBe(true);
    expect(resolveLobeIcon("NoSuchBrand")).toBeNull();
    expect(resolveLobeIcon("")).toBeNull();
  });
});
