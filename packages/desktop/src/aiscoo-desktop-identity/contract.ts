export interface AiscooDesktopDataBootstrapOptions {
  readonly env: Record<string, string | undefined>;
  readonly appDataPath: string;
  readonly setDataBaseDir: (path: string) => void;
}

export type DesktopDataBootstrap = (settingsFile?: string) => string | null;
