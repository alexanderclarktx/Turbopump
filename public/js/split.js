import { SPLIT_PANES_KEY } from "./constants.js";
import {
  ensureSelectedFlow,
  flowAgentRunning,
  flowShellRunning,
  renderFlowPane,
  selectedFlow,
  upsertFlow,
} from "./flows.js";
import { setShellPaneHidden } from "./layout.js";
import { loadLogs } from "./logs.js";
import { api } from "./net.js";
import { flashBlockedInput } from "./prompt.js";
import { els, state } from "./state.js";
import { renderLogs, renderShellOutputPane } from "./terminal-render.js";
import { toast } from "./ui.js";

const splitLogsLoadingFlowIds = new Set();

export function splitPaneState(flowId) {
  return state.splitPanes.get(flowId) || { agent: false, shell: false };
}

export function isSplitPaneOpen(flowId, kind) {
  return Boolean(flowId && splitPaneState(flowId)[kind]);
}

export function setSplitPaneOpen(flowId, kind, open) {
  if (!flowId) return;
  const next = { ...splitPaneState(flowId), [kind]: Boolean(open) };
  if (next.agent || next.shell) state.splitPanes.set(flowId, next);
  else state.splitPanes.delete(flowId);
  persistSplitPanes();
}

export function clearSplitPaneState(flowId) {
  if (!state.splitPanes.delete(flowId)) return;
  persistSplitPanes();
}

export function persistSplitPanes() {
  localStorage.setItem(SPLIT_PANES_KEY, JSON.stringify(Object.fromEntries(state.splitPanes)));
}

export function companionFlowFor(flowId) {
  if (!flowId) return null;
  return state.flows.find((flow) => flow.parentFlowId === flowId) || null;
}

export function selectedCompanionFlow() {
  const flow = selectedFlow();
  if (!flow || flow.parentFlowId) return null;
  return companionFlowFor(flow.id);
}

export function splitTerminal() {
  return els.flowPane.querySelector(".terminal-split");
}

export function splitShellOutputPane() {
  return els.flowPane.querySelector(".shell-output-split");
}

export function splitPromptInput() {
  return els.flowPane.querySelector(".message-input-split");
}

export function splitShellInput() {
  return els.flowPane.querySelector(".shell-input-split");
}

export function splitAgentPaneFlowId() {
  const flow = selectedFlow();
  const companion = selectedCompanionFlow();
  return flow && companion && isSplitPaneOpen(flow.id, "agent") ? companion.id : "";
}

export function splitShellPaneFlowId() {
  const flow = selectedFlow();
  const companion = selectedCompanionFlow();
  return flow && companion && isSplitPaneOpen(flow.id, "shell") ? companion.id : "";
}

export function splitPaneKindForToggle(button) {
  return button.closest(".shell-command-panel") ? "shell" : "agent";
}

export async function openSplitPane(kind) {
  const flow = await ensureSelectedFlow();
  if (!flow || flow.parentFlowId || isSplitPaneOpen(flow.id, kind)) return;
  let companion = companionFlowFor(flow.id);
  if (!companion) {
    try {
      const data = await api(`/api/flows/${encodeURIComponent(flow.id)}/split`, { method: "POST" });
      if (data.flow) upsertFlow(data.flow);
      companion = companionFlowFor(flow.id) || data.flow || null;
    } catch (error) {
      toast(error.message || "Could not open split pane.", { kind: "error" });
      return;
    }
  }
  if (!companion) return;
  setSplitPaneOpen(flow.id, kind, true);
  if (kind === "shell" && state.shellPaneHidden) setShellPaneHidden(false);
  renderFlowPane();
  const input = kind === "shell" ? splitShellInput() : splitPromptInput();
  input?.focus({ preventScroll: true });
}

export function closeSplitPane(kind) {
  const flow = selectedFlow();
  if (!flow || !isSplitPaneOpen(flow.id, kind)) return;
  setSplitPaneOpen(flow.id, kind, false);
  renderFlowPane();
  const input = kind === "shell" ? els.flowPane.querySelector(".shell-input") : els.flowPane.querySelector(".message-input");
  input?.focus({ preventScroll: true });
}

