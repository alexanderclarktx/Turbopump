import { flowAgentRunning, flowShellRunning } from "./flows.js";
import { activeAgentProviderKind } from "./slash-commands.js";
import { state } from "./state.js";
import { formatTerminalMessage } from "./terminal-render.js";

export function logMeta(source) {
  const userLabel = state.linearViewer?.name || state.linearViewerName || "user";
  const agentLabel = activeAgentProviderKind();
  if (source === "user:queued") return { label: userLabel, marker: "o", tone: "user" };
  const map = {
    user: { label: userLabel, marker: ">", tone: "user" },
    "agent:message": { label: agentLabel, marker: ">", tone: "assistant" },
    agent: { label: agentLabel, marker: ">", tone: "assistant" },
    "agent:thinking": { label: "thinking", marker: "...", tone: "thinking" },
    "agent:reasoning": { label: "thinking", marker: "...", tone: "thinking" },
    "agent:tool": { label: "exec", marker: "$", tone: "tool" },
    "agent:tool-result": { label: "exec", marker: "ok", tone: "toolResult" },
    "agent:output": { label: "output", marker: "|", tone: "output" },
    "agent:cmd": { label: "output", marker: "|", tone: "output" },
    "agent:trace-group": { label: "trace", marker: ">", tone: "trace" },
    "agent:status": { label: "status", marker: "*", tone: "status" },
    "agent:error": { label: "error", marker: "!", tone: "error" },
    "agent:stderr": { label: "stderr", marker: "!", tone: "error" },
    "agent:approval": { label: "approval", marker: "?", tone: "warning" },
    "agent:input": { label: "input", marker: "?", tone: "warning" },
    "agent:protocol": { label: "protocol", marker: "!", tone: "warning" },
    "shell:command": { label: "shell", marker: "$", tone: "shell" },
    "shell:output": { label: "output", marker: "|", tone: "output" },
    "shell:stderr": { label: "stderr", marker: "!", tone: "error" },
    "shell:status": { label: "status", marker: "*", tone: "status" },
    "shell:result": { label: "shell", marker: "ok", tone: "toolResult" },
    flow: { label: "flow", marker: "*", tone: "status" },
    linear: { label: "linear", marker: "*", tone: "status" },
    serve: { label: "serve", marker: "$", tone: "tool" },
    "serve:stderr": { label: "serve", marker: "!", tone: "error" },
  };
  return map[source] || { label: source || "log", marker: "*", tone: "status" };
}

export function normalizeTerminalLog(log) {
  const message = String(log.message || "");
  if (log.source === "user" && message.trimStart().startsWith("$ ")) {
    return { ...log, source: "shell:command", message: message.trimStart().slice(2).trim() };
  }
  if (log.source === "agent" && message.startsWith("$ ")) {
    return { ...log, source: "agent:tool", message: message.slice(2) };
  }
  return { ...log, message };
}

export function isStreamingSource(source) {
  return [
    "agent:message",
    "agent:thinking",
    "agent:reasoning",
    "agent:output",
    "agent:cmd",
    "shell:output",
    "shell:stderr",
    "agent",
    "serve",
    "serve:stderr",
  ].includes(source);
}

export function isLiveAgentTextSource(source) {
  return ["agent", "agent:message", "agent:thinking", "agent:reasoning"].includes(source);
}

export function isAgentMessageSource(source) {
  return source === "agent" || source === "agent:message";
}

export function isAgentMessageBoundarySource(source) {
  return source === "agent:message-boundary";
}

export function isUserLogSource(source) {
  return source === "user" || source === "user:queued";
}

export function isSubmittedUserLogSource(source) {
  return source === "user";
}

export function parseTraceGroup(log) {
  if (log.source !== "agent:trace-group" && log.source !== "shell:trace-group") return null;
  try {
    const payload = JSON.parse(String(log.message || "{}"));
    const afterId = Number(payload.afterId);
    const beforeId = Number(payload.beforeId);
    if (!Number.isFinite(afterId) || !Number.isFinite(beforeId) || beforeId <= afterId) return null;
    const count = Number(payload.count || 0);
    if (count <= 1) return null;
    return {
      afterId,
      beforeId,
      count,
      kind: typeof payload.kind === "string" ? payload.kind : "",
      key: `${afterId}:${beforeId}`,
    };
  } catch {
    return null;
  }
}

export function isAgentTurnEndedLog(log) {
  return (
    log.source === "agent:status" &&
    /^turn (completed|failed|canceled|cancelled|interrupted|stopped)\b/.test(String(log.message || "").trim())
  );
}

