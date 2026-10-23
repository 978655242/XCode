import { mkdir, writeFile } from "node:fs/promises";
import {
  createConnection,
  createServer,
  type AddressInfo,
  type Server,
  type Socket,
} from "node:net";
import { resolve } from "node:path";
import type { CommandAck, CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestRecordCount,
  countUpstreamRequests,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  createSSHLifecycleProvider,
  readRemoteCoreIdentity,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  readHostProcesses,
  readRemoteTabSnapshot,
  readSSHRuntimeConfig,
  runSSHCommand,
  type SSHConnectionConfig,
} from "../../../helpers/ssh-remote-p0.js";
import {
  clickV4Send,
  getV4ConversationState,
  getV4Messages,
  prepareV4ConversationE2E,
  setV4ComposerText,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_ACK_LOSS";
const artifactDir = resolve(process.env.ZCODE_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-ack-loss");

interface AckLossGateScope {
  workspacePath: string;
  workspaceIdentity: string;
  remoteSessionId: string;
  sessionId: string;
  marker: string;
}

interface AckLossGateHit extends AckLossGateScope {
  commandId: string;
  type: "sendText";
}

interface AckLossGateHandle {
  webContentsId: number;
  objectId: string;
  attachedByTest: boolean;
}

function installRendererCommandGate(scope: AckLossGateScope) {
  type Transport = {
    sendCommand(
      envelope: CommandEnvelope,
      context?: { projectId?: string | null },
    ): Promise<CommandAck>;
  };
  type MountedSessionProjectionProps = {
    workspacePath?: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
    sessionId?: string | null;
    sendText?: unknown;
    projectionStore?: {
      getState(): {
        status: string;
        snapshot: { sessionId: string; seq: number } | null;
      };
    } | null;
  };
  let transport: Transport | undefined;
  for (const pane of document.querySelectorAll<HTMLElement>(
    "[data-session-id][data-projection-seq]",
  )) {
    if (pane.getAttribute("data-session-id") !== scope.sessionId || !pane.getClientRects().length)
      continue;
    const fiberKey = Object.keys(pane).find((key) => key.startsWith("__reactFiber$"));
    const fiber: unknown = fiberKey ? Reflect.get(pane, fiberKey) : null;
    const alternate: unknown =
      fiber && typeof fiber === "object" ? Reflect.get(fiber, "alternate") : null;
    for (const start of [fiber, alternate]) {
      let ancestor: unknown = start;
      while (ancestor && typeof ancestor === "object") {
        const rawProps: unknown = Reflect.get(ancestor, "memoizedProps");
        if (rawProps && typeof rawProps === "object") {
          const props = rawProps as MountedSessionProjectionProps;
          if (
            props.workspacePath === scope.workspacePath &&
            props.workspaceIdentity === scope.workspaceIdentity &&
            props.remoteSessionId === scope.remoteSessionId &&
            props.sessionId === scope.sessionId &&
            typeof props.sendText === "function" &&
            typeof props.projectionStore?.getState === "function"
          ) {
            const state = props.projectionStore.getState();
            if (
              state.status === "live" &&
              state.snapshot?.sessionId === scope.sessionId &&
              String(state.snapshot.seq) === pane.getAttribute("data-projection-seq")
            ) {
              // XCODE: 从真实 pane 的公开 PluginUiSessionProvider props 反射只读 transport 引用，仅对原实例做测试故障注入；不读 SessionDataLayer Maps、不新建 lease。
              const candidate: unknown = Reflect.get(props.projectionStore, "transport");
              if (
                !candidate ||
                typeof candidate !== "object" ||
                typeof Reflect.get(candidate, "sendCommand") !== "function"
              ) {
                throw new Error("ACK-loss: scoped projection store 缺少真实 transport");
              }
              if (transport && transport !== candidate)
                throw new Error("ACK-loss: 可见 pane transport 不唯一");
              transport = candidate as Transport;
            }
          }
        }
        ancestor = Reflect.get(ancestor, "return");
      }
    }
  }
  if (!transport)
    throw new Error("ACK-loss: 找不到匹配 session/workspace/remoteSession 的 live pane");
  const targetTransport = transport;
  const original = targetTransport.sendCommand;
  const descriptor = Object.getOwnPropertyDescriptor(targetTransport, "sendCommand");
  if (descriptor && (!("value" in descriptor) || !descriptor.configurable)) {
    throw new Error("ACK-loss: sendCommand 不是可恢复的实例方法");
  }
  let hit: AckLossGateHit | null = null;
  let released = false;
  let restored = false;
  const { promise: gate, resolve: releaseGate } = Promise.withResolvers<void>();
  // XCODE: V4Context 每次动态读取同一 ReplaceableConversationTransport.sendCommand；目录 RPC 已返回，先等 gate 再调用原方法，保留 this 和全部参数。
  const wrapped: Transport["sendCommand"] = async function (this: Transport, ...args) {
    const [envelope] = args;
    const text: unknown =
      envelope.payload && typeof envelope.payload === "object"
        ? Reflect.get(envelope.payload, "text")
        : null;
    if (
      !hit &&
      !released &&
      envelope.type === "sendText" &&
      envelope.sessionId === scope.sessionId &&
      typeof text === "string" &&
      text.includes(scope.marker)
    ) {
      hit = { ...scope, commandId: envelope.commandId, type: "sendText" };
      await gate;
    }
    return Reflect.apply(original, this, args);
  };
  Object.defineProperty(targetTransport, "sendCommand", {
    ...(descriptor ?? { configurable: true, enumerable: false, writable: true }),
    value: wrapped,
  });
  return {
    read: () => hit,
    release() {
      released = true;
      releaseGate();
    },
    restore() {
      if (restored) return;
      if (descriptor) Object.defineProperty(targetTransport, "sendCommand", descriptor);
      else if (!Reflect.deleteProperty(targetTransport, "sendCommand"))
        throw new Error("ACK-loss: sendCommand override 删除失败");
      restored = true;
    },
  };
}

async function installCommandGate(scope: AckLossGateScope): Promise<AckLossGateHandle> {
  const expression = `(${installRendererCommandGate.toString()})(${JSON.stringify(scope)})`;
  return browser.electron.execute(async (electron, rendererExpression) => {
    const target = electron.BrowserWindow.getAllWindows().find(
      (window) => !window.isDestroyed() && window.isVisible(),
    );
    if (!target) throw new Error("ACK-loss: 没有可见 Desktop window");
    const debuggerApi = target.webContents.debugger;
    const attachedByTest = !debuggerApi.isAttached();
    if (attachedByTest) debuggerApi.attach("1.3");
    try {
      const result = (await debuggerApi.sendCommand("Runtime.evaluate", {
        expression: rendererExpression,
        returnByValue: false,
      })) as { result?: { objectId?: string }; exceptionDetails?: unknown };
      if (result.exceptionDetails || !result.result?.objectId) {
        throw new Error(`ACK-loss: gate 安装失败 ${JSON.stringify(result.exceptionDetails)}`);
      }
      return {
        webContentsId: target.webContents.id,
        objectId: result.result.objectId,
        attachedByTest,
      };
    } catch (error) {
      if (attachedByTest && debuggerApi.isAttached()) debuggerApi.detach();
      throw error;
    }
  }, expression);
}

async function callCommandGate(
  handle: AckLossGateHandle,
  operation: "read" | "release" | "restore",
) {
  return browser.electron.execute(
    async (electron, gateHandle, gateOperation) => {
      const contents = electron.webContents.fromId(gateHandle.webContentsId);
      if (!contents || contents.isDestroyed()) throw new Error("ACK-loss: gate renderer 已销毁");
      const result = (await contents.debugger.sendCommand("Runtime.callFunctionOn", {
        objectId: gateHandle.objectId,
        functionDeclaration: "function (operation) { return this[operation](); }",
        arguments: [{ value: gateOperation }],
        returnByValue: true,
      })) as { result?: { value?: AckLossGateHit | null }; exceptionDetails?: unknown };
      if (result.exceptionDetails)
        throw new Error(
          `ACK-loss: gate ${gateOperation} 失败 ${JSON.stringify(result.exceptionDetails)}`,
        );
      return result.result?.value ?? null;
    },
    handle,
    operation,
  );
}

async function disposeCommandGate(handle: AckLossGateHandle, holdingProxy: HoldingProxy) {
  try {
    await callCommandGate(handle, "restore");
  } finally {
    try {
      await callCommandGate(handle, "release");
    } finally {
      try {
        holdingProxy.release();
      } finally {
        await browser.electron.execute(async (electron, gateHandle) => {
          const contents = electron.webContents.fromId(gateHandle.webContentsId);
          if (!contents || contents.isDestroyed()) return;
          try {
            await contents.debugger.sendCommand("Runtime.releaseObject", {
              objectId: gateHandle.objectId,
            });
          } finally {
            if (gateHandle.attachedByTest && contents.debugger.isAttached())
              contents.debugger.detach();
          }
        }, handle);
      }
    }
  }
}

interface Pair {
  client: Socket;
  upstream: Socket;
  held: Buffer[];
  holding: boolean;
  generation: number;
}

interface HoldingProxy {
  port: number;
  holdCurrent(): number;
  release(): { flushedBytes: number; pairs: number };
  stats(): { pairs: number; heldBytes: number };
  close(): Promise<void>;
}

/** 可按连接代际 hold 上游回包的 SSH TCP 代理：hold 期间上游→Desktop 的字节暂存，release 后一次性冲出。 */
async function createHoldingProxy(target: { host: string; port: number }): Promise<HoldingProxy> {
  const pairs = new Set<Pair>();
  let generation = 0;
  const server: Server = createServer((client) => {
    generation += 1;
    const upstream = createConnection({ host: target.host, port: target.port });
    const pair: Pair = { client, upstream, held: [], holding: false, generation };
    pairs.add(pair);
    const cleanup = () => {
      pairs.delete(pair);
      client.destroy();
      upstream.destroy();
    };
    client.on("data", (chunk) => upstream.write(chunk));
    upstream.on("data", (chunk) => {
      if (pair.holding) pair.held.push(Buffer.from(chunk));
      else client.write(chunk);
    });
    client.once("error", cleanup);
    upstream.once("error", cleanup);
    client.once("close", cleanup);
    upstream.once("close", () => {
      // hold 期间上游关闭也不向 Desktop 传递 FIN，模拟"旧回包/旧 close 迟到"。
      if (!pair.holding) cleanup();
    });
  });
  await new Promise<void>((ok, bad) => {
    server.once("error", bad);
    server.listen(0, "127.0.0.1", () => ok());
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    holdCurrent() {
      let count = 0;
      for (const pair of pairs) {
        pair.holding = true;
        count += 1;
      }
      return count;
    },
    release() {
      let flushed = 0;
      let count = 0;
      for (const pair of pairs) {
        if (!pair.holding) continue;
        count += 1;
        pair.holding = false;
        for (const chunk of pair.held) {
          flushed += chunk.length;
          if (!pair.client.destroyed) pair.client.write(chunk);
        }
        pair.held = [];
        if (pair.upstream.destroyed) {
          pair.client.end();
        }
      }
      return { flushedBytes: flushed, pairs: count };
    },
    stats() {
      let heldBytes = 0;
      for (const pair of pairs) for (const chunk of pair.held) heldBytes += chunk.length;
      return { pairs: pairs.size, heldBytes };
    },
    async close() {
      for (const pair of pairs) {
        pair.client.destroy();
        pair.upstream.destroy();
      }
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

describe(`${CASE_MARKER}: command 已 admitted 但 ACK 经代理丢失后的唯一归属`, () => {
  let provider: SSHLifecycleProvider | null = null;
  let proxy: HoldingProxy | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "ack-loss.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await proxy?.close().catch(() => undefined);
    proxy = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-TASK-07 发送后 ACK 被代理扣住：远端已 admitted 并完成回合；换代恢复后原输入在 transcript 中唯一出现、模型请求唯一、无 silent drop", async function () {
    this.timeout(30 * 60_000);
    const direct = readSSHRuntimeConfig(CASE_MARKER);
    proxy = await createHoldingProxy(direct);
    const proxied: SSHConnectionConfig = {
      host: direct.host,
      password: direct.password,
      port: proxy.port,
      username: direct.username,
    };
    await prepareV4ConversationE2E({ skipProvider: true });
    const initialHosts = await readHostProcesses();
    provider = await createSSHLifecycleProvider(direct, CASE_MARKER, {
      apiType: "anthropic-messages",
      tunnelUsername: "tunnel",
    });
    const [workspaceA] = direct.workspacePaths;
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: proxied,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const core0 = await readRemoteCoreIdentity(direct, CASE_MARKER);
    const messagesBefore = (await getV4Messages()).length;
    const repliesBefore = (await getV4Messages("assistant")).filter((message) =>
      message.text?.includes("R3_ACK_LOSS_REPLY"),
    ).length;

    // XCODE: 先走真实目录 RPC，在原 transport 发出命令前扣 gate，再 hold SSH 回包；提前 hold 会把目录检查也堵住。
    const marker = `${CASE_MARKER}_ACK`;
    await setV4ComposerText(`${marker} 请回复`);
    const requestStart = await getUpstreamRequestRecordCount();
    const gateScope: AckLossGateScope = {
      workspacePath: taskA.workspacePath,
      workspaceIdentity: taskA.identity,
      remoteSessionId: taskA.remoteSessionId,
      sessionId: taskA.taskId,
      marker,
    };
    const commandGate = await installCommandGate(gateScope);
    const faultEvents: string[] = [];
    facts.faultEvents = faultEvents;
    try {
      await clickV4Send();
      // gate 和 admission 共用原 60 秒预算，不能靠扩大超时掩盖目录/发送路径没有走通。
      const admissionDeadline = Date.now() + 60_000;
      await browser.waitUntil(async () => Boolean(await callCommandGate(commandGate, "read")), {
        timeout: Math.max(1, admissionDeadline - Date.now()),
        interval: 100,
        timeoutMsg: `${CASE_MARKER}: 真实 sendText 未通过目录 RPC 到达 transport gate`,
      });
      const gateHit = await callCommandGate(commandGate, "read");
      expect(gateHit).toMatchObject({ ...gateScope, type: "sendText" });
      expect(gateHit?.commandId).toBeTruthy();
      facts.gateHit = gateHit;
      faultEvents.push("directory-rpc-completed; original-sendCommand-not-called; gate-entered");
      const gatedTab = await readRemoteTabSnapshot(taskA.identity);
      expect(gatedTab?.workspaceIdentity).toBe(taskA.identity);
      expect(gatedTab?.remoteSessionId).toBe(taskA.remoteSessionId);
      expect(
        await countUpstreamRequests(
          { lastUserMessageIncludes: [marker] },
          { afterIndex: requestStart - 1 },
        ),
      ).toBe(0);
      const held = proxy.holdCurrent();
      expect(held).toBeGreaterThan(0);
      faultEvents.push("ssh-remote-to-desktop-held");
      await callCommandGate(commandGate, "release");
      faultEvents.push("original-sendCommand-released-with-original-this-and-arguments");
      const admitted = await waitForUpstreamRequest(
        { lastUserMessageIncludes: [marker] },
        `${CASE_MARKER}: 命令没有到达远端（模型请求缺失）`,
        Math.max(1, admissionDeadline - Date.now()),
        { afterIndex: requestStart - 1 },
      )
        .then(() => true)
        .catch(() => false);
      facts.admittedWhileAckHeld = admitted;
      expect(admitted).toBe(true);
      faultEvents.push("original-provider-capture-proved-admission-while-ssh-held");
      // 远端已接受但 ACK 尚未到达时继续编辑，恢复不能用旧发送结果清空后续草稿。
      const laterDraft = `${CASE_MARKER}_LATER_UNSENT_DRAFT`;
      await setV4ComposerText(laterDraft);
      await browser.pause(3_000);
      const duringHold = await getV4ConversationState();
      const composerDuringHold = await browser.execute(
        () =>
          document.querySelector<HTMLElement>('[data-testid="v4-composer-input"]')?.innerText ?? "",
      );
      facts.duringHold = {
        state: duringHold.state,
        composerText: composerDuringHold.slice(0, 80),
        heldBytes: proxy.stats().heldBytes,
      };
      expect(proxy.stats().heldBytes).toBeGreaterThan(0);

      // 传输失活 → 自动换代。
      let regenerated: string | null = null;
      await browser.waitUntil(
        async () => {
          const snapshot = await readRemoteTabSnapshot(taskA.identity).catch(() => null);
          if (snapshot?.remoteSessionId && snapshot.remoteSessionId !== taskA.remoteSessionId) {
            regenerated = snapshot.remoteSessionId;
            return true;
          }
          return false;
        },
        { timeout: 240_000, interval: 1000, timeoutMsg: `${CASE_MARKER}: ACK 丢失后没有自动换代` },
      );
      faultEvents.push("automatic-remote-session-regeneration-observed");
      facts.released = proxy.release();
      faultEvents.push("held-ssh-ack-and-events-released");
      await waitForV4ConversationState(
        (s) => s.taskId === taskA.taskId && s.state === "idle",
        `${CASE_MARKER}: 换代后回合没有收口`,
        180_000,
      );
      await browser.pause(5_000);

      // 归属唯一：用户消息只出现一次、模型请求只有一次、助手回复出现、composer 不残留已发送正文，后续草稿仍保留。
      const userMessages = (await getV4Messages("user")).map((message) => message.text ?? "");
      const occurrences = userMessages.filter((text) => text.includes(marker)).length;
      const replayRecords = await countUpstreamRequests(
        { lastUserMessageIncludes: [marker], excludes: ["Generate a concise title"] },
        { afterIndex: requestStart - 1 },
      );
      const repliesAfter = (await getV4Messages("assistant")).filter((message) =>
        message.text?.includes("R3_ACK_LOSS_REPLY"),
      ).length;
      const composerAfter = await browser.execute(
        () =>
          document.querySelector<HTMLElement>('[data-testid="v4-composer-input"]')?.innerText ?? "",
      );
      facts.afterRecovery = {
        regenerated,
        userMessageOccurrences: occurrences,
        totalMessagesDelta: (await getV4Messages()).length - messagesBefore,
        assistantReplyDelta: repliesAfter - repliesBefore,
        composerText: composerAfter.slice(0, 80),
        matchingCommandModelRequests: replayRecords,
      };
      expect(occurrences).toBe(1);
      expect(repliesAfter - repliesBefore).toBe(1);
      expect(composerAfter.trim()).toBe(laterDraft);
      expect(composerAfter).not.toContain(marker);
      expect(userMessages.some((text) => text.includes(laterDraft))).toBe(false);
      facts.laterDraftPreservedWithoutSending = true;
      expect(await readHostProcesses()).toEqual(initialHosts);
      const core1 = await readRemoteCoreIdentity(direct, CASE_MARKER);
      expect(core1.pid).toBe(core0.pid);
      expect(core1.startTicks).toBe(core0.startTicks);

      expect(replayRecords).toBe(1);
      const remoteStatus = await runSSHCommand(
        direct,
        'tr -d "\\n " < "$HOME/.zcode/server/run/status.json" | cut -c1-120',
      );
      facts.remoteStatus = remoteStatus.stdout.trim();
    } finally {
      await disposeCommandGate(commandGate, proxy);
    }
  });
});
