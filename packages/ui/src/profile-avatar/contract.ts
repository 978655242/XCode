import type { UserInfo } from "@zcode/shared";
import type { ReactNode } from "react";

export type ProfileAvatarFallbackRenderer = (user: UserInfo) => ReactNode;

export interface ProfileAvatarFallbackProviderProps {
  renderFallback: ProfileAvatarFallbackRenderer;
  children: ReactNode;
}
