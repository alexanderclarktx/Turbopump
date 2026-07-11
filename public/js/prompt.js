import { QUEUED_PROMPT_PREFIX_HTML } from "./constants.js";
import {
  ensureSelectedFlow,
  flowAgentCompacting,
  flowAgentQueuedMessage,
  flowAgentRunning,
  flowRuntimeActive,
  flowShellRunning,
  linearIssueIdForFlowId,
  renderFlowPane,
  selectedFlow,
  selectedTicket,
  updateFlowQueuedPrompt,
  upsertFlow,
} from "./flows.js";
import {
  cancelHistorySearch,
  cloneHistoryNavigation,
  cloneHistorySearch,
  moveHistorySearchForward,
  rememberInputHistory,
  renderHistorySearchIndicator,
  resetInputHistoryNavigation,
  startOrAdvanceHistorySearch,
} from "./input-history.js";
import {
  revealShellPaneForInputFocus,
  toggleShellPaneHidden,
  toggleTheme,
  toggleTicketDrawerHidden,
} from "./layout.js";
import { loadLogs } from "./logs.js";
import { api, requestFlowSnapshot } from "./net.js";
import { repoUrlConfigured, toggleSettingsCollapsed } from "./settings.js";
import { hideSlashMenu, renderSlashMenu } from "./slash-commands.js";
import { els, emptyTicketInputState, state } from "./state.js";
import {
  clearShellOutputPane,
  followTerminalToLatestDuringLayout,
  renderLogs,
  renderShellOutputPane,
  terminalAtLatest,
} from "./terminal-render.js";
import { renderTickets } from "./tickets.js";
import { escapeAttribute, escapeHtml } from "./ui.js";

export function ticketInputState(issueId) {
  if (!state.ticketInputStates.has(issueId)) state.ticketInputStates.set(issueId, emptyTicketInputState());
  return state.ticketInputStates.get(issueId);
}

export function saveActiveTicketInputState() {
  const issueId = state.activeInputIssueId;
  if (!issueId) return;
  const inputState = ticketInputState(issueId);
  const messageInput = promptInput();
  const commandInput = shellInput();
  if (messageInput) inputState.promptValue = messageInput.value;
  if (commandInput) inputState.shellValue = commandInput.value;
  inputState.historySearch = cloneHistorySearch(state.historySearch);
  inputState.historyNavigation = cloneHistoryNavigation(state.historyNavigation);
}

export function restoreTicketInputState(issueId) {
  const inputState = issueId ? ticketInputState(issueId) : emptyTicketInputState();
  const messageInput = promptInput();
  const commandInput = shellInput();
  if (messageInput) messageInput.value = inputState.promptValue;
  if (commandInput) commandInput.value = inputState.shellValue;
  state.historySearch = cloneHistorySearch(inputState.historySearch);
  state.historyNavigation = cloneHistoryNavigation(inputState.historyNavigation);
  state.slashCommandIndex = 0;
  updateMessageInputMode();
  resizeMessageInput();
  renderHistorySearchIndicator();
}

export function queuedPromptDraftMatches(value, message = "") {
  if (!message) return true;
  return value === message || value.trim() === message.trim();
}

export function clearPromptDraftForIssue(issueId, message = "") {
  if (!issueId) return;
  const inputState = ticketInputState(issueId);
  if (queuedPromptDraftMatches(inputState.promptValue, message)) inputState.promptValue = "";
  if (state.activeInputIssueId === issueId) {
    const input = promptInput();
    if (input && queuedPromptDraftMatches(input.value, message)) {
      input.value = "";
      resizeMessageInput();
    }
  }
}

export function clearQueuedPromptDraftState(flow, message = "") {
  const flowId = flow?.id || "";
  const issueId = flow?.linearIssueId || linearIssueIdForFlowId(flowId);
  if (state.queuedPrompt?.flowId === flowId) state.queuedPrompt = null;
  if (issueId) {
    clearPromptDraftForIssue(issueId, message);
  }
  if (flowId) updateFlowQueuedPrompt(flowId, null);
}

