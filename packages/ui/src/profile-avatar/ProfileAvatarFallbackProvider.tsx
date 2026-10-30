import type { UserInfo } from "@zcode/shared";
import { createContext, useContext, type ReactNode } from "react";
import type {
  ProfileAvatarFallbackProviderProps,
  ProfileAvatarFallbackRenderer,
} from "./contract.js";

const ProfileAvatarFallbackContext = createContext<ProfileAvatarFallbackRenderer | null>(null);

export function ProfileAvatarFallbackProvider(props: ProfileAvatarFallbackProviderProps) {
  return (
    <ProfileAvatarFallbackContext value={props.renderFallback}>
      {props.children}
    </ProfileAvatarFallbackContext>
  );
}

export function useProfileAvatarFallback(
  user: UserInfo | null | undefined,
  defaultFallback: ReactNode,
): ReactNode {
  const renderFallback = useContext(ProfileAvatarFallbackContext);
  return user && renderFallback ? (renderFallback(user) ?? defaultFallback) : defaultFallback;
}
