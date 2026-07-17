import {
  AGENT_TRACE_INITIAL_TURN_COUNT,
  AGENT_TRACE_TURN_PAGE_SIZE,
  LOG_PAGE_SIZE,
  LOG_PREFETCH_BATCH_SIZE,
  LOG_PREFETCH_DELAY_MS,
  LOG_PREFETCH_MAX_FLOW_COUNT,
} from "./constants.js";
import { flowForTicket } from "./flows.js";
import { rememberLogHistory } from "./input-history.js";
import { api, wsRequest } from "./net.js";
import { state } from "./state.js";
import { isShellOnlyRenderLog, terminalGroups } from "./terminal-groups.js";
import {
  pauseTerminalFollow,
  renderLogs,
  renderShellOutputPane,
  terminalForFlowLogs,
  terminalTurnCount,
  terminalVisibleTurnCount,
} from "./terminal-render.js";
import { sortedLinearTickets } from "./tickets.js";

const coalescedStreamingSources = new Set(["agent:message", "agent:reasoning", "agent:thinking"]);

export function appendLogEntry(log) {
  const flowId = log.flowId;
  const id = Number(log.id || Date.now());
  const optimisticPrompt = state.optimisticPromptByFlowId.get(flowId);
  if (
    log.source === "user" &&
    optimisticPrompt &&
    String(log.message || "").trim() === optimisticPrompt.message.trim() &&
    Date.parse(log.createdAt || "") >= Date.parse(optimisticPrompt.createdAt)
  ) {
    state.optimisticPromptByFlowId.delete(flowId);
  }
  if (!state.logs.has(flowId)) state.logs.set(flowId, []);
  if (!state.logIds.has(flowId)) {
    state.logIds.set(flowId, new Set((state.logs.get(flowId) || []).map((entry) => Number(entry.id))));
  }
  const list = state.logs.get(flowId);
  const ids = state.logIds.get(flowId);
  if (ids.has(id)) return false;
  const entry = {
    id,
    flowId,
    source: log.source,
    message: log.message,
    createdAt: log.createdAt || new Date().toISOString(),
  };
  const lastEntry = list[list.length - 1];
  if (!lastEntry || Number(lastEntry.id) < id) {
    if (lastEntry && lastEntry.source === entry.source && coalescedStreamingSources.has(entry.source)) {
      lastEntry.message += entry.message;
      lastEntry.lastCreatedAt = entry.createdAt;
    } else {
      list.push(entry);
    }
  } else {
    const insertAt = list.findIndex((item) => Number(item.id) > id);
    list.splice(insertAt === -1 ? list.length : insertAt, 0, entry);
  }
  ids.add(id);
  rememberLogHistory(log);
  state.firstLogId.set(flowId, Math.min(state.firstLogId.get(flowId) || id, id));
  if (state.logBackfilledFlowIds.has(flowId)) {
    state.lastLogId.set(flowId, Math.max(state.lastLogId.get(flowId) || 0, id));
  }
  return true;
}

export async function loadLogs(id, options = {}) {
  if (!state.logs.has(id)) state.logs.set(id, []);
  if (options.resetCursor) resetFlowLogWindow(id);
  const shouldLoadRecent = !state.logBackfilledFlowIds.has(id);
  let cursor = state.lastLogId.get(id) || 0;

  const appendedLogs = [];
  if (shouldLoadRecent) {
    let renderedFirstPage = false;
    while (true) {
      const before = state.firstLogId.get(id) || Number.MAX_SAFE_INTEGER;
      const data = await wsRequest("logs", { flowId: id, before, limit: LOG_PAGE_SIZE });
      for (const log of data.logs) {
        if (appendLogEntry(log)) appendedLogs.push(log);
      }
      rememberLoadedLogBounds(id, data.logs);
      if (!renderedFirstPage && !options.shellOnly && data.logs.length) {
        // Paint the newest page immediately; older pages keep loading behind.
        renderedFirstPage = true;
        renderLogs(id, { ...options, suppressIncoming: true });
      }
      if (data.logs.length < LOG_PAGE_SIZE) {
        state.logOlderCompleteFlowIds.add(id);
        break;
      }
      const flow = state.flows.find((item) => item.id === id) || null;
      const groups = terminalGroups(state.logs.get(id) || [], flow);
      if (terminalTurnCount(groups) >= AGENT_TRACE_INITIAL_TURN_COUNT) break;
    }
    state.logBackfilledFlowIds.add(id);
    state.terminalVisibleTurnCounts.set(id, AGENT_TRACE_INITIAL_TURN_COUNT);
  } else {
    while (true) {
      const data = await wsRequest("logs", { flowId: id, after: cursor, limit: LOG_PAGE_SIZE });
      if (!data.logs.length) break;

      let highestLogId = cursor;
      for (const log of data.logs) {
        highestLogId = Math.max(highestLogId, log.id);
        if (appendLogEntry(log)) appendedLogs.push(log);
      }

      cursor = Math.max(cursor, highestLogId);
      state.lastLogId.set(id, Math.max(state.lastLogId.get(id) || 0, cursor));
      if (data.logs.length < LOG_PAGE_SIZE) break;
    }
  }

  if (options.shellOnly || (appendedLogs.length && appendedLogs.every(isShellOnlyRenderLog))) {
    renderShellOutputPane(id);
    return;
  }
  renderLogs(id, { ...options, suppressIncoming: Boolean(options.suppressIncoming || shouldLoadRecent) });
}