export function syncTicketInputState(issueId) {
  const nextIssueId = issueId || "";
  if (state.activeInputIssueId === nextIssueId) return;
  saveActiveTicketInputState();
  state.activeInputIssueId = nextIssueId;
  restoreTicketInputState(nextIssueId);
}

export function promptInput() {
  return els.flowPane.querySelector(".terminal-panel > .message-form .message-input");
}

export function shellInput() {
  return els.flowPane.querySelector(".shell-command-panel:not(.shell-command-panel-split) .shell-input");
}

export function focusInputPane(kind) {
  if (kind === "shell" && state.shellPaneHidden) return false;
  const input = kind === "shell" ? shellInput() : promptInput();
  if (!input) return false;
  cancelHistorySearch();
  resetInputHistoryNavigation();
  saveActiveTicketInputState();
  input.focus({ preventScroll: true });
  return true;
}

export function focusedInputPaneKind() {
  if (document.activeElement === shellInput()) return "shell";
  if (document.activeElement === promptInput()) return "prompt";
  return "";
}

export function toggleFocusedInputPane() {
  const focused = focusedInputPaneKind();
  if (focused === "shell") return focusInputPane("prompt");
  if (focused !== "prompt") return focusInputPane("prompt");
  return focusInputPane("shell") || focusInputPane("prompt");
}

export function setInputMode(mode) {
  focusInputPane(mode === "command" || mode === "shell" ? "shell" : "prompt");
}

export function updateMessageInputMode() {
  const input = promptInput();
  if (!input) return;
  const flow = selectedFlow();
  const queuedPrompt = queuedPromptForFlow(flow);
  const queued = Boolean(queuedPrompt);
  const queuedCanSteer = promptQueuedCanSteer(flow);
  const pane = els.flowPane.querySelector(".terminal-panel > .message-form .prompt-input-pane");
  const prefix = els.flowPane.querySelector(".terminal-panel > .message-form .prompt-input-prefix");
  const queuedHint = els.flowPane.querySelector(".queued-prompt-hint");
  const compactQueued = queued && flowAgentCompacting(flow);
  pane?.classList.toggle("prompt-queued", queued);
  if (queuedHint) {
    queuedHint.hidden = !queued || compactQueued;
    queuedHint.textContent = queuedCanSteer ? 'message queued — press "s" to steer' : "message queued";
  }
  const prefixGlyph = prefix?.querySelector(".input-pane-prefix-glyph");
  if (prefixGlyph) {
    if (queued && !prefixGlyph.querySelector(".queued-prompt-spinner")) {
      prefixGlyph.innerHTML = QUEUED_PROMPT_PREFIX_HTML;
    } else if (!queued && prefixGlyph.textContent !== ">") {
      prefixGlyph.textContent = ">";
    }
  }
  if (queued) {
    if (input.value !== queuedPrompt.message) {
      input.value = queuedPrompt.message;
      resizeMessageInput();
    }
    hideSlashMenu();
    return;
  }
  renderSlashMenu();
}

export function queuedPromptForFlow(flow) {
  if (!flow?.id) return null;
  if (flow.queuedPrompt?.message) {
    return {
      flowId: flow.id,
      message: flow.queuedPrompt.message,
      createdAt: flow.queuedPrompt.createdAt || "",
      updatedAt: flow.queuedPrompt.updatedAt || "",
    };
  }
  return state.queuedPrompt?.flowId === flow.id ? state.queuedPrompt : null;
}

export function queuedPromptEntries() {
  const entries = [];
  const seen = new Set();
  for (const flow of state.flows) {
    const queued = queuedPromptForFlow(flow);
    if (!queued || seen.has(flow.id)) continue;
    seen.add(flow.id);
    entries.push({ queued, flow });
  }
  return entries;
}

export function promptQueuedForFlow(flow) {
  return Boolean(queuedPromptForFlow(flow));
}

export function promptQueuedForSelectedFlow() {
  return promptQueuedForFlow(selectedFlow());
}

