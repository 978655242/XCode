import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { exampleAiscooAccountAvatar } from "./contract.example.js";
import { AiscooAccountAvatar, getAccountAvatarDataUri } from "./index.js";

function svgFor(userId: string) {
  return decodeURIComponent(getAccountAvatarDataUri(userId)!.split(",").slice(1).join(","));
}

describe("XWork default account avatar", () => {
  it("matches the new-api ID 42 SVG golden without network or identity metadata", () => {
    const svg = svgFor("42");
    expect(createHash("sha256").update(svg).digest("hex")).toBe(
      "f0d93b3eb893342c11ba3dfd82ac35b8e525bd4658437d8be1bd4ef1f3d91892",
    );
    expect(svg).toContain('viewBox="0 0 231 231"');
    expect(svg).not.toMatch(/<script|<image|<foreignObject|https?:\/\/(?!www\.w3\.org)/u);
    expect(getAccountAvatarDataUri("42")).toBe(getAccountAvatarDataUri("42"));
    expect(getAccountAvatarDataUri("43")).not.toBe(getAccountAvatarDataUri("42"));
  });

  it("keeps the generated image stable across changes to the display label", () => {
    const initial = renderToStaticMarkup(exampleAiscooAccountAvatar());
    const renamed = renderToStaticMarkup(
      createElement(AiscooAccountAvatar, { userId: "42", label: "Renamed" }),
    );
    const src = getAccountAvatarDataUri("42")!;
    expect(initial).toContain(src);
    expect(renamed).toContain(src);
    expect(initial).toContain('alt="Ada"');
    expect(renamed).toContain('alt="Renamed"');
  });

  it("uses opaque legacy account IDs safely and has a neutral fallback for no identity", () => {
    const markup = renderToStaticMarkup(
      createElement(AiscooAccountAvatar, { userId: '<script>alert("x")</script>', label: "User" }),
    );
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("data:image/svg+xml;charset=utf-8,");
    expect(getAccountAvatarDataUri("")).toBeNull();
    expect(getAccountAvatarDataUri("  ")).toBeNull();
    const anonymous = renderToStaticMarkup(
      createElement(AiscooAccountAvatar, { userId: "", label: "User" }),
    );
    expect(anonymous).toContain('role="img"');
    expect(anonymous).not.toContain("data:image");
  });
});