export function resetFlowLogWindow(flowId) {
  state.logs.set(flowId, []);
  state.logIds.set(flowId, new Set());
  state.firstLogId.delete(flowId);
  state.lastLogId.delete(flowId);
  state.logBackfilledFlowIds.delete(flowId);
  state.logOlderCompleteFlowIds.delete(flowId);
  state.logOlderLoadingFlowIds.delete(flowId);
  state.terminalVisibleTurnCounts.delete(flowId);
}

export function rememberLoadedLogBounds(flowId, logs) {
  for (const log of logs) {
    const id = Number(log.id);
    if (!Number.isFinite(id)) continue;
    state.firstLogId.set(flowId, Math.min(state.firstLogId.get(flowId) || id, id));
    state.lastLogId.set(flowId, Math.max(state.lastLogId.get(flowId) || 0, id));
  }
}

export async function loadOlderTerminalTraceMessages(options = {}) {
  const flowId = options.flowId || state.selectedFlowId;
  if (!flowId || state.logOlderLoadingFlowIds.has(flowId)) return;
  const terminal = terminalForFlowLogs(flowId);
  if (!terminal) return;
  const renderOptions = {
    force: true,
    preserveScrollTop: Boolean(options.preserveScrollTop),
    suppressIncoming: true,
  };

  const visibleCount = terminalVisibleTurnCount(flowId);
  state.terminalVisibleTurnCounts.set(flowId, visibleCount + AGENT_TRACE_TURN_PAGE_SIZE);
  pauseTerminalFollow();

  const flow = state.flows.find((item) => item.id === flowId) || null;
  const groups = terminalGroups(state.logs.get(flowId) || [], flow);
  if (terminalTurnCount(groups) > visibleCount || state.logOlderCompleteFlowIds.has(flowId)) {
    renderLogs(flowId, renderOptions);
    return;
  }

  state.logOlderLoadingFlowIds.add(flowId);
  renderLogs(flowId, renderOptions);
  try {
    const before = state.firstLogId.get(flowId) || Number.MAX_SAFE_INTEGER;
    const data = await wsRequest("logs", { flowId, before, limit: LOG_PAGE_SIZE });
    if (!data.logs.length) {
      state.logOlderCompleteFlowIds.add(flowId);
      renderLogs(flowId, renderOptions);
      return;
    }
    for (const log of data.logs) {
      appendLogEntry(log);
    }
    rememberLoadedLogBounds(flowId, data.logs);
    if (data.logs.length < LOG_PAGE_SIZE) state.logOlderCompleteFlowIds.add(flowId);
    renderLogs(flowId, renderOptions);
  } finally {
    state.logOlderLoadingFlowIds.delete(flowId);
    renderLogs(flowId, renderOptions);
  }
}

export function scheduleTicketLogPrefetch() {
  if (state.logPrefetchTimer || !state.linearTicketsLoaded) return;
  if (state.logPrefetchedFlowCount >= LOG_PREFETCH_MAX_FLOW_COUNT) return;
  state.logPrefetchTimer = window.setTimeout(() => {
    state.logPrefetchTimer = 0;
    void prefetchTicketLogs();
  }, LOG_PREFETCH_DELAY_MS);
}

export async function prefetchTicketLogs() {
  const flowIds = [];
  for (const ticket of sortedLinearTickets(state.linearTickets)) {
    const flow = flowForTicket(ticket);
    if (
      !flow?.id ||
      flow.id === state.selectedFlowId ||
      state.logBackfilledFlowIds.has(flow.id) ||
      state.logPrefetchingFlowIds.has(flow.id) ||
      state.logPrefetchFailedFlowIds.has(flow.id)
    ) {
      continue;
    }
    flowIds.push(flow.id);
    if (flowIds.length >= LOG_PREFETCH_BATCH_SIZE) break;
  }
  if (!flowIds.length) return;

  for (const flowId of flowIds) {
    if (state.logBackfilledFlowIds.has(flowId)) continue;
    state.logPrefetchedFlowCount += 1;
    state.logPrefetchingFlowIds.add(flowId);
    try {
      await loadLogs(flowId, { suppressIncoming: true });
    } catch {
      state.logPrefetchFailedFlowIds.add(flowId);
      // Background prefetch should never interrupt foreground ticket work.
    } finally {
      state.logPrefetchingFlowIds.delete(flowId);
    }
  }

  if (
    state.logPrefetchedFlowCount < LOG_PREFETCH_MAX_FLOW_COUNT &&
    sortedLinearTickets(state.linearTickets).some((ticket) => {
      const flow = flowForTicket(ticket);
      return (
        flow?.id &&
        flow.id !== state.selectedFlowId &&
        !state.logBackfilledFlowIds.has(flow.id) &&
        !state.logPrefetchFailedFlowIds.has(flow.id)
      );
    })
  ) {
    scheduleTicketLogPrefetch();
  }
}

export function removeLogEntries(flowId, ids) {
  const idSet = new Set(ids.map(Number));
  state.logs.set(
    flowId,
    (state.logs.get(flowId) || []).filter((log) => !idSet.has(Number(log.id))),
  );
  const knownIds = state.logIds.get(flowId);
  if (knownIds) {
    for (const id of idSet) knownIds.delete(id);
  }
}

export async function deleteOutputLogGroup(flowId, ids) {
  if (!flowId || !ids?.length || ids.some((id) => state.deletingOutputLogIds.has(id))) return;
  for (const id of ids) state.deletingOutputLogIds.add(id);
  renderLogs(flowId, { force: true });
  try {
    const data = await api(`/api/flows/${encodeURIComponent(flowId)}/logs`, {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    });
    removeLogEntries(flowId, data.ids || ids);
    renderLogs(flowId, { force: true });
  } catch (error) {
    alert(error.message);
  } finally {
    for (const id of ids) state.deletingOutputLogIds.delete(id);
    renderLogs(flowId, { force: true });
  }
}
