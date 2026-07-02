import { renderCheckouts, setCheckouts } from "./checkouts.js";
import { loadFlowDiff } from "./diff.js";
import {
  githubCiOnlyFlowChanges,
  renderAgentContext,
  renderFlowPane,
  runtimeOnlyFlowChanges,
  selectedFlow,
  setFlows,
  tokenUsageOnlyFlowChanges,
  upsertFlow,
} from "./flows.js";
import { appendLogEntry, loadLogs, removeLogEntries } from "./logs.js";
import { notifyAgentTurnEnded, refreshFlowDiffAfterAgentTurn } from "./notifications.js";
import { render } from "./render.js";
import { state } from "./state.js";
import { isAgentTurnEndedLog, isShellOnlyRenderLog } from "./terminal-groups.js";
import { renderLogs, renderShellOutputPane, scheduleLogRender, scheduleShellOutputRender } from "./terminal-render.js";
import { renderTickets } from "./tickets.js";

export let realtimeWs = null;

export let realtimeWsOpenPromise = null;

export let wsRequestId = 0;

export const pendingWsRequests = new Map();

export const flowSnapshotRequestingIds = new Set();

export async function api(path, options = {}) {
  const headers = options.body instanceof FormData
    ? options.headers || {}
    : {
        "content-type": "application/json",
        ...(options.headers || {}),
      };
  const response = await fetch(path, {
    ...options,
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || response.statusText);
    error.status = response.status;
    throw error;
  }
  return body;
}

export function isGitCloneError(error) {
  return /\bgit clone failed\b/i.test(error?.message || "");
}

export function requestFlowSnapshot(flowId) {
  if (!flowId || flowSnapshotRequestingIds.has(flowId)) return;
  flowSnapshotRequestingIds.add(flowId);
  void wsRequest("flow", { flowId }).then((data) => {
    if (data.flow) upsertFlow(data.flow);
  }).catch(() => {}).finally(() => {
    flowSnapshotRequestingIds.delete(flowId);
  });
}

export function rejectPendingWsRequests(error) {
  for (const pending of pendingWsRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  pendingWsRequests.clear();
}

export function handleWsResponse(message) {
  const pending = pendingWsRequests.get(message.requestId);
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingWsRequests.delete(message.requestId);
  if (message.error) pending.reject(new Error(message.error));
  else pending.resolve(message.payload || {});
  return true;
}

export function ensureWs() {
  if (realtimeWs?.readyState === WebSocket.OPEN) return Promise.resolve(realtimeWs);
  if (realtimeWs?.readyState === WebSocket.CONNECTING && realtimeWsOpenPromise) return realtimeWsOpenPromise;
  return connectWs();
}

export function wsRequest(method, params = {}) {
  return ensureWs().then((ws) => {
    const id = ++wsRequestId;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingWsRequests.delete(id);
        reject(new Error("WebSocket request timed out."));
      }, 10000);
      pendingWsRequests.set(id, { resolve, reject, timeout });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        pendingWsRequests.delete(id);
        reject(error);
      }
    });
  });
}

export function connectWs() {
  if (realtimeWs?.readyState === WebSocket.OPEN) return Promise.resolve(realtimeWs);
  if (realtimeWs?.readyState === WebSocket.CONNECTING && realtimeWsOpenPromise) return realtimeWsOpenPromise;

  const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
  realtimeWs = ws;
  realtimeWsOpenPromise = new Promise((resolve, reject) => {
    let settled = false;
    ws.addEventListener("open", () => {
      settled = true;
      resolve(ws);
      const flow = selectedFlow();
      if (flow) {
        requestFlowSnapshot(flow.id);
        // Reload the full recent window: rows already fetched can be compacted
        // (merged into earlier ids) server-side while this client is offline.
        void loadLogs(flow.id, { resetCursor: true });
      }
    }, { once: true });
    ws.addEventListener("error", () => {
      if (!settled) reject(new Error("WebSocket connection failed."));
    }, { once: true });
    ws.addEventListener("close", () => {
      if (!settled) reject(new Error("WebSocket disconnected."));
    }, { once: true });
  });

  ws.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.event === "response" && handleWsResponse(message)) return;
    if (message.event === "flows") {
      const previousFlows = state.flows;
      setFlows(message.payload);
      if (runtimeOnlyFlowChanges(previousFlows, state.flows)) {
        renderTickets();
        const flow = selectedFlow();
        if (flow) scheduleLogRender(flow.id, { force: true });
        return;
      }
      if (tokenUsageOnlyFlowChanges(previousFlows, state.flows)) {
        renderAgentContext(selectedFlow());
        return;
      }
      if (githubCiOnlyFlowChanges(previousFlows, state.flows)) {
        renderFlowPane();
        return;
      }
      render();
      const flow = selectedFlow();
      if (flow) void loadFlowDiff(flow.id, { force: true });
      if (flow) await loadLogs(flow.id);
    }
    if (message.event === "checkouts") {
      setCheckouts(message.payload);
      state.checkoutsLoaded = true;
      renderCheckouts();
    }
    if (message.event === "log") {
      const log = {
        id: message.payload.id,
        flowId: message.payload.flowId,
        source: message.payload.source,
        message: message.payload.message,
        createdAt: message.payload.createdAt,
      };
      appendLogEntry(log);
      if (isAgentTurnEndedLog(log)) {
        refreshFlowDiffAfterAgentTurn(log.flowId);
        notifyAgentTurnEnded(log.flowId);
      }
      if (isShellOnlyRenderLog(log)) {
        scheduleShellOutputRender(log.flowId);
        return;
      }
      const shouldScrollToSubmittedPrompt =
        log.flowId === state.selectedFlowId &&
        state.messageSubmitting &&
        log.flowId === state.messageSubmittingFlowId &&
        (log.source === "user" || log.source === "user:queued");
      scheduleLogRender(log.flowId, shouldScrollToSubmittedPrompt ? { scrollToLatest: true } : {});
    }
    if (message.event === "logs-deleted") {
      removeLogEntries(message.payload.flowId, message.payload.ids || []);
      renderLogs(message.payload.flowId, { force: true });
    }
    if (message.event === "shell-output-cleared") {
      const flowId = message.payload.flowId;
      const clearAfterLogId = Number(message.payload.clearAfterLogId || 0);
      if (flowId && Number.isFinite(clearAfterLogId)) {
        state.shellOutputClearAfterLogId.set(flowId, clearAfterLogId);
        renderShellOutputPane(flowId);
      }
    }
  });
  ws.addEventListener("close", () => {
    if (realtimeWs === ws) realtimeWs = null;
    realtimeWsOpenPromise = null;
    rejectPendingWsRequests(new Error("WebSocket disconnected."));
    setTimeout(() => void connectWs().catch(() => {}), 1000);
  });
  return realtimeWsOpenPromise;
}