export function queuedPromptSlashCommand(queued) {
  const trimmed = String(queued?.message || "").trim();
  if (!trimmed.startsWith("/")) return "";
  const [command] = trimmed.split(/\s+/, 1);
  return command.toLowerCase();
}

export function queuedPromptCanSteer(queued) {
  return !["/compact", "/model"].includes(queuedPromptSlashCommand(queued));
}

export function promptQueuedCanSteer(flow = selectedFlow()) {
  const queued = queuedPromptForFlow(flow);
  return Boolean(queued && queuedPromptCanSteer(queued) && flowAgentRunning(flow) && !flowAgentCompacting(flow));
}

export function canSubmitPromptMessage() {
  const flow = selectedFlow();
  const ticket = selectedTicket();
  return Boolean(
    repoUrlConfigured() &&
      (flow || ticket) &&
      !state.messageSubmitting &&
      !state.agentImageUploading &&
      !flowAgentRunning(flow) &&
      !promptQueuedForFlow(flow),
  );
}

export function canSubmitShellCommand() {
  const flow = selectedFlow();
  const ticket = selectedTicket();
  return Boolean(repoUrlConfigured() && (flow || ticket) && !state.shellSubmitting && !flowShellRunning(flow));
}

export function canSwitchInputPane() {
  const flow = selectedFlow();
  const ticket = selectedTicket();
  return Boolean(repoUrlConfigured() && (flow || ticket));
}

export function handleInputPaneTabKeydown(event) {
  if (event.defaultPrevented) return false;
  if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
  if (!canSwitchInputPane()) return false;
  event.preventDefault();
  if (event.repeat) return true;
  const primaryPrompt = promptInput();
  const splitPrompt = els.flowPane.querySelector(".message-input-split");
  const primaryShell = shellInput();
  const splitShell = els.flowPane.querySelector(".shell-input-split");
  const focused = document.activeElement;
  if (!splitPrompt?.closest(".terminal-split-pane")?.hidden && (focused === primaryPrompt || focused === splitPrompt)) {
    (focused === primaryPrompt ? splitPrompt : primaryPrompt)?.focus({ preventScroll: true });
    return true;
  }
  if (!splitShell?.closest(".shell-output-split-pane")?.hidden && (focused === primaryShell || focused === splitShell)) {
    (focused === primaryShell ? splitShell : primaryShell)?.focus({ preventScroll: true });
    return true;
  }
  if (focusedInputPaneKind() === "prompt" && state.shellPaneHidden) {
    revealShellPaneForInputFocus();
    return true;
  }
  toggleFocusedInputPane();
  return true;
}

export function focusShellInputPaneForShortcut() {
  if (!canSwitchInputPane()) return false;
  if (state.shellPaneHidden) {
    revealShellPaneForInputFocus();
    return true;
  }
  return focusInputPane("shell");
}

export function flashBlockedInput(input) {
  if (!input) return;
  input.classList.remove("input-submit-blocked");
  void input.offsetWidth;
  input.classList.add("input-submit-blocked");
  window.setTimeout(() => input.classList.remove("input-submit-blocked"), 420);
}

export function clearQueuedPrompt(options = {}) {
  const flow = selectedFlow();
  const queued = queuedPromptForFlow(flow) || state.queuedPrompt;
  state.queuedPrompt = null;
  if (queued?.flowId) updateFlowQueuedPrompt(queued.flowId, null, { preserveQueuedPromptDraft: true });
  updateMessageInputMode();
  saveActiveTicketInputState();
  if (options.persist !== false && queued?.flowId) {
    void api(`/api/flows/${encodeURIComponent(queued.flowId)}/queued-prompt`, { method: "DELETE" })
      .then((data) => {
        if (data.flow) upsertFlow(data.flow);
      })
      .catch(() => {});
  }
}