export function isShellExitLog(log) {
  return isShellResultLog(log) || isLegacyShellExitLog(log);
}

export function isShellResultLog(log) {
  return log.source === "shell:result" && /^(completed|interrupted|failed) exit \d+\b/.test(String(log.message || "").trim());
}

export function isLegacyShellExitLog(log) {
  return (
    log.source === "agent:tool-result" && /^(completed|interrupted|failed) exit \d+\b/.test(String(log.message || "").trim())
  );
}

export function isRoutineShellExitLog(log) {
  return (log.source === "shell:result" || log.source === "agent:tool-result") && String(log.message || "").trim() === "completed exit 0";
}

export function syntheticCompletedTurnTraceRanges(logs, existingRanges) {
  const existingKeys = new Set(existingRanges.map((range) => range.key));
  const ranges = [];
  let latestUserLog = null;
  for (let index = 0; index < logs.length; index += 1) {
    const log = logs[index];
    if (log.source === "user") {
      latestUserLog = log;
      continue;
    }
    if (!latestUserLog || !isAgentTurnEndedLog(log)) continue;
    const afterId = Number(latestUserLog.id);
    let beforeId = Number(log.id) + 1;
    for (let nextIndex = index + 1; nextIndex < logs.length; nextIndex += 1) {
      const nextLog = logs[nextIndex];
      if (isSubmittedUserLogSource(nextLog.source)) break;
      if (isTraceGroupSource(nextLog.source)) continue;
      if (!isAgentMessageSource(nextLog.source)) continue;
      beforeId = Number(nextLog.id) + 1;
      for (let messageIndex = nextIndex + 1; messageIndex < logs.length; messageIndex += 1) {
        const messageLog = logs[messageIndex];
        if (!isAgentMessageSource(messageLog.source)) break;
        beforeId = Number(messageLog.id) + 1;
      }
      break;
    }
    const key = `${afterId}:${beforeId}`;
    if (!Number.isFinite(afterId) || !Number.isFinite(beforeId) || beforeId <= afterId || existingKeys.has(key)) continue;
    const count = traceRangeLogCount(logs, afterId, beforeId);
    if (count <= 1) continue;
    ranges.push({ afterId, beforeId, count, key });
    existingKeys.add(key);
  }
  return ranges;
}

export function traceRangeHasAgentTurnEnd(logs, range) {
  return logs.some((log) => log.id > range.afterId && log.id < range.beforeId && isAgentTurnEndedLog(log));
}

export function traceRangeForLog(log, ranges) {
  return ranges.find((range) => log.id > range.afterId && log.id < range.beforeId) || null;
}

export function isTraceGroupSource(source) {
  return source === "agent:trace-group" || source === "shell:trace-group";
}

export function isStructuralTerminalSource(source) {
  return isTraceGroupSource(source) || isAgentMessageBoundarySource(source);
}

export function isTraceContentLog(log) {
  return !isStructuralTerminalSource(log.source) && log.source !== "user:queued";
}

export function traceRangeLogCount(logs, afterId, beforeId) {
  return logs.filter((log) => log.id > afterId && log.id < beforeId && isTraceContentLog(log)).length;
}

export function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function logIdsHaveRangeEntry(ids, afterId, beforeId) {
  return lowerBound(ids, beforeId) > upperBound(ids, afterId);
}

export function traceRangeLogCounter(logs) {
  const ids = logs
    .filter(isTraceContentLog)
    .map((log) => Number(log.id))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return (afterId, beforeId) => lowerBound(ids, beforeId) - upperBound(ids, afterId);
}

export function sortedTraceRanges(ranges) {
  return [...ranges].sort((a, b) => a.afterId - b.afterId || a.beforeId - b.beforeId);
}

export function addSanitizedTraceRange(result, seen, logs, range, afterId, beforeId, countRange = traceRangeLogCounter(logs)) {
  const key = `${afterId}:${beforeId}`;
  if (seen.has(key)) return;
  const count = countRange(afterId, beforeId);
  if (count <= 1) return;
  result.push({ ...range, afterId, beforeId, key, count });
  seen.add(key);
}

export function finalResponseStartIdForTrace(range, rangeLogs) {
  let finalResponseIndex = -1;
  for (let index = rangeLogs.length - 1; index >= 0; index -= 1) {
    if (isAgentMessageSource(rangeLogs[index].source)) {
      finalResponseIndex = index;
      break;
    }
  }
  if (finalResponseIndex < 0) return range.beforeId;

  let finalResponseStartIndex = finalResponseIndex;
  for (let index = finalResponseIndex - 1; index >= 0; index -= 1) {
    if (!isAgentMessageSource(rangeLogs[index].source)) break;
    finalResponseStartIndex = index;
  }
  return rangeLogs[finalResponseStartIndex].id;
}

