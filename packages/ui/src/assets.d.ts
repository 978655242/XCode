declare module "*.css";
declare module "*.mp3";
declare module "*.png";
declare module "*.svg";
declare module "*.webp";

// Vite 的 `?url` 资源导入（如 pdf.js worker），返回打包后的资源 URL 字符串。
declare module "*?url" {
  const src: string;
  export default src;
}

// XCODE: Vite 的 import.meta.glob（模型图标按名称懒加载静态 SVG 资源 URL）。
interface ImportMeta {
  glob<T>(
    pattern: string,
    options: { import: "default"; query: "?url" },
  ): Record<string, () => Promise<T>>;
}
