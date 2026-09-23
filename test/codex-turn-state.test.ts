import { describe, expect, test } from "bun:test";
import { createCodexTurnReconciler, type CodexTurnState, type InactiveCodexStatus } from "../src/codex-turn-state";

function harness() {
  const runtime: CodexTurnState = { threadId: "thread-1", activeTurnId: "turn-1", turnStateVersion: 1 };
  const inactive: InactiveCodexStatus[] = [];
  let current = runtime;
  let status = "idle";
  let reads = 0;
  let fail = false;
  let readGate: Promise<void> = Promise.resolve();
  const reconcile = createCodexTurnReconciler<CodexTurnState>({
    intervalMs: 5000,
    isCurrent: (candidate) => current === candidate,
    readThread: async (_runtime, threadId) => {
      reads += 1;
      const snapshot = { thread: { id: threadId, status: { type: status } } };
      await readGate;
      if (fail) throw new Error("thread/read unavailable");
      return snapshot;
    },
    onInactive: (candidate, state) => {
      inactive.push(state);
      candidate.activeTurnId = undefined;
    },
  });
  return {
    runtime, inactive, reconcile,
    reads: () => reads,
    status: (value: string) => { status = value; },
    fail: (value: boolean) => { fail = value; },
    replace: () => { current = { ...runtime }; },
    pause: () => {
      const gate = Promise.withResolvers<void>();
      readGate = gate.promise;
      return gate.resolve;
    },
  };
}

describe("server Codex turn reconciliation", () => {
  test.each(["idle", "notLoaded", "systemError"])("clears a stale active turn when Codex reports %s", async (status) => {
    const h = harness();
    h.status(status);
    await h.reconcile(h.runtime, 0);
    expect(h.inactive).toEqual([status]);
    expect(h.runtime.activeTurnId).toBeUndefined();
    await h.reconcile(h.runtime, 5000);
    expect(h.reads()).toBe(1);
  });

  test.each(["active", "unknown", ""])("does not mistake %s for an inactive turn", async (status) => {
    const h = harness();
    h.status(status);
    await h.reconcile(h.runtime, 0);
    expect(h.runtime.activeTurnId).toBe("turn-1");
    expect(h.inactive).toEqual([]);
  });

  test("checks quiet turns repeatedly and rate-limits foreground snapshots", async () => {
    const h = harness();
    h.status("active");
    await h.reconcile(h.runtime, 0);
    await h.reconcile(h.runtime, 4999);
    expect(h.reads()).toBe(1);
    h.status("idle");
    await h.reconcile(h.runtime, 5000);
    expect(h.reads()).toBe(2);
    expect(h.inactive).toEqual(["idle"]);
  });

  test("a status notification can trigger an immediate read", async () => {
    const h = harness();
    h.status("active");
    await h.reconcile(h.runtime, 0);
    h.status("idle");
    await h.reconcile(h.runtime, 1, true);
    expect(h.inactive).toEqual(["idle"]);
  });

  test("deduplicates overlapping heartbeat and notification reads", async () => {
    const h = harness();
    const resume = h.pause();
    const first = h.reconcile(h.runtime, 0);
    const second = h.reconcile(h.runtime, 10000, true);
    expect(first).toBe(second);
    resume();
    await first;
    expect(h.reads()).toBe(1);
    expect(h.inactive).toEqual(["idle"]);
  });

  test.each(["new turn", "new thread", "new activity", "completion", "replacement", "compaction", "pending start"])(
    "ignores a stale idle reply after %s", async (change) => {
      const h = harness();
      const resume = h.pause();
      const pending = h.reconcile(h.runtime, 0);
      await Promise.resolve();
      if (change === "new turn") h.runtime.activeTurnId = "turn-2";
      if (change === "new thread") h.runtime.threadId = "thread-2";
      if (change === "new activity") h.runtime.turnStateVersion = 2;
      if (change === "completion") h.runtime.activeTurnId = undefined;
      if (change === "replacement") h.replace();
      if (change === "compaction") h.runtime.compacting = true;
      if (change === "pending start") h.runtime.pending = new Map([[1, { method: "turn/start" }]]);
      resume();
      await pending;
      expect(h.inactive).toEqual([]);
    },
  );

  test("retries failed or timed-out reads without marking a turn idle", async () => {
    const h = harness();
    h.fail(true);
    await h.reconcile(h.runtime, 0);
    expect(h.inactive).toEqual([]);
    expect(h.runtime.activeTurnId).toBe("turn-1");
    h.fail(false);
    await h.reconcile(h.runtime, 5000);
    expect(h.inactive).toEqual(["idle"]);
  });

  test.each<CodexTurnState>([
    { provider: "claude" }, { claude: {} }, { compacting: true }, { stopping: true },
    { threadId: undefined }, { activeTurnId: undefined },
    ...["turn/start", "turn/steer", "turn/interrupt", "thread/resume", "thread/compact/start"].map(
      (method) => ({ pending: new Map([[1, { method }]]) }),
    ),
  ])("skips runtimes that cannot be reconciled: %j", async (overrides) => {
    const h = harness();
    Object.assign(h.runtime, overrides);
    await h.reconcile(h.runtime, 0);
    expect(h.reads()).toBe(0);
    expect(h.inactive).toEqual([]);
  });
});
