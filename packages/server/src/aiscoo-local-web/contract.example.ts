import type { LocalWebOptions } from "./contract.js";

/** The UI proxy must preserve this exact page Host and Origin. */
export const localWebExample: LocalWebOptions = {
  allowedOrigins: ["http://127.0.0.1:5173"],
};
