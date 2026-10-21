import { createZenDefaultDependencies } from "@zcode/adapters/auth";
import { ZenAccountRuntime } from "./account.js";
import type { ZenLoginOptions } from "./contract.js";

export async function createZenAccount(env: Readonly<Record<string, string | undefined>>) {
  return new ZenAccountRuntime(await createZenDefaultDependencies(env));
}
export async function loginZenCli(
  options: ZenLoginOptions & { env: Readonly<Record<string, string | undefined>> },
) {
  const account = await createZenAccount(options.env);
  try {
    return await account.login(options);
  } finally {
    account.dispose();
  }
}
export async function logoutZenCli(options: { env: Readonly<Record<string, string | undefined>> }) {
  const account = await createZenAccount(options.env);
  try {
    return await account.logout();
  } finally {
    account.dispose();
  }
}
