import { formatJson } from "@zcode/core";
import type { GlobalOptions, RunContext } from "@zcode/shared-types";
import { loadBootstrapModule } from "./bootstrap-loader.js";
import { loadCliDotenv } from "./env.js";
import type { RunDependencies } from "./cli-types.js";

export async function runLoginCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: RunDependencies,
  noBrowser: boolean,
  args: readonly string[] = [],
): Promise<number> {
  try {
    const providerId = args[0] ?? "zai";
    if (args.length > 1 || !["zai", "bigmodel", "zen"].includes(providerId)) {
      throw new Error("Usage: zcode login [zen|zai|bigmodel] [--no-browser]");
    }
    const env = deps.env ?? process.env;
    const workingDirectory = (deps.cwd ?? process.cwd)();
    const dotenvResult = (deps.loadDotenv ?? loadCliDotenv)({
      cwd: workingDirectory,
      env,
    });

    if (dotenvResult.error) {
      throw new Error(`Failed to load environment file: ${dotenvResult.path}`, {
        cause: dotenvResult.error,
      });
    }

    // XCODE: Zen 授权拥有独立回环与 SID，结果不输出凭据路径或 token。
    if (providerId === "zen") {
      const login = deps.loginZenCli ?? (await loadBootstrapModule()).loginZenCli;
      const result = await login({
        env,
        noBrowser,
        onAuthorizeUrl: (url) => {
          if (options.json)
            ctx.stderr.write(`${JSON.stringify({ event: "authorize", provider: "zen", url })}\n`);
          else ctx.stdout.write(`Open on this computer to sign in to XWork Zen Plan:\n${url}\n`);
        },
      });
      ctx.stdout.write(
        options.json
          ? formatJson({ status: "ready", provider: "zen", user: result.user })
          : `Signed in to XWork Zen Plan as ${result.user.display_name || result.user.username}.\nSelect a Zen model with /model.\n`,
      );
      return 0;
    }
    const login = deps.loginZCodeCli ?? (await loadBootstrapModule()).loginZCodeCli;
    const result = await login({
      env,
      noBrowser,
      providerId: providerId as "zai" | "bigmodel",
      onAuthorizeUrl: (data) => {
        writeAuthorizeUrl(
          ctx,
          options,
          data.authorize_url,
          noBrowser,
          providerId as "zai" | "bigmodel",
        );
      },
      onBrowserOpen: (browser) => {
        if (!options.json && !browser.opened) {
          ctx.stdout.write(`Browser open failed: ${browser.reason ?? "unknown error"}\n`);
        }
      },
    });

    if (options.json) {
      ctx.stdout.write(
        formatJson({
          status: "ready",
          provider: result.providerId,
          user: {
            user_id: result.user.user_id,
            ...(result.user.email ? { email: result.user.email } : {}),
            ...(result.user.name ? { name: result.user.name } : {}),
            ...(result.user.avatar ? { avatar: result.user.avatar } : {}),
          },
          model: result.model,
          credentialsPath: result.credentialsPath,
          configPath: result.configPath,
          browserOpened: result.browser?.opened ?? false,
        }),
      );
      return 0;
    }

    ctx.stdout.write(
      [
        `Login successful${formatUserLabel(result.user)}.`,
        `Model: ${result.model}`,
        `Credentials: ${result.credentialsPath}`,
        `Model selection: ${result.configPath}`,
      ].join("\n") + "\n",
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`Error: ${message}\n`);
    if (options.verbose && error instanceof Error && error.stack) {
      ctx.stderr.write(`${error.stack}\n`);
    }
    return 1;
  }
}

export async function runLogoutCommand(
  ctx: RunContext,
  options: GlobalOptions,
  deps: RunDependencies,
  args: readonly string[] = [],
): Promise<number> {
  try {
    const env = deps.env ?? process.env;
    const workingDirectory = (deps.cwd ?? process.cwd)();
    const dotenvResult = (deps.loadDotenv ?? loadCliDotenv)({
      cwd: workingDirectory,
      env,
    });

    if (dotenvResult.error) {
      throw new Error(`Failed to load environment file: ${dotenvResult.path}`, {
        cause: dotenvResult.error,
      });
    }

    if (args.length > 1 || (args.length === 1 && args[0] !== "zen"))
      throw new Error("Usage: zcode logout [zen]");
    if (args[0] === "zen") {
      const logout = deps.logoutZenCli ?? (await loadBootstrapModule()).logoutZenCli;
      const result = await logout({ env });
      ctx.stdout.write(
        options.json
          ? formatJson({ provider: "zen", ...result })
          : result.serverRevoked
            ? "Signed out of XWork Zen Plan.\n"
            : "Local Zen credentials cleared; server revocation could not be confirmed.\n",
      );
      return 0;
    }
    const logout = deps.logoutZCodeCli ?? (await loadBootstrapModule()).logoutZCodeCli;
    const result = await logout({ env });

    if (options.json) {
      ctx.stdout.write(
        formatJson({
          status: "logged_out",
          provider: "zai",
          credentialsPath: result.credentialsPath,
        }),
      );
      return 0;
    }

    ctx.stdout.write(
      `Logged out from Coding Plan accounts. Credentials: ${result.credentialsPath}\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`Error: ${message}\n`);
    if (options.verbose && error instanceof Error && error.stack) {
      ctx.stderr.write(`${error.stack}\n`);
    }
    return 1;
  }
}

function writeAuthorizeUrl(
  ctx: RunContext,
  options: GlobalOptions,
  authorizeUrl: string,
  noBrowser: boolean,
  providerId: "zai" | "bigmodel",
): void {
  const target = options.json ? ctx.stderr : ctx.stdout;
  if (noBrowser) {
    target.write(`Open this URL to sign in:\n${authorizeUrl}\n`);
    return;
  }

  target.write(
    `Opening browser for ${providerId === "bigmodel" ? "BigModel" : "Z.AI"} authorization.\nFallback URL:\n${authorizeUrl}\n`,
  );
}

function formatUserLabel(user: { email?: string; name?: string; user_id: string }): string {
  const label = user.name || user.email || user.user_id;
  return label ? ` as ${label}` : "";
}
