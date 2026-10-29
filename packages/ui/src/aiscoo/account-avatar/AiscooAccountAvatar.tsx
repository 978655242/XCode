import type { UserInfo } from "@zcode/shared";
import { User } from "lucide-react";
import { useState, type ComponentType } from "react";
import { ProfileAvatarFallbackProvider } from "@/profile-avatar/index.js";
import type { AiscooAccountAvatarProps, AiscooAccountAvatarProviderProps } from "./contract.js";
import { getAccountAvatarDataUri } from "./generator.js";

function GeneratedAccountAvatar(props: { src: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  if (!props.src || failed) {
    return <User className="size-4" role="img" aria-label={props.label} />;
  }
  return (
    <img
      src={props.src}
      alt={props.label}
      className="size-full rounded-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export function AiscooAccountAvatar(props: AiscooAccountAvatarProps) {
  const src = getAccountAvatarDataUri(props.userId);
  return <GeneratedAccountAvatar key={src} src={src} label={props.label} />;
}

function renderAccountAvatar(user: UserInfo) {
  return (
    <AiscooAccountAvatar
      userId={user.id}
      label={user.displayName.trim() || user.username.trim() || user.id}
    />
  );
}

export function AiscooAccountAvatarProvider(props: AiscooAccountAvatarProviderProps) {
  return (
    <ProfileAvatarFallbackProvider renderFallback={renderAccountAvatar}>
      {props.children}
    </ProfileAvatarFallbackProvider>
  );
}

export function createAiscooAccountAvatarRoot<Props extends object>(Root: ComponentType<Props>) {
  return function AiscooAccountAvatarRoot(props: Props) {
    return (
      <AiscooAccountAvatarProvider>
        <Root {...props} />
      </AiscooAccountAvatarProvider>
    );
  };
}
