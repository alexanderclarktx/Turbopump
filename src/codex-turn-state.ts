export type CodexTurnState = {
  threadId?: string;
  activeTurnId?: string;
  turnStateVersion?: number;
  compacting?: boolean;
  stopping?: boolean;
  provider?: string;
  claude?: unknown;
  pending?: ReadonlyMap<number, { method: string }>;
};

export type InactiveCodexStatus = "idle" | "notLoaded" | "systemError";
type ThreadSnapshot = { thread?: { id?: string; status?: { type?: string } } };

export function createCodexTurnReconciler<Runtime extends CodexTurnState>(options: {
  intervalMs: number;
  readThread: (runtime: Runtime, threadId: string) => Promise<ThreadSnapshot>;
  isCurrent: (runtime: Runtime) => boolean;
  onInactive: (runtime: Runtime, status: InactiveCodexStatus) => void;
}) {
  const checks = new WeakMap<Runtime, { checkedAt: number; pending?: Promise<void> }>();
  const canCheck = (runtime: Runtime) => Boolean(
    runtime.threadId && runtime.activeTurnId && !runtime.compacting && !runtime.stopping &&
    !runtime.claude && runtime.provider !== "claude" && options.isCurrent(runtime) &&
    ![...runtime.pending?.values() ?? []].some(({ method }) =>
      method.startsWith("turn/") || method === "thread/resume" || method === "thread/compact/start"),
  );

  return function reconcile(runtime: Runtime, nowMs = Date.now(), force = false): Promise<void> {
    if (!canCheck(runtime)) return Promise.resolve();
    const previous = checks.get(runtime);
    if (previous?.pending) return previous.pending;
    if (!force && previous && nowMs - previous.checkedAt < options.intervalMs) return Promise.resolve();

    const threadId = runtime.threadId!;
    const turnId = runtime.activeTurnId;
    const version = runtime.turnStateVersion;
    const check = { checkedAt: nowMs, pending: undefined as Promise<void> | undefined };
    checks.set(runtime, check);
    check.pending = Promise.resolve().then(async () => {
      try {
        const { thread } = await options.readThread(runtime, threadId);
        // A reply about an older turn must never clear newer work or a replaced runtime.
        if (!canCheck(runtime) || runtime.threadId !== threadId || runtime.activeTurnId !== turnId ||
            runtime.turnStateVersion !== version || thread?.id !== threadId) return;
        const status = thread.status?.type;
        if (status === "idle" || status === "notLoaded" || status === "systemError") {
          options.onInactive(runtime, status);
        }
      } catch {
        // Silence, transport errors, and older protocols are not evidence of an idle turn.
        // A later heartbeat retries the read; the caller bounds its request duration.
      } finally {
        check.pending = undefined;
      }
    });
    return check.pending;
  };
}