export function renderSplitPanes() {
  const panel = els.flowPane.querySelector(".terminal-panel");
  if (!panel) return;
  const flow = selectedFlow();
  const parentId = flow && !flow.parentFlowId ? flow.id : "";
  const companion = parentId ? companionFlowFor(parentId) : null;
  const agentOpen = Boolean(companion && isSplitPaneOpen(parentId, "agent"));
  const shellOpen = Boolean(companion && isSplitPaneOpen(parentId, "shell"));
  panel.classList.toggle("agent-split-open", agentOpen);
  panel.classList.toggle("shell-split-open", shellOpen);
  const terminal = splitTerminal();
  const shellPane = splitShellOutputPane();
  const promptPane = els.flowPane.querySelector(".prompt-input-pane-split");
  const shellPanel = els.flowPane.querySelector(".shell-command-panel-split");
  if (terminal) terminal.hidden = !agentOpen;
  if (shellPane) shellPane.hidden = !shellOpen;
  if (promptPane) promptPane.hidden = !agentOpen;
  if (shellPanel) shellPanel.hidden = !shellOpen;
  if (terminal && !agentOpen) {
    terminal.replaceChildren();
    terminal._flowLogFlowId = "";
    terminal._flowLogSignature = "";
    terminal._flowLogRenderedKeys = null;
    terminal._flowLogNodeCache = null;
  }
  if (shellPane && !shellOpen) {
    shellPane.replaceChildren();
    shellPane._shellOutputSignature = "";
  }
  if (!companion || (!agentOpen && !shellOpen)) return;
  if (
    !state.logBackfilledFlowIds.has(companion.id) &&
    !splitLogsLoadingFlowIds.has(companion.id)
  ) {
    splitLogsLoadingFlowIds.add(companion.id);
    void loadLogs(companion.id, { scrollToLatest: true, suppressIncoming: true })
      .catch(() => {})
      .finally(() => splitLogsLoadingFlowIds.delete(companion.id));
  }
  if (agentOpen) renderLogs(companion.id, { suppressIncoming: true });
  if (shellOpen) renderShellOutputPane(companion.id);
}

export function resizeSplitPromptInput() {
  const input = splitPromptInput();
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}

export async function submitSplitPromptMessage() {
  const input = splitPromptInput();
  const companion = selectedCompanionFlow();
  if (!input || !companion) return;
  const message = input.value.trim();
  if (!message) return;
  if (state.splitMessageSubmitting || flowAgentRunning(companion)) {
    flashBlockedInput(input);
    return;
  }
  state.splitMessageSubmitting = true;
  input.value = "";
  resizeSplitPromptInput();
  try {
    renderLogs(companion.id, { force: true, scrollToLatest: true });
    const data = await api(`/api/flows/${encodeURIComponent(companion.id)}/message`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    if (data.flow) upsertFlow(data.flow);
  } catch (error) {
    if (!input.value) {
      input.value = message;
      resizeSplitPromptInput();
    }
    toast(error.message || "Could not send message.", { kind: "error" });
  } finally {
    state.splitMessageSubmitting = false;
    await loadLogs(companion.id, { scrollToLatest: true }).catch(() => {});
    splitPromptInput()?.focus({ preventScroll: true });
  }
}

export async function submitSplitShellCommand() {
  const input = splitShellInput();
  const companion = selectedCompanionFlow();
  if (!input || !companion) return;
  const command = input.value.trim();
  if (!command) return;
  if (command === "clear") {
    input.value = "";
    try {
      const data = await api(`/api/flows/${encodeURIComponent(companion.id)}/shell-output/clear`, { method: "POST" });
      const clearAfterLogId = Number(data.clearAfterLogId || 0);
      if (Number.isFinite(clearAfterLogId)) state.shellOutputClearAfterLogId.set(companion.id, clearAfterLogId);
      if (data.flow) upsertFlow(data.flow);
    } catch (error) {
      toast(error.message || "Could not clear shell output.", { kind: "error" });
    }
    renderShellOutputPane(companion.id);
    splitShellInput()?.focus({ preventScroll: true });
    return;
  }
  if (state.splitShellSubmitting || flowShellRunning(companion)) {
    flashBlockedInput(input);
    return;
  }
  state.splitShellSubmitting = true;
  input.value = "";
  state.shellInterruptingFlowIds.delete(companion.id);
  try {
    const data = await api(`/api/flows/${encodeURIComponent(companion.id)}/command`, {
      method: "POST",
      body: JSON.stringify({ command }),
    });
    if (data.flow) upsertFlow(data.flow);
  } catch (error) {
    if (!input.value) input.value = command;
    toast(error.message || "Could not run shell command.", { kind: "error" });
  } finally {
    state.splitShellSubmitting = false;
    await loadLogs(companion.id, { shellOnly: true }).catch(() => {});
    renderShellOutputPane(companion.id);
    splitShellInput()?.focus({ preventScroll: true });
  }
}

export async function interruptSplitAgent() {
  const companion = selectedCompanionFlow();
  if (!companion || !flowAgentRunning(companion)) return false;
  const data = await api(`/api/flows/${encodeURIComponent(companion.id)}/agent/interrupt`, { method: "POST" });
  if (data.flow) upsertFlow(data.flow);
  return true;
}

export async function interruptSplitShell() {
  const companion = selectedCompanionFlow();
  if (!companion || !flowShellRunning(companion)) return false;
  state.shellInterruptingFlowIds.add(companion.id);
  renderShellOutputPane(companion.id);
  const data = await api(`/api/flows/${encodeURIComponent(companion.id)}/command/interrupt`, { method: "POST" });
  if (data.flow) upsertFlow(data.flow);
  return true;
}
