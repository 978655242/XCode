export interface ProductBrand {
  readonly productName: string;
  readonly wordmark: string;
  readonly developmentName: string;
  readonly previewName: string;
  readonly desktopName: string;
  readonly sourceDirectory: string;
  /** 法定运营主体原名；不经过产品展示名替换。 */
  readonly legalOperatorName: string;
  readonly desktopIcon: Readonly<{
    theme: "light" | "dark";
    markScale: number;
  }>;
  readonly palette: Readonly<{
    lightForeground: string;
    lightBackground: string;
    darkForeground: string;
    darkBackground: string;
  }>;
}

export const PRODUCT_BRAND: Readonly<ProductBrand>;
export const PRODUCT_NAME: string;
export const PRODUCT_WORDMARK: string;
/** Only for product-owned static templates, before user values are interpolated. */
export function brandProductText(template: string): string;
export function brandMessageCatalog<T extends Record<string, string>>(messages: T): T;
