import { app } from "electron";
import { setDataBaseDir } from "@zcode/services/node";
import { bootstrapAiscooDesktopData } from "../aiscoo-desktop-identity/index.js";
import { applyEarlyDataBaseDirBootstrap } from "./desktopDataBaseDirBootstrap.js";

// XCODE: 使用独立下游包装选择根目录，原 bootstrap 继续拥有自定义目录恢复。
bootstrapAiscooDesktopData(applyEarlyDataBaseDirBootstrap, {
  env: process.env,
  appDataPath: app.getPath("appData"),
  setDataBaseDir,
});