export function traceRangeShouldIncludeUserLogs(range, rangeLogs) {
  if (range.kind === "compact") return true;
  if (range.kind === "shell") return false;
  return rangeLogs.some((log) => isSubmittedUserLogSource(log.source)) && rangeLogs.some((log) => isAgentTurnEndedLog(log));
}

export function sanitizeTraceRanges(logs, ranges) {
  const result = [];
  const seen = new Set();
  const countRange = traceRangeLogCounter(logs);
  for (const range of ranges) {
    const rangeLogs = logs.filter((log) => log.id > range.afterId && log.id < range.beforeId && !isTraceGroupSource(log.source));
    const beforeId = finalResponseStartIdForTrace(range, rangeLogs);
    const includeUserLogs = traceRangeShouldIncludeUserLogs(range, rangeLogs);
    if (includeUserLogs) {
      addSanitizedTraceRange(result, seen, logs, { ...range, includeUserLogs }, range.afterId, beforeId, countRange);
      continue;
    }
    let segmentAfterId = range.afterId;
    for (const log of rangeLogs) {
      if (log.id >= beforeId) break;
      if (!isSubmittedUserLogSource(log.source)) continue;
      addSanitizedTraceRange(result, seen, logs, range, segmentAfterId, log.id, countRange);
      segmentAfterId = log.id;
    }
    addSanitizedTraceRange(result, seen, logs, range, segmentAfterId, beforeId, countRange);
  }
  return result;
}

export function appendTerminalGroup(groups, log, options = {}) {
  const previous = groups[groups.length - 1];
  if (!options.forceNew && previous && previous.source === log.source && isStreamingSource(log.source)) {
    previous.message += log.message;
    previous.lastAt = log.lastCreatedAt || log.createdAt;
    previous.logIds.push(log.id);
    return previous;
  }
  const group = {
    id: log.id,
    logIds: [log.id],
    flowId: log.flowId,
    source: log.source,
    message: log.message,
    createdAt: log.createdAt,
    lastAt: log.lastCreatedAt || log.createdAt,
    boundaryBefore: Boolean(options.forceNew),
  };
  groups.push(group);
  return group;
}

export function flattenSingleChildTraceGroups(groups) {
  const result = [];
  for (const group of groups) {
    if (group.source === "agent:trace-group") {
      const children = group.children || [];
      if (children.length <= 1) {
        result.push(...children);
        continue;
      }
    }
    result.push(group);
  }
  return result;
}

export function mergeAdjacentStreamingGroups(groups) {
  const result = [];
  for (const group of groups) {
    const previous = result[result.length - 1];
    if (previous && !group.boundaryBefore && previous.source === group.source && isStreamingSource(group.source)) {
      previous.message += group.message;
      previous.lastAt = group.lastAt;
      previous.logIds.push(...(group.logIds || [group.id]));
      continue;
    }
    result.push(group);
  }
  return result;
}

export function latestTerminalContentGroup(groups) {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group.source === "agent:trace-group") {
      const child = latestTerminalContentGroup(group.children || []);
      if (child) return child;
      continue;
    }
    return group;
  }
  return null;
}

export function terminalContentGroups(groups, result = []) {
  for (const group of groups || []) {
    if (group.source === "agent:trace-group") terminalContentGroups(group.children || [], result);
    else result.push(group);
  }
  return result;
}

export function markPendingTerminalTurnGroups(groups, flow) {
  if (!flowAgentRunning(flow) || state.messageSubmittingFlowId === flow?.id) return groups;
  const contentGroups = terminalContentGroups(groups);
  let lastUserIndex = -1;
  for (let index = 0; index < contentGroups.length; index += 1) {
    if (isSubmittedUserLogSource(contentGroups[index].source)) lastUserIndex = index;
  }
  if (lastUserIndex < 0) return groups;
  for (let index = lastUserIndex + 1; index < contentGroups.length; index += 1) {
    if (isLiveAgentTextSource(contentGroups[index].source)) contentGroups[index].turnPending = true;
  }
  return groups;
}

export function markLiveTerminalGroup(groups, flow) {
  if (!flowAgentRunning(flow) || state.messageSubmittingFlowId === flow?.id) return groups;
  const group = latestTerminalContentGroup(groups);
  if (group && isLiveAgentTextSource(group.source)) group.liveStreaming = true;
  return groups;
}