export async function queuePromptMessage(input) {
  const flow = selectedFlow();
  if (!flow?.id || promptQueuedForFlow(flow) || !input) return false;
  const message = input.value.trim();
  const slashCommand = message.startsWith("/");
  const queuedImages = slashCommand ? [] : [...state.pendingAgentImages];
  const queuedMessage = slashCommand
    ? message
    : agentMessageWithImages(message || (queuedImages.length ? "Use the attached image context." : ""), queuedImages);
  if (!queuedMessage.trim()) return false;
  const queued = {
    flowId: flow.id,
    message: queuedMessage,
  };
  state.queuedPrompt = queued;
  if (!slashCommand) state.pendingAgentImages = [];
  cancelHistorySearch();
  resetInputHistoryNavigation();
  updateMessageInputMode();
  resizeMessageInput();
  saveActiveTicketInputState();
  renderTickets();
  renderFlowPane();
  try {
    const data = await api(`/api/flows/${encodeURIComponent(flow.id)}/queued-prompt`, {
      method: "PUT",
      body: JSON.stringify({ message: queued.message }),
    });
    if (state.queuedPrompt === queued) state.queuedPrompt = null;
    if (data.flow) upsertFlow(data.flow);
  } catch (error) {
    if (!slashCommand) state.pendingAgentImages = [...queuedImages, ...state.pendingAgentImages];
    if (state.queuedPrompt === queued) clearQueuedPrompt({ persist: false });
    throw error;
  }
  return true;
}

export async function submitQueuedPromptSteer() {
  const flow = selectedFlow();
  const queued = queuedPromptForFlow(flow);
  const input = promptInput();
  const message = String(queued?.message || "").trim();
  if (!queued || !flow?.id || queued.flowId !== flow.id || !message) {
    if (queued === state.queuedPrompt) clearQueuedPrompt({ persist: false });
    return true;
  }
  if (!promptQueuedCanSteer(flow) || state.messageSubmitting) {
    flashBlockedInput(input);
    return true;
  }

  clearQueuedPromptDraftState(flow, queued.message);
  updateMessageInputMode();
  saveActiveTicketInputState();
  state.messageSubmitting = true;
  state.messageSubmittingFlowId = flow.id;
  requestFlowSnapshot(flow.id);
  renderTickets();
  renderFlowPane();
  try {
    const data = await api(`/api/flows/${encodeURIComponent(flow.id)}/queued-prompt/steer`, { method: "POST" });
    if (data.flow) upsertFlow(data.flow);
    await loadLogs(flow.id, { scrollToLatest: true });
  } finally {
    state.messageSubmitting = false;
    state.messageSubmittingFlowId = "";
    renderTickets();
    renderFlowPane();
    promptInput()?.focus();
  }
  return true;
}

export function handleQueuedPromptKeydown(event) {
  if (!promptQueuedForSelectedFlow()) return false;
  if (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.isComposing &&
    ["a", "c", "r"].includes(event.key.toLowerCase())
  ) {
    return false;
  }
  if (event.key === "Tab" && handleInputPaneTabKeydown(event)) return true;
  if (
    promptQueuedCanSteer() &&
    event.key.toLowerCase() === "s" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    if (!event.repeat) void submitQueuedPromptSteer();
    return true;
  }
  if (event.key === "$" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing) {
    event.preventDefault();
    if (!event.repeat && focusShellInputPaneForShortcut()) return true;
    if (event.repeat) return true;
  }
  if (["Alt", "CapsLock", "Control", "Meta", "Shift"].includes(event.key)) return true;
  event.preventDefault();
  if (event.key === "Escape") {
    if (!event.repeat) clearQueuedPrompt();
    return true;
  }
  if (event.key === "Backspace") {
    clearQueuedPrompt();
    return true;
  }
  flashBlockedInput(event.currentTarget);
  return true;
}

export function handleQueuedPromptBeforeInput(event) {
  if (!promptQueuedForSelectedFlow()) return false;
  event.preventDefault();
  flashBlockedInput(event.currentTarget);
  return true;
}

