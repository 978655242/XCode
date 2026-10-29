import { createElement } from "react";
import type { AiscooLegalLinksProps } from "./contract.js";
import { AiscooLegalLinks } from "./index.js";

/** 登录面板直接复用本次 useOAuth 返回的 providers。 */
export function aiscooLegalExample(providers: AiscooLegalLinksProps["providers"]) {
  return createElement(AiscooLegalLinks, { providers, placement: "login" });
}
