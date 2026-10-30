import { getAiscooDesktopIdentity } from "./runtime.js";

export function exampleAiscooDesktopIdentity(): string {
  return getAiscooDesktopIdentity("production").oauthRedirectUri;
}
