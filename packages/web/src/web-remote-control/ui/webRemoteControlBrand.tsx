import { ZCodeAppLogo } from "@zcode/ui/app-logo";

/** 连接前各页的页头品牌：桌面端同款 logo 图标 + “ZCode”文字，纯静态标识，不可点击。 */
// XCODE: 开放通用名称插槽，产品入口显式装配品牌，上游默认名称不变。
export function WebRemoteControlBrand({
  className,
  productName = "ZCode",
}: {
  className?: string;
  productName?: string;
}) {
  return (
    <span className={["inline-flex items-center gap-2", className].filter(Boolean).join(" ")}>
      <ZCodeAppLogo className="size-5" />
      <span className="text-ui-xs font-medium">{productName}</span>
    </span>
  );
}
