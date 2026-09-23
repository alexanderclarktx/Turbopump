import { describe, expect, test } from "bun:test";

const server = await Bun.file("src/server.ts").text();
const transpiler = new Bun.Transpiler({ loader: "ts" });

// Exercise the server's protocol handlers with fake I/O, without opening its database,
// starting background jobs, or launching a real agent.
function serverFunctions(names: string[], bindings: Record<string, unknown>) {
  const declarations = names.map((name) => {
    const match = server.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
    if (!match) throw new Error(`Missing server function ${name}`);
    return match[0];
  }).join("\n");
  return new Function(...Object.keys(bindings), transpiler.transformSync(declarations) + `\nreturn { ${names.join(", ")} };`)(
    ...Object.values(bindings),
  );
}

function runtimeHarness() {
  const runtime = {
    flowId: "flow-1", threadId: "thread-1", activeTurnId: undefined as string | undefined,
    activeTurnTraceAfterLogId: undefined as number | undefined,
    activeTurnTree: undefined as string | undefined,
  };
  const logs: string[] = [];
  const persisted: Array<string | undefined> = [];
  const states: string[] = [];
  const traces: unknown[][] = [];
  const reads: unknown[][] = [];
  let queuedStarts = 0;
  const reply = Promise.withResolvers<{ turn: { id: string } }>();
  const api = serverFunctions(["sendAgentTurn", "handleCodexNotification", "finishInactiveCodexTurn"], {
    sendCodexRequest: () => reply.promise,
    worktreeTree: () => "before-tree",
    codexTurnParams: () => ({}),
    setActiveTurnId: (_flowId: string, id?: string) => { persisted.push(id); },
    getFlow: () => ({ agentModel: "test-model" }),
    insertLog: (_flowId: string, _source: string, message: string) => { logs.push(message); return logs.length; },
    updateFlow: (_flowId: string, update: { agentStatus: string }) => { states.push(update.agentStatus); },
    createCompletedTurnTraceGroupAfterLog: (...args: unknown[]) => { traces.push(args); },
    fileChangesSince: () => ({}),
    worktreeBranchUpdate: () => ({}),
    startNextQueuedAgentMessage: async () => { queuedStarts += 1; },
    reconcileCodexTurn: (...args: unknown[]) => { reads.push(args); return Promise.resolve(); },
  });
  const notify = (method: string, params: Record<string, unknown>) => api.handleCodexNotification(runtime, {
    method, params: { threadId: "thread-1", ...params },
  });
  return { api, runtime, reply, notify, logs, persisted, states, traces, reads, queuedStarts: () => queuedStarts };
}

describe("Codex runtime completion and reconciliation", () => {
  test("a late start reply cannot resurrect a completed turn or its trace state", async () => {
    const h = runtimeHarness();
    const pending = h.api.sendAgentTurn(h.runtime, {}, "hello", 42);
    h.notify("turn/started", { turn: { id: "turn-1" } });
    h.notify("turn/completed", { turn: { id: "turn-1", status: "completed" } });
    h.reply.resolve({ turn: { id: "turn-1" } });
    await pending;
    expect(h.runtime.activeTurnId).toBeUndefined();
    expect(h.runtime.activeTurnTraceAfterLogId).toBeUndefined();
    expect(h.runtime.activeTurnTree).toBeUndefined();
    expect(h.persisted.at(-1)).toBeUndefined();
    expect(h.states.at(-1)).toBe("idle");
    expect(h.traces[0]![1]).toBe(42);
    expect(h.queuedStarts()).toBe(1);
  });

  test("thread status changes alone do not discard a valid start reply", async () => {
    const h = runtimeHarness();
    const pending = h.api.sendAgentTurn(h.runtime, {}, "hello", 42);
    h.notify("thread/status/changed", { status: { type: "active", activeFlags: [] } });
    h.reply.resolve({ turn: { id: "turn-1" } });
    await pending;
    expect(h.runtime.activeTurnId).toBe("turn-1");
    expect(h.persisted.at(-1)).toBe("turn-1");
  });

  test("a completion for a previous turn cannot finish newer work", () => {
    const h = runtimeHarness();
    h.runtime.activeTurnId = "turn-2";
    h.notify("turn/completed", { turn: { id: "turn-1", status: "completed" } });
    expect(h.runtime.activeTurnId).toBe("turn-2");
    expect(h.states).toEqual([]);
    expect(h.logs).toEqual([]);
    expect(h.queuedStarts()).toBe(0);
  });

  test("idle notifications trigger a read only for this runtime's thread", () => {
    const h = runtimeHarness();
    h.runtime.activeTurnId = "turn-1";
    h.notify("thread/status/changed", { threadId: "other", status: { type: "idle" } });
    expect(h.reads).toEqual([]);
    h.notify("thread/status/changed", { status: { type: "idle" } });
    expect(h.reads).toHaveLength(1);
    expect(h.reads[0]![2]).toBe(true);
    expect(h.runtime.activeTurnId).toBe("turn-1");
  });

  test.each(["idle", "notLoaded", "systemError"])("finishes reconciled %s turns and updates clients", (status) => {
    const h = runtimeHarness();
    h.runtime.activeTurnId = "turn-1";
    h.runtime.activeTurnTraceAfterLogId = 42;
    h.runtime.activeTurnTree = "before-tree";
    h.api.finishInactiveCodexTurn(h.runtime, status);
    expect(h.runtime.activeTurnId).toBeUndefined();
    expect(h.runtime.activeTurnTraceAfterLogId).toBeUndefined();
    expect(h.runtime.activeTurnTree).toBeUndefined();
    expect(h.persisted).toEqual([undefined]);
    expect(h.states).toEqual([status === "systemError" ? "failed" : "idle"]);
    expect(h.logs[0]).toContain(`reconciled Codex thread status ${status}`);
    expect(h.traces[0]![1]).toBe(42);
    expect(h.queuedStarts()).toBe(status === "systemError" ? 0 : 1);
  });

  test("status requests time out, remove pending entries, and ignore late replies", async () => {
    const api = serverFunctions(["sendCodexRequest", "resolveCodexResponse"], { writeCodexMessage: () => {} });
    const runtime = { pending: new Map(), requestId: 0 };
    const request = api.sendCodexRequest(runtime, "thread/read", {}, 5);
    await expect(request).rejects.toThrow("thread/read timed out");
    expect(runtime.pending.size).toBe(0);
    expect(api.resolveCodexResponse(runtime, { id: 1, result: { thread: { status: { type: "idle" } } } })).toBe(true);
    const retry = api.sendCodexRequest(runtime, "thread/read", {}, 1000);
    api.resolveCodexResponse(runtime, { id: 2, result: { ok: true } });
    expect(await retry).toEqual({ ok: true });
    expect(runtime.pending.size).toBe(0);
  });
});
