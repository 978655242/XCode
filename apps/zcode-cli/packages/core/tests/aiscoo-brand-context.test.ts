import { describe, expect, it } from "vitest";
import { createContextBuilder } from "../src/context/index.js";
import { buildCliPrefixSection } from "../src/context/sections/cli-prefix.js";
import { buildIdentitySection } from "../src/context/sections/identity.js";
import { buildDesktopContextSection } from "../src/context/sections/desktop.js";

describe("downstream brand system templates", () => {
  it("brands only owned identity templates and preserves supplied directory text", () => {
    expect(buildCliPrefixSection().content).toBe("You are Aiscoo, an interactive coding agent");
    expect(buildIdentitySection().content).toContain("interactive Aiscoo agent");
    expect(buildIdentitySection({ name: "XWork", prompt: "ZCode" }).content).toContain("using Aiscoo's tools");
    const directory = "/tmp/XWork ZCode/XCode";
    const section = buildDesktopContextSection(directory);
    expect(section.name).toBe("Aiscoo Desktop Context");
    expect(section.content).toContain("# Aiscoo Desktop Context");
    expect(section.content).toContain(JSON.stringify(directory));
    expect(section.content).toContain("window.zcode");
  });

  it("keeps user OutputStyle and instruction values unchanged after assembly", () => {
    const userValue = "Keep XWork ZCode XCode and https://zcode.z.ai exactly.";
    const result = createContextBuilder({
      workingDirectory: "/tmp/XWork",
      envInfo: { cwd: "/tmp/XWork", platform: "darwin", shell: "zsh", osVersion: "Darwin", nodeVersion: "v24.18.0" },
      outputStyle: { name: "XWork", prompt: userValue, keepCodingInstructions: false },
      userInstructions: { filePath: "/tmp/XWork/AGENTS.md", fileName: "AGENTS.md", content: userValue, bytesRead: userValue.length, sizeBytes: userValue.length, truncated: false },
    }).build();
    expect(result.systemMessages[0].content).toBe("You are Aiscoo, an interactive coding agent");
    expect(result.sections.some((section) => section.content.includes(userValue))).toBe(true);
    expect(JSON.stringify(result.metaUserAttachments)).toContain(userValue);
  });
});
