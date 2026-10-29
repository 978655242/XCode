import { createElement, type ReactNode } from "react";
import { ProfileAvatarFallbackProvider } from "./index.js";

export function exampleProfileAvatar(children: ReactNode) {
  return createElement(ProfileAvatarFallbackProvider, {
    renderFallback: (user) => createElement("span", null, user.id),
    children,
  });
}
