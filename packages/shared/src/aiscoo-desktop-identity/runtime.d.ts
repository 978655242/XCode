import type { AiscooDesktopChannel, AiscooDesktopIdentity } from "./contract.js";
export type { AiscooDesktopChannel, AiscooDesktopIdentity } from "./contract.js";

export function getAiscooDesktopIdentity(channel: AiscooDesktopChannel): AiscooDesktopIdentity;
export function resolveAiscooDesktopIdentity(): AiscooDesktopIdentity | null;