export function scheduleQueuedPromptFlush() {
  if (!queuedPromptEntries().length || state.queuedPromptFlushTimer) return;
  state.queuedPromptFlushTimer = window.setTimeout(() => {
    state.queuedPromptFlushTimer = 0;
    void flushQueuedPrompt();
  }, 0);
}

export async function flushQueuedPrompt() {
  if (state.messageSubmitting) return;
  for (const { queued, flow } of queuedPromptEntries()) {
    if (!queued || !flow?.id || flowAgentRunning(flow)) continue;
    await submitQueuedPromptMessage(queued, flow);
    return;
  }
}

export async function submitQueuedPromptMessage(queued, flow) {
  const message = String(queued?.message || "").trim();
  if (!flow?.id || !message) {
    if (state.queuedPrompt === queued) clearQueuedPrompt();
    return;
  }

  const selected = flow.id === state.selectedFlowId;
  clearQueuedPromptDraftState(flow, queued.message);
  updateMessageInputMode();
  if (selected) {
    saveActiveTicketInputState();
    state.messageSubmitting = true;
    state.messageSubmittingFlowId = flow.id;
    requestFlowSnapshot(flow.id);
    renderFlowPane();
    renderLogs(flow.id, { force: true, scrollToLatest: true });
  } else if (flow.linearIssueId) {
    const inputState = ticketInputState(flow.linearIssueId);
    if (inputState.promptValue === queued.message) inputState.promptValue = "";
  }
  renderTickets();
  try {
    const data = await api(`/api/flows/${encodeURIComponent(flow.id)}/queued-prompt/flush`, { method: "POST" });
    if (data.flow) upsertFlow(data.flow);
    await loadLogs(flow.id, selected ? { scrollToLatest: true } : {});
  } finally {
    if (selected) {
      state.messageSubmitting = false;
      state.messageSubmittingFlowId = "";
      scheduleQueuedPromptFlush();
      renderTickets();
      renderFlowPane();
      promptInput().focus();
    } else {
      renderTickets();
    }
  }
}

export async function interruptSelectedFlow() {
  if (state.interruptSubmitting) return false;
  const selected = selectedFlow();
  if (!flowRuntimeActive(selected)) return false;
  state.interruptSubmitting = true;
  renderTickets();
  renderFlowPane();
  try {
    const data = await api(`/api/flows/${selected.id}/agent/interrupt`, { method: "POST" });
    if (data.flow) upsertFlow(data.flow);
  } finally {
    state.interruptSubmitting = false;
    renderTickets();
    renderFlowPane();
  }
  return true;
}

export async function interruptSelectedShellCommand() {
  if (state.interruptSubmitting) return false;
  const selected = selectedFlow();
  if (!flowShellRunning(selected)) return false;
  state.interruptSubmitting = true;
  state.shellInterruptingFlowIds.add(selected.id);
  renderShellOutputPane(selected.id);
  try {
    const data = await api(`/api/flows/${selected.id}/command/interrupt`, { method: "POST" });
    if (data.flow) upsertFlow(data.flow);
  } finally {
    state.interruptSubmitting = false;
    shellInput()?.focus({ preventScroll: true });
  }
  return true;
}

export function isEditableKeyTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  return target.closest("[contenteditable]:not([contenteditable='false'])") !== null;
}

export function shouldFocusMessageInputForKey(event) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key.length !== 1) return false;
  if (isEditableKeyTarget(event.target)) return false;
  const input = promptInput();
  return Boolean(input && document.activeElement !== input);
}

export function focusMessageInputForKey(event) {
  if (!shouldFocusMessageInputForKey(event)) return false;
  const input = promptInput();
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  event.preventDefault();
  if (event.key === "$" && focusShellInputPaneForShortcut()) return true;
  if (promptQueuedForSelectedFlow()) {
    input.focus();
    flashBlockedInput(input);
    return true;
  }
  input.focus();
  input.setRangeText(event.key, start, end, "end");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

export function handleShellInterruptKeydown(event) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (!event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== "c") return false;
  if (!flowShellRunning(selectedFlow())) return false;
  event.preventDefault();
  void interruptSelectedShellCommand();
  return true;
}

