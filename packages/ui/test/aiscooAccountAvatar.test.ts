// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useProfileAvatarFallback } from "@/profile-avatar/index.js";
import {
  AiscooAccountAvatar,
  AiscooAccountAvatarProvider,
  createAiscooAccountAvatarRoot,
  getAccountAvatarDataUri,
} from "@/aiscoo/account-avatar/index.js";

afterEach(cleanup);

describe("XWork account avatar rendering", () => {
  it("falls back to a neutral icon when the generated image cannot decode", () => {
    render(createElement(AiscooAccountAvatar, { userId: "42", label: "Ada" }));
    fireEvent.error(screen.getByRole("img", { name: "Ada" }));
    const fallback = screen.getByRole("img", { name: "Ada" });
    expect(fallback.tagName.toLowerCase()).toBe("svg");
    expect(fallback.getAttribute("src")).toBeNull();
  });

  it("retries the correct image after switching identities and returning to the first user", () => {
    const view = render(createElement(AiscooAccountAvatar, { userId: "42", label: "Ada" }));
    fireEvent.error(screen.getByRole("img", { name: "Ada" }));
    view.rerender(createElement(AiscooAccountAvatar, { userId: "43", label: "Grace" }));
    expect(screen.getByRole("img", { name: "Grace" }).getAttribute("src")).toBe(
      getAccountAvatarDataUri("43"),
    );
    view.rerender(createElement(AiscooAccountAvatar, { userId: "42", label: "Ada renamed" }));
    expect(screen.getByRole("img", { name: "Ada renamed" }).getAttribute("src")).toBe(
      getAccountAvatarDataUri("42"),
    );
  });

  it("injects the default avatar through the optional root extension without mutating user data", () => {
    const user = Object.freeze({ id: "42", username: "ada", displayName: "Ada" });
    function Root() {
      return createElement("div", null, useProfileAvatarFallback(user, "A"));
    }
    const WrappedRoot = createAiscooAccountAvatarRoot(Root);
    render(createElement(WrappedRoot));
    expect(screen.getByRole("img", { name: "Ada" }).getAttribute("src")).toBe(
      getAccountAvatarDataUri("42"),
    );
    expect(user).toEqual({ id: "42", username: "ada", displayName: "Ada" });
  });

  it("leaves a caller's anonymous fallback intact even with the product provider", () => {
    function Guest() {
      return createElement("span", null, useProfileAvatarFallback(null, "Signed out"));
    }
    const view = render(
      createElement(AiscooAccountAvatarProvider, { children: createElement(Guest) }),
    );
    expect(view.container.textContent).toBe("Signed out");
    expect(screen.queryByRole("img")).toBeNull();
  });
});
