import type { UserInfo } from "@zcode/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { exampleProfileAvatar } from "./contract.example.js";
import { useProfileAvatarFallback } from "./index.js";

const user: UserInfo = { id: "42", username: "ada", displayName: "Ada" };

function Consumer(props: { user: UserInfo | null }) {
  return createElement("div", null, useProfileAvatarFallback(props.user, "A"));
}

describe("profile avatar fallback extension", () => {
  it("preserves the caller fallback when the extension is absent", () => {
    expect(renderToStaticMarkup(createElement(Consumer, { user }))).toBe("<div>A</div>");
  });

  it("uses the supplied renderer only for a signed-in user", () => {
    const signedIn = renderToStaticMarkup(exampleProfileAvatar(createElement(Consumer, { user })));
    expect(signedIn).toBe("<div><span>42</span></div>");
    expect(
      renderToStaticMarkup(exampleProfileAvatar(createElement(Consumer, { user: null }))),
    ).toBe("<div>A</div>");
  });
});
