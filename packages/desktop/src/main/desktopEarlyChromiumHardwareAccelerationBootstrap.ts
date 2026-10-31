import { app } from "electron";
import { applyEarlyChromiumHardwareAccelerationBootstrap } from "./desktopChromiumHardwareAccelerationBootstrap.js";

// XCODE: 与设置服务共用早期选择的文件，避免旧 ZCode 设置覆盖本渠道硬件加速偏好。
applyEarlyChromiumHardwareAccelerationBootstrap(
  app,
  undefined,
  process.env.ZCODE_SETTINGS_FILE_PATH,
);
