import { QUEUED_PROMPT_PREFIX_HTML, SPLIT_PANES_KEY } from "./constants.js";
import {
  ensureSelectedFlow,
  flowAgentRunning,
  flowShellRunning,
  renderAgentContext,
  renderFlowPane,
  selectedFlow,
  updateFlowQueuedPrompt,
  upsertFlow,
} from "./flows.js";
import { setShellPaneHidden } from "./layout.js";
import { loadLogs } from "./logs.js";
import { api } from "./net.js";
import {
  agentMessageWithImages,
  flashBlockedInput,
  handleInputPaneTabKeydown,
  promptQueuedCanSteer,
  renderAgentImageContext,
} from "./prompt.js";
import { els, state } from "./state.js";
import { renderLogs, renderShellOutputPane, scrollTerminalToLatestNow, terminalAtLatest } from "./terminal-render.js";
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
  const input = kind === "shell"
    ? els.flowPane.querySelector(".shell-command-panel:not(.shell-command-panel-split) .shell-input")
    : els.flowPane.querySelector(".terminal-panel > .message-form .message-input");
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
  const terminalPane = els.flowPane.querySelector(".terminal-split-pane");
  const shellOutputPane = els.flowPane.querySelector(".shell-output-split-pane");
  if (terminalPane) terminalPane.hidden = !agentOpen;
  const queuedPrompt = companion?.queuedPrompt;
  const queued = Boolean(queuedPrompt);
  const input = splitPromptInput();
  const promptPane = terminalPane?.querySelector(".prompt-input-pane");
  const queuedHint = terminalPane?.querySelector(".queued-prompt-hint");
  const prefixGlyph = terminalPane?.querySelector(".input-pane-prefix-glyph");
  promptPane?.classList.toggle("prompt-queued", queued);
  if (queuedHint) {
    queuedHint.hidden = !queued;
    queuedHint.textContent = promptQueuedCanSteer(companion) ? 'message queued — press "s" to steer' : "message queued";
  }
  if (queued && !prefixGlyph?.querySelector(".queued-prompt-spinner")) prefixGlyph.innerHTML = QUEUED_PROMPT_PREFIX_HTML;
  else if (!queued && prefixGlyph?.textContent !== ">") prefixGlyph.textContent = ">";
  const previousQueuedMessage = input?.dataset.queuedPrompt || "";
  if (input && queuedPrompt?.message) {
    input.dataset.queuedPrompt = queuedPrompt.message;
    if (input.value !== queuedPrompt.message) input.value = queuedPrompt.message;
    resizeSplitPromptInput();
  } else if (input && previousQueuedMessage) {
    if (input.value === previousQueuedMessage) input.value = "";
    delete input.dataset.queuedPrompt;
    resizeSplitPromptInput();
  }
  renderAgentContext(agentOpen ? companion : null, terminalPane, input, { modelMenu: false });
  renderAgentImageContext(
    terminalPane?.querySelector(".agent-image-context"),
    state.pendingSplitAgentImages,
    state.splitAgentImageUploading,
  );
  if (shellOutputPane) shellOutputPane.hidden = !shellOpen;
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

function setAgentSplitSize(size) {
  const column = els.flowPane.querySelector(".agent-column");
  const resizer = els.flowPane.querySelector(".message-form-split-resizer");
  const applied = Math.max(15, Math.min(85, size));
  column?.style.setProperty("--agent-split-size", `${applied}%`);
  resizer?.setAttribute("aria-valuenow", String(Math.round(applied)));
}

