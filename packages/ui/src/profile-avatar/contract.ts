import type { UserInfo } from "@zcode/shared";
import type { ReactNode } from "react";

// 返回 null 或 undefined 表示不接管该身份，继续使用调用方原有 fallback。
export type ProfileAvatarFallbackRenderer = (user: UserInfo) => ReactNode;

export interface ProfileAvatarFallbackProviderProps {
  renderFallback: ProfileAvatarFallbackRenderer;
  children: ReactNode;
}