export function handleAgentInterruptKeydown(event) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (focusedInputPaneKind() !== "prompt") return false;
  if (!flowAgentRunning(selectedFlow())) return false;
  event.preventDefault();
  if (!event.repeat) void interruptSelectedFlow();
  return true;
}

export function handleCommandE(event) {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "e") return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat) return true;
  toggleTheme();
  return true;
}

export function handleCommandK(event) {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "k") return false;
  if (focusedInputPaneKind() !== "shell") return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!event.repeat) void submitShellCommand("clear");
  return true;
}

export function handlePaneVisibilityShortcuts(event) {
  const key = event.key.toLowerCase();
  const togglesSettings = event.metaKey && !event.ctrlKey && !event.altKey && (event.code === "Comma" || key === ",");
  const togglesTickets = event.ctrlKey && !event.metaKey && !event.altKey && (event.code === "Backquote" || key === "`");
  const togglesShell = event.metaKey && !event.ctrlKey && !event.altKey && (event.code === "Backslash" || key === "\\");
  if (!togglesSettings && !togglesTickets && !togglesShell) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat) return true;
  if (togglesSettings) toggleSettingsCollapsed();
  if (togglesTickets) toggleTicketDrawerHidden();
  if (togglesShell) toggleShellPaneHidden();
  return true;
}

export function handleGlobalHistorySearchKeydown(event) {
  if (!event.ctrlKey || event.metaKey || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key !== "r" && key !== "z") return false;
  if (isEditableKeyTarget(event.target)) return false;
  const input = document.activeElement === shellInput() ? shellInput() : promptInput();
  if (!input) return false;
  if (key === "r") {
    event.preventDefault();
    input.focus();
    startOrAdvanceHistorySearch(input);
    return true;
  }
  if (!state.historySearch) return false;
  event.preventDefault();
  input.focus();
  moveHistorySearchForward(input);
  return true;
}

export function resizeMessageInput() {
  const input = promptInput();
  const terminal = els.flowPane.querySelector(".terminal");
  if (!input) return;
  const shouldFollowLatest = !state.terminalFollowPaused && terminalAtLatest(terminal);
  const currentHeight = input.getBoundingClientRect().height;
  input.style.height = "auto";
  const targetHeight = input.scrollHeight;
  if (!currentHeight || Math.abs(currentHeight - targetHeight) < 1) {
    input.style.height = `${targetHeight}px`;
  } else {
    input.style.height = `${currentHeight}px`;
    requestAnimationFrame(() => {
      input.style.height = `${targetHeight}px`;
    });
  }
  if (shouldFollowLatest) followTerminalToLatestDuringLayout(terminal, 160);
}

export function renderAgentImageContext() {
  const container = els.flowPane.querySelector(".agent-image-context");
  if (!container) return;
  const images = state.pendingAgentImages;
  container.hidden = !images.length && !state.agentImageUploading;
  const uploading = state.agentImageUploading ? '<span class="agent-image-chip pending">uploading...</span>' : "";
  container.innerHTML = `${images
    .map((image, index) => renderAgentImageChip(image, { index }))
    .join("")}${uploading}`;
}

export function renderAgentImageChip(image, options = {}) {
  const label = image.name || imageLabelFromPath(image.relativePath || image.path) || "image";
  const removable = options.index !== undefined;
  const previewSrc = agentImagePreviewSource(image);
  const previewAttrs = previewSrc
    ? ` data-image-preview data-image-preview-src="${escapeAttribute(previewSrc)}" data-image-preview-alt="${escapeAttribute(label)}"`
    : "";
  const content = previewSrc
    ? `<img class="agent-image-chip-preview" src="${escapeAttribute(previewSrc)}" alt="${escapeAttribute(label)}" title="${escapeAttribute(label)}">`
    : `<span class="agent-image-chip-label">${escapeHtml(label)}</span>`;
  return `
    <span class="agent-image-chip"${previewAttrs}>
      ${content}
      ${removable ? `<button type="button" aria-label="Remove image" data-index="${options.index}">×</button>` : ""}
    </span>
  `;
}