export function startAgentSplitResize(event) {
  if (event.target.closest("textarea, button, a, .slash-menu, .agent-image-context")) return;
  event.preventDefault();
  const column = event.currentTarget.closest(".agent-column");
  const rect = column?.getBoundingClientRect();
  const upperPaneHeight = column?.querySelector(".terminal-split-pane")?.getBoundingClientRect().height;
  if (!rect?.height || !upperPaneHeight) return;
  const initialSize = (upperPaneHeight / rect.height) * 100;
  const initialY = event.clientY;
  const anchoredTerminals = [...column.querySelectorAll(".terminal")].filter(terminalAtLatest);
  document.body.classList.add("agent-split-resizing");
  const resize = (clientY) => {
    setAgentSplitSize(initialSize + ((clientY - initialY) / rect.height) * 100);
    anchoredTerminals.forEach(scrollTerminalToLatestNow);
  };
  const onPointerMove = (moveEvent) => resize(moveEvent.clientY);
  const onPointerUp = () => {
    document.body.classList.remove("agent-split-resizing");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

export function handleAgentSplitResizeKeydown(event) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = Number.parseFloat(event.currentTarget.closest(".agent-column")?.style.getPropertyValue("--agent-split-size")) || 50;
  setAgentSplitSize(event.key === "Home" ? 15 : event.key === "End" ? 85 : current + (event.key === "ArrowDown" ? 5 : -5));
}

export function clearSplitQueuedPrompt() {
  const companion = selectedCompanionFlow();
  if (!companion?.queuedPrompt) return;
  updateFlowQueuedPrompt(companion.id, null, { preserveQueuedPromptDraft: true });
  renderFlowPane();
  void api(`/api/flows/${encodeURIComponent(companion.id)}/queued-prompt`, { method: "DELETE" })
    .then((data) => {
      if (data.flow) upsertFlow(data.flow);
    })
    .catch(() => {});
}

async function submitSplitQueuedPromptSteer() {
  const companion = selectedCompanionFlow();
  if (!companion?.queuedPrompt || !promptQueuedCanSteer(companion) || state.splitMessageSubmitting) {
    flashBlockedInput(splitPromptInput());
    return;
  }
  updateFlowQueuedPrompt(companion.id, null, { preserveQueuedPromptDraft: true });
  state.splitMessageSubmitting = true;
  renderFlowPane();
  try {
    const data = await api(`/api/flows/${encodeURIComponent(companion.id)}/queued-prompt/steer`, { method: "POST" });
    if (data.flow) upsertFlow(data.flow);
    await loadLogs(companion.id, { scrollToLatest: true });
  } finally {
    state.splitMessageSubmitting = false;
    renderFlowPane();
    splitPromptInput()?.focus({ preventScroll: true });
  }
}

export function handleSplitQueuedPromptKeydown(event) {
  const companion = selectedCompanionFlow();
  if (!companion?.queuedPrompt) return false;
  if (event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing && ["a", "c", "r"].includes(event.key.toLowerCase())) return false;
  if (event.key === "Tab" && handleInputPaneTabKeydown(event)) return true;
  if (promptQueuedCanSteer(companion) && event.key.toLowerCase() === "s" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing) {
    event.preventDefault();
    if (!event.repeat) void submitSplitQueuedPromptSteer();
    return true;
  }
  if (["Alt", "CapsLock", "Control", "Meta", "Shift"].includes(event.key)) return true;
  event.preventDefault();
  if (event.key === "Escape" || event.key === "Backspace") clearSplitQueuedPrompt();
  else flashBlockedInput(event.currentTarget);
  return true;
}

export function handleSplitQueuedPromptBeforeInput(event) {
  if (!selectedCompanionFlow()?.queuedPrompt) return false;
  event.preventDefault();
  flashBlockedInput(event.currentTarget);
  return true;
}

export async function submitSplitPromptMessage() {
  const input = splitPromptInput();
  const companion = selectedCompanionFlow();
  if (!input || !companion) return;
  const message = input.value.trim();
  if (!message && !state.pendingSplitAgentImages.length) return;
  if (state.splitMessageSubmitting || companion.queuedPrompt) {
    flashBlockedInput(input);
    return;
  }
  const slashCommand = message.startsWith("/");
  const submittedImages = slashCommand ? [] : [...state.pendingSplitAgentImages];
  const agentMessage = slashCommand
    ? message
    : agentMessageWithImages(message || "Use the attached image context.", submittedImages);
  const queueing = flowAgentRunning(companion);
  state.splitMessageSubmitting = true;
  if (!queueing) {
    state.optimisticPromptByFlowId.set(companion.id, { message: agentMessage, createdAt: new Date().toISOString() });
  }
  input.value = "";
  if (!slashCommand) state.pendingSplitAgentImages = [];
  resizeSplitPromptInput();
  try {
    renderLogs(companion.id, { force: true, scrollToLatest: true });
    const data = await api(`/api/flows/${encodeURIComponent(companion.id)}/${flowAgentRunning(companion) ? "queued-prompt" : "message"}`, {
      method: flowAgentRunning(companion) ? "PUT" : "POST",
      body: JSON.stringify({ message: agentMessage }),
    });
    if (data.flow) upsertFlow(data.flow);
    renderFlowPane();
  } catch (error) {
    if (!slashCommand) state.pendingSplitAgentImages = [...submittedImages, ...state.pendingSplitAgentImages];
    if (!input.value) {
      input.value = message;
      resizeSplitPromptInput();
    }
    toast(error.message || "Could not send message.", { kind: "error" });
  } finally {
    state.splitMessageSubmitting = false;
    state.optimisticPromptByFlowId.delete(companion.id);
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
