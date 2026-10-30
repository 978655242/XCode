export const profileAvatarModule = {
  id: "profile-avatar",
  requires: ["shared"],
  provides: ["profile-avatar"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
