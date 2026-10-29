import type { ReactElement } from "react";

export type AiscooBrandTone = "theme" | "light" | "dark";

/** 纯展示属性；tone 指背景主题，固定深色品牌容器可显式选择 dark。 */
export interface AiscooBrandProps {
  className?: string;
  tone?: AiscooBrandTone;
}

export interface AiscooStartupLogoProps extends AiscooBrandProps {
  animated?: boolean;
}

export interface AiscooAnimatedWordmarkProps extends AiscooBrandProps {
  animated?: boolean;
}

export interface AiscooStartupBadgeProps {
  animated?: boolean;
  size?: "default" | "titlebar";
}

export interface AiscooBrandComponents {
  Mark(props: AiscooBrandProps): ReactElement;
  Wordmark(props: AiscooBrandProps): ReactElement;
}

/** Provider 只读装配参数直接沿用原入口，语言状态仍由原 Provider 独占。 */
export type AiscooIntlProviderProps = Omit<
  import("react").ComponentProps<typeof import("@/i18n/IntlProvider.js").ZCodeIntlProvider>,
  "catalogTransform"
>;