export function agentImagePreviewSource(image) {
  if (!state.selectedFlowId) return "";
  const path = image.relativePath || image.path || "";
  if (!path) return "";
  return `/api/flows/${encodeURIComponent(state.selectedFlowId)}/context-images/preview?path=${encodeURIComponent(path)}`;
}

export function imageLabelFromPath(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "";
}

export function agentMessageWithImages(message, images = state.pendingAgentImages) {
  if (!images.length) return message;
  const attachments = images
    .map((image) => {
      const name = image.name ? `${image.name}: ` : "";
      return `- ${name}${image.path}${image.relativePath ? ` (${image.relativePath})` : ""}`;
    })
    .join("\n");
  return `${message}\n\nAttached images:\n${attachments}`;
}

export function droppedImageFiles(event) {
  const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
  if (files.length) return files;
  return [...(event.dataTransfer?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

export function pastedImageFiles(event) {
  const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
  if (files.length) return files;
  return [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

export function eventHasDraggedFiles(event) {
  const types = [...(event.dataTransfer?.types || [])];
  if (types.includes("Files")) return true;
  return [...(event.dataTransfer?.items || [])].some((item) => item.kind === "file");
}

export function eventTargetsPromptInputPane(event) {
  return Boolean(event.target?.closest?.(".prompt-input-pane:not(.prompt-input-pane-split)"));
}

export function focusPromptInputForImageDrag(event) {
  if (eventTargetsPromptInputPane(event)) focusInputPane("prompt");
}

export function setAgentImageDragActive(active) {
  document.body.classList.toggle("agent-image-drag-active", active);
  promptInput().classList.toggle("drag-over", active);
}

export async function uploadAgentImages(files) {
  if (!files.length || state.agentImageUploading) return;
  state.agentImageUploading = true;
  renderFlowPane();
  try {
    const flow = await ensureSelectedFlow();
    if (!flow) return;
    const body = new FormData();
    for (const file of files) body.append("images", file, file.name);
    const data = await api(`/api/flows/${encodeURIComponent(flow.id)}/context-images`, {
      method: "POST",
      body,
    });
    state.pendingAgentImages.push(...(data.images || []));
  } finally {
    state.agentImageUploading = false;
    renderFlowPane();
  }
}

export async function submitShellCommand(value) {
  const input = shellInput();
  if (!input) return;
  const command = String(value || "").trim();
  if (!command) return;
  if (command === "clear") {
    rememberInputHistory(command, "shell");
    cancelHistorySearch();
    resetInputHistoryNavigation();
    input.value = "";
    saveActiveTicketInputState();
    await clearShellOutputPane();
    input.focus({ preventScroll: true });
    return;
  }
  if (!canSubmitShellCommand()) {
    flashBlockedInput(input);
    return;
  }
  if (state.pendingAgentImages.length) {
    alert("Shell commands do not support image attachments.");
    return;
  }
  rememberInputHistory(command, "shell");
  cancelHistorySearch();
  resetInputHistoryNavigation();
  state.shellSubmitting = true;
  input.value = "";
  saveActiveTicketInputState();
  hideSlashMenu();
  renderTickets();
  renderShellOutputPane(selectedFlow()?.id || "");
  let submittedFlowId = "";
  try {
    const flow = await ensureSelectedFlow();
    if (!flow) return;
    submittedFlowId = flow.id;
    state.shellInterruptingFlowIds.delete(flow.id);
    renderShellOutputPane(flow.id);
    const data = await api(`/api/flows/${flow.id}/command`, {
      method: "POST",
      body: JSON.stringify({ command }),
    });
    if (data.flow) upsertFlow(data.flow);
  } finally {
    state.shellSubmitting = false;
    if (submittedFlowId) await loadLogs(submittedFlowId, { shellOnly: true });
    renderTickets();
    renderShellOutputPane(submittedFlowId);
    if (state.shellPaneHidden) promptInput()?.focus();
    else shellInput()?.focus();
  }
}

export async function submitPromptMessage() {
  const input = promptInput();
  const message = input.value.trim();
  if (!message && !state.pendingAgentImages.length) return;
  const flow = selectedFlow();
  if (flowAgentRunning(flow)) {
    if (flowAgentQueuedMessage(flow)) {
      flashBlockedInput(input);
      return;
    }
    if (!promptQueuedForFlow(flow) && (await queuePromptMessage(input))) return;
    flashBlockedInput(input);
    return;
  }
  if (promptQueuedForFlow(flow)) {
    state.queuedPrompt = null;
    updateMessageInputMode();
  }
  if (!canSubmitPromptMessage()) {
    flashBlockedInput(input);
    return;
  }
  const slashCommand = message.startsWith("/");
  const submittedImages = slashCommand ? [] : [...state.pendingAgentImages];
  const agentMessage = slashCommand ? message : agentMessageWithImages(message || "Use the attached image context.", submittedImages);
  rememberInputHistory(message, "prompt");
  cancelHistorySearch();
  resetInputHistoryNavigation();
  const initialFlow = selectedFlow();
  state.messageSubmitting = true;
  state.messageSubmittingFlowId = initialFlow?.id || "";
  input.value = "";
  if (!slashCommand) state.pendingAgentImages = [];
  updateMessageInputMode();
  resizeMessageInput();
  saveActiveTicketInputState();
  hideSlashMenu();
  renderTickets();
  renderFlowPane();
  let submittedFlowId = "";
  try {
    const flow = await ensureSelectedFlow();
    if (!flow) return;
    submittedFlowId = flow.id;
    state.messageSubmittingFlowId = flow.id;
    requestFlowSnapshot(flow.id);
    renderFlowPane();
    renderLogs(flow.id, { force: true, scrollToLatest: true });
    const data = await api(`/api/flows/${flow.id}/message`, {
      method: "POST",
      body: JSON.stringify({ message: agentMessage }),
    });
    if (data.flow) upsertFlow(data.flow);
  } catch (error) {
    if (!slashCommand) state.pendingAgentImages = [...submittedImages, ...state.pendingAgentImages];
    throw error;
  } finally {
    state.messageSubmitting = false;
    state.messageSubmittingFlowId = "";
    scheduleQueuedPromptFlush();
    if (submittedFlowId) await loadLogs(submittedFlowId, { scrollToLatest: true });
    renderTickets();
    renderFlowPane();
    promptInput().focus();
  }
}

export async function submitPromptCommand(command) {
  const message = String(command || "").trim();
  const input = promptInput();
  if (!message.startsWith("/") || state.messageSubmitting) return false;
  if (message.startsWith("/model ") && flowAgentRunning(selectedFlow())) {
    hideSlashMenu();
    return false;
  }
  if (!repoUrlConfigured()) {
    flashBlockedInput(input);
    return false;
  }
  const initialFlow = selectedFlow();
  state.messageSubmitting = true;
  state.messageSubmittingFlowId = initialFlow?.id || "";
  hideSlashMenu();
  renderTickets();
  renderFlowPane();
  let submittedFlowId = "";
  try {
    const flow = await ensureSelectedFlow();
    if (!flow) return false;
    submittedFlowId = flow.id;
    state.messageSubmittingFlowId = flow.id;
    requestFlowSnapshot(flow.id);
    renderFlowPane();
    renderLogs(flow.id, { force: true, scrollToLatest: true });
    const data = await api(`/api/flows/${encodeURIComponent(flow.id)}/message`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    if (data.flow) upsertFlow(data.flow);
    return true;
  } finally {
    state.messageSubmitting = false;
    state.messageSubmittingFlowId = "";
    scheduleQueuedPromptFlush();
    if (submittedFlowId) await loadLogs(submittedFlowId, { scrollToLatest: true });
    renderTickets();
    renderFlowPane();
  }
}
