import { loadCliKeyringModule } from "./contract.js";

export async function loadKeyringForZen() {
  return loadCliKeyringModule();
}
