/**
 * cli-zen-auth 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 * 每个方法注释写清：前置/后置条件、幂等性、发出哪些事件、是否等待持久化。
 */
export interface ZenAuthorizationListener {
  readonly redirectUri: string;
  wait(signal?: AbortSignal): Promise<{ code: string; state: string }>;
  close(): Promise<void>;
}

export interface ZenSecureKeyStore {
  /** 读取失败必须拒绝；仅不存在时返回 null，禁止静默生成替代 key。 */
  read(): Promise<string | null>;
  write(secret: string): Promise<void>;
}

export interface ZenCredentialStore<T> {
  assertAvailable(): Promise<void>;
  read(origin: string): Promise<{ revision: string; value: T } | null>;
  compareAndSwap(origin: string, expectedRevision: string | null, next: T | null): Promise<boolean>;
  /** 跨进程刷新持租约；回调中仍必须使用 CAS 防止迟到覆盖换号。 */
  withLease<R>(origin: string, action: () => Promise<R>): Promise<R>;
}