export function plainTerminalText(message) {
  return String(message || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\[(\d{1,3}(?:;\d{1,3})*)m/g, "");
}

export function isNoisyAgentStderr(message) {
  return /ERROR\s+rmcp::transport::worker:\s+worker quit with fatal:\s+Transport channel closed\b/.test(
    plainTerminalText(message),
  );
}

export function isHiddenTerminalLog(log) {
  if (isAgentMessageBoundarySource(log.source)) return true;
  const message = String(log.message || "").trim();
  if (log.source === "agent:tool-result" && message === "completed") return true;
  if (log.source === "agent:tool-result" && message === "completed exit 0") return true;
  if (log.source === "agent:tool-result" && message === "failed exit 7") return true;
  if (log.source === "agent:stderr" && isNoisyAgentStderr(message)) return true;
  return (
    log.source === "agent:status" &&
    (/^turn started\b/.test(message) ||
      /^turn completed\b/.test(message) ||
      /^interrupt requested\b/.test(message) ||
      /^[$]\s*codex app-server --listen stdio:\/\/$/i.test(message) ||
      /^Codex thread \S+ ready$/i.test(message) ||
      /^(starting|resuming) Claude session\b/i.test(message) ||
      /^Claude session \S* ?ready$/i.test(message))
  );
}

export function terminalGroups(logs, flow) {
  const groups = [];
  const normalizedLogs = agentPaneLogs(logs, flow);
  const agentTurnEndIds = normalizedLogs
    .filter(isAgentTurnEndedLog)
    .map((log) => Number(log.id))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const persistedTraceRanges = normalizedLogs
    .map((log) => parseTraceGroup(log))
    .filter((range) => range && range.kind !== "shell" && (range.kind || logIdsHaveRangeEntry(agentTurnEndIds, range.afterId, range.beforeId)));
  const completedTurnTraceRanges = syntheticCompletedTurnTraceRanges(normalizedLogs, persistedTraceRanges);
  const traceRanges = sortedTraceRanges(
    sanitizeTraceRanges(normalizedLogs, [
      ...completedTurnTraceRanges,
      ...persistedTraceRanges,
    ]),
  );
  const traceGroups = new Map();
  let forceTerminalGroupBoundary = false;
  let traceRangeIndex = 0;
  for (const log of normalizedLogs) {
    if (log.source === "agent:trace-group") continue;
    if (isAgentMessageBoundarySource(log.source)) {
      forceTerminalGroupBoundary = true;
      continue;
    }
    const previousGroup = groups[groups.length - 1];
    if (
      log.source === "agent:tool" &&
      previousGroup?.source === "shell:command" &&
      formatTerminalMessage(log.source, log.message) === formatTerminalMessage(previousGroup.source, previousGroup.message)
    ) {
      continue;
    }
    const logId = Number(log.id);
    while (traceRanges[traceRangeIndex] && traceRanges[traceRangeIndex].beforeId <= logId) traceRangeIndex += 1;
    const currentTraceRange = traceRanges[traceRangeIndex];
    const traceRange =
      currentTraceRange && logId > currentTraceRange.afterId && logId < currentTraceRange.beforeId ? currentTraceRange : null;
    if (isHiddenTerminalLog(log)) continue;
    if (traceRange && log.source !== "user:queued" && (!isSubmittedUserLogSource(log.source) || traceRange.includeUserLogs)) {
      let traceGroup = traceGroups.get(traceRange.key);
      if (!traceGroup) {
        traceGroup = {
          id: log.id,
          traceKey: traceRange.key,
          flowId: log.flowId,
          source: "agent:trace-group",
          message: "",
          createdAt: log.createdAt,
          lastAt: log.createdAt,
          traceAfterId: traceRange.afterId,
          traceKind: traceRange.kind,
          defaultOpen: false,
          children: [],
        };
        traceGroups.set(traceRange.key, traceGroup);
        groups.push(traceGroup);
      }
      appendTerminalGroup(traceGroup.children, log, { forceNew: forceTerminalGroupBoundary });
      forceTerminalGroupBoundary = false;
      traceGroup.lastAt = log.createdAt;
      continue;
    }
    appendTerminalGroup(groups, log, { forceNew: forceTerminalGroupBoundary });
    forceTerminalGroupBoundary = false;
  }
  const visibleGroups = mergeAdjacentStreamingGroups(flattenSingleChildTraceGroups(groups));
  markPendingTerminalTurnGroups(visibleGroups, flow);
  markLiveTerminalGroup(visibleGroups, flow);
  return visibleGroups;
}

export function agentPaneLogs(logs, flow) {
  const result = [];
  let activeShellCommand = null;
  const latestShellCommandId = latestShellCommandLogId(logs);
  const shellRunning = flowShellRunning(flow);
  for (const rawLog of logs) {
    const log = normalizeTerminalLog(rawLog);
    if (log.source === "shell:command") {
      activeShellCommand = log;
      continue;
    }
    if (isShellTraceGroupLog(log)) continue;
    if (isShellOwnedLog(log)) continue;
    if (activeShellCommand && isShellPaneLog(log, activeShellCommand)) {
      if (isShellExitLog(log) && (!shellRunning || Number(activeShellCommand.id) !== latestShellCommandId)) activeShellCommand = null;
      continue;
    }
    result.push(log);
  }
  return result;
}

export function isShellPaneLog(log, command) {
  if (isShellOwnedLog(log)) return true;
  if (isShellExitLog(log)) return true;
  if (isLegacyShellOutputLog(log)) return true;
  return (
    log.source === "agent:tool" &&
    formatTerminalMessage(log.source, log.message) === formatTerminalMessage(command.source, command.message)
  );
}

export function latestShellCommandLogId(logs) {
  let id = 0;
  for (const log of logs) {
    const normalized = normalizeTerminalLog(log);
    if (normalized.source !== "shell:command") continue;
    const logId = Number(normalized.id);
    if (Number.isFinite(logId) && logId > id) id = logId;
  }
  return id;
}

export function isShellOwnedLog(log) {
  return String(log.source || "").startsWith("shell:") && log.source !== "shell:command";
}

export function isLegacyShellOutputLog(log) {
  if (log.source === "agent:cmd" || log.source === "agent:stderr") return true;
  return log.source === "agent:status" && /^shell interrupt (requested|escalated|forced cleanup)\b/.test(String(log.message || "").trim());
}

export function isShellTraceGroupLog(log) {
  if (log.source === "shell:trace-group") return true;
  if (log.source !== "agent:trace-group") return false;
  return parseTraceGroup(log)?.kind === "shell";
}

export function isShellOnlyRenderLog(log) {
  const normalized = normalizeTerminalLog(log);
  return (
    String(normalized.source || "").startsWith("shell:") ||
    isShellTraceGroupLog(normalized) ||
    isLegacyShellOutputLog(normalized)
  );
}

export function runningShellGroups(logs, flow, clearAfterLogId = 0) {
  if (!flowShellRunning(flow)) return [];
  return latestShellGroups(logs, clearAfterLogId);
}

export function latestShellGroups(logs, clearAfterLogId = 0) {
  const normalizedLogs = logs.map((log) => normalizeTerminalLog(log)).filter((log) => Number(log.id) > clearAfterLogId);
  const lastCommandIndex = normalizedLogs.findLastIndex((log) => log.source === "shell:command");
  if (lastCommandIndex < 0) return [];
  const groups = [];
  const command = normalizedLogs[lastCommandIndex];
  appendTerminalGroup(groups, command);
  for (const log of normalizedLogs.slice(lastCommandIndex + 1)) {
    if (log.source === "agent:trace-group" || log.source === "shell:trace-group") continue;
    if (isShellResultLog(log)) {
      if (!isRoutineShellExitLog(log)) appendTerminalGroup(groups, log);
      break;
    }
    if (
      log.source === "agent:tool" &&
      formatTerminalMessage(log.source, log.message) === formatTerminalMessage(command.source, command.message)
    ) {
      continue;
    }
    if (!isShellOutputLog(log)) continue;
    if ((log.source === "shell:output" || log.source === "shell:stderr") && !hasVisibleTerminalOutput(log.message)) continue;
    appendTerminalGroup(groups, log);
  }
  return groups;
}

export function hasVisibleTerminalOutput(message) {
  return Boolean(plainTerminalText(message).trim());
}

export function isShellOutputLog(log) {
  return log.source === "shell:output" || log.source === "shell:stderr" || log.source === "shell:status";
}

export function shellOutputGroups(logs, flow) {
  const flowId = flow?.id || state.selectedFlowId;
  const clearAfterLogId = Math.max(
    state.shellOutputClearAfterLogId.get(flowId) || 0,
    Number(flow?.shellOutputClearAfterLogId || 0),
  );
  const runningGroups = runningShellGroups(logs, flow, clearAfterLogId);
  if (runningGroups.length) return runningGroups;
  return latestShellGroups(logs, clearAfterLogId);
}
