export const aiscooAccountAvatarModule = {
  id: "xwork-account-avatar",
  requires: ["profile-avatar", "shared"],
  provides: ["xwork-account-avatar"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
