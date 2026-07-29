import { diffHasChanges, diffLoadingKey, loadFlowDiff, openDiffViewer, renderDiffIndicator } from "./diff.js";
import { applyFlowSplitSize } from "./layout.js";
import { loadLogs, scheduleTicketLogPrefetch } from "./logs.js";
import { api, isGitCloneError, requestFlowSnapshot, wsRequest } from "./net.js";
import { clearLinearIssueNotification } from "./notifications.js";
import {
  clearPromptDraftForIssue,
  flashBlockedInput,
  promptInput,
  renderAgentImageContext,
  resizeMessageInput,
  saveActiveTicketInputState,
  scheduleQueuedPromptFlush,
  shellInput,
  submitPromptMessage,
  syncTicketInputState,
  updateMessageInputMode,
} from "./prompt.js";
import { render } from "./render.js";
import { repoUrlConfigured } from "./settings.js";
import { agentProviderKindForFlow, hideSlashMenu, renderSlashMenuCommands, slashCommandExpansionMatches } from "./slash-commands.js";
import { clearSplitPaneState, renderSplitPanes } from "./split.js";
import { els, state } from "./state.js";
import { copyAgentBranchName, renderLogs, renderShellOutputPane, resumeTerminalFollow, syncAgentOutputToolbar } from "./terminal-render.js";
import {
  animateTicketSwitch,
  linearStatusName,
  loadLinearDetail,
  renderLinearDetail,
  renderTickets,
  setLinearIssuePinned,
  syncLinearTicketsWithFlows,
  ticketFlowCreating,
  updateTicketSelectionCards,
} from "./tickets.js";
import { escapeAttribute, toast } from "./ui.js";

const defaultCodexModel = "gpt-5.6-sol";
const defaultClaudeModel = "claude-fable-5";
const defaultCodexReasoningEffort = "medium";

export function githubCiStatus(flow) {
  const status = String(flow?.githubCiStatus || "unknown").toLowerCase();
  if (status === "success" || status === "pending" || status === "failure" || status === "merged") return status;
  return "unknown";
}

export function githubCiLabel(status) {
  if (status === "merged") return "GitHub PR merged";
  if (status === "success") return "GitHub CI passing";
  if (status === "failure") return "GitHub CI failing";
  if (status === "pending") return "GitHub CI pending";
  return "GitHub CI status unknown";
}

export function renderGithubCiPill(flow) {
  if (!flow?.prUrl) return "";
  const status = githubCiStatus(flow);
  const statusVisible = status !== "unknown" || Boolean(flow.githubCiDescription);
  const label = statusVisible && status !== "unknown"
    ? githubCiLabel(status)
    : flow.githubCiDescription || "GitHub CI status unknown";
  const title = flow.githubCiDescription || label;
  return `<a class="github-ci-pill${statusVisible ? ` github-ci-pill-${status}` : ""}" href="${escapeAttribute(flow.prUrl)}" target="_blank" rel="noreferrer" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(title)}">
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.22.48-2.69-1.07-2.69-1.07-.36-.92-.88-1.17-.88-1.17-.73-.5.05-.49.05-.49.8.06 1.22.82 1.22.82.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.58 7.58 0 0 1 8 3.89c.68 0 1.36.09 2 .27 1.52-1.03 2.19-.82 2.19-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.17c0 .21.14.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  </a>`;
}

export function flowRuntimeActive(flow) {
  if (hasSplitRuntimeStatus(flow)) {
    return (
      runtimeStatusActive(flow.agentRuntimeStatus) ||
      runtimeStatusActive(flow.shellRuntimeStatus) ||
      (!flow.agentRuntimeStatus && !flow.shellRuntimeStatus && runtimeStatusActive(flow.agentStatus))
    );
  }
  return runtimeStatusActive(flow?.agentStatus);
}

export function flowRuntimeKind(flow) {
  if (hasSplitRuntimeStatus(flow)) {
    if (flowShellRunning(flow) && !flowAgentRunning(flow)) return "shell";
    return "agent";
  }
  if (
    flow?.id === state.selectedFlowId &&
    state.shellSubmitting &&
    !runtimeStatusActive(flow.agentStatus)
  ) {
    return "shell";
  }
  return flow?.agentRuntimeKind === "shell" ? "shell" : "agent";
}

export function flowAgentRunning(flow) {
  if (!flow) return false;
  if (hasSplitRuntimeStatus(flow)) {
    return (
      runtimeStatusActive(flow.agentRuntimeStatus) ||
      (!flow.agentRuntimeStatus &&
        !runtimeStatusActive(flow.shellRuntimeStatus) &&
        runtimeStatusActive(flow.agentStatus) &&
        flowRuntimeKind(flow) === "agent")
    );
  }
  return runtimeStatusActive(flow.agentStatus) && flowRuntimeKind(flow) === "agent";
}

export function flowAgentCompacting(flow) {
  return flowAgentRunning(flow) && Boolean(flow?.agentCompacting);
}

export function flowAgentQueuedMessage(flow) {
  return flowAgentCompacting(flow) && Boolean(flow?.agentQueuedMessage);
}

export function flowShellRunning(flow) {
  if (!flow) return false;
  if (hasSplitRuntimeStatus(flow)) {
    return (
      runtimeStatusActive(flow.shellRuntimeStatus) ||
      (!flow.shellRuntimeStatus &&
        !runtimeStatusActive(flow.agentRuntimeStatus) &&
        runtimeStatusActive(flow.agentStatus) &&
        flowRuntimeKind(flow) === "shell")
    );
  }
  return runtimeStatusActive(flow.agentStatus) && flowRuntimeKind(flow) === "shell";
}

export function flowShellLive(flow) {
  if (!flow) return false;
  const running = hasSplitRuntimeStatus(flow)
    ? flow.shellRuntimeStatus === "running"
    : flow.agentStatus === "running" && flowRuntimeKind(flow) === "shell";
  return running && !state.shellInterruptingFlowIds.has(flow.id);
}

export function hasSplitRuntimeStatus(flow) {
  return Boolean(flow && ("agentRuntimeStatus" in flow || "shellRuntimeStatus" in flow));
}

export function runtimeStatusActive(status) {
  return status === "running" || status === "interrupting";
}

export function flowForId(flowId) {
  return state.flows.find((flow) => flow.id === flowId) || null;
}

export function linearIssueIdForFlowId(flowId) {
  return flowForId(flowId)?.linearIssueId || "";
}

export function setFlows(flows, options = {}) {
  const nextFlows = flows || [];
  if (!options.preserveQueuedPromptDraft) syncClearedQueuedPromptDrafts(state.flows, nextFlows);
  const nextIds = new Set(nextFlows.map((flow) => flow.id));
  for (const flow of state.flows) {
    if (!nextIds.has(flow.id)) clearFlowClientState(flow.id);
  }
  state.flows = nextFlows;
  const selected = state.flows.find((flow) => flow.id === state.selectedFlowId);
  if (selected?.linearIssueId && state.selectedLinearIssueId !== selected.linearIssueId) {
    state.selectedLinearIssueId = selected.linearIssueId;
    localStorage.setItem("flow.selectedLinearIssueId", selected.linearIssueId);
  }
  syncShellOutputClearState(state.flows);
  syncLinearTicketsWithFlows();
  scheduleQueuedPromptFlush();
  scheduleTicketLogPrefetch();
}

export function queuedPromptMessage(flow) {
  return String(flow?.queuedPrompt?.message || "");
}

export function syncClearedQueuedPromptDrafts(previousFlows, nextFlows) {
  const nextById = new Map((nextFlows || []).map((flow) => [flow.id, flow]));
  for (const previousFlow of previousFlows || []) {
    const message = queuedPromptMessage(previousFlow);
    if (!message) continue;
    const nextFlow = nextById.get(previousFlow.id);
    if (queuedPromptMessage(nextFlow)) continue;
    if (state.queuedPrompt?.flowId === previousFlow.id) state.queuedPrompt = null;
    clearPromptDraftForIssue(previousFlow.linearIssueId || linearIssueIdForFlowId(previousFlow.id), message);
  }
}

export function clearFlowClientState(flowId) {
  clearLinearIssueNotification(linearIssueIdForFlowId(flowId), { render: false });
  state.logs.delete(flowId);
  state.logIds.delete(flowId);
  state.firstLogId.delete(flowId);
  state.lastLogId.delete(flowId);
  state.logBackfilledFlowIds.delete(flowId);
  state.logOlderCompleteFlowIds.delete(flowId);
  state.logOlderLoadingFlowIds.delete(flowId);
  state.terminalVisibleTurnCounts.delete(flowId);
  state.pendingLogRenders.delete(flowId);
  state.logPrefetchingFlowIds.delete(flowId);
  state.logPrefetchFailedFlowIds.delete(flowId);
  state.pendingShellOutputRenders.delete(flowId);
  state.shellOutputClearAfterLogId.delete(flowId);
  state.openTraceGroups.delete(flowId);
  state.shellInterruptingFlowIds.delete(flowId);
  state.agentTraceHiddenByFlow.delete(flowId);
  state.rawAgentMarkdownByFlow.delete(flowId);
  if (state.queuedPrompt?.flowId === flowId) state.queuedPrompt = null;
  state.flowDiffs.delete(flowId);
  state.flowDiffLoadingIds.delete(flowId);
  for (const key of state.pendingFlowDiffRefreshes.keys()) {
    if (key.startsWith(`${flowId}:`)) state.pendingFlowDiffRefreshes.delete(key);
  }
  if (state.diffModalFlowId === flowId) {
    state.diffModalFlowId = "";
    state.diffModalDiff = null;
  }
  if (state.diffModalLoadingFlowId === flowId) state.diffModalLoadingFlowId = "";
  if (state.selectedFlowId === flowId) {
    state.selectedFlowId = "";
    localStorage.removeItem("flow.selectedFlowId");
  }
  if (state.githubCiSelectedFlowId === flowId) state.githubCiSelectedFlowId = "";
  clearSplitPaneState(flowId);
}

export function syncShellOutputClearState(flows) {
  for (const flow of flows || []) {
    if (!flow?.id) continue;
    const clearAfterLogId = Number(flow.shellOutputClearAfterLogId || 0);
    if (!Number.isFinite(clearAfterLogId) || clearAfterLogId <= 0) continue;
    state.shellOutputClearAfterLogId.set(
      flow.id,
      Math.max(state.shellOutputClearAfterLogId.get(flow.id) || 0, clearAfterLogId),
    );
  }
}

export function runtimeOnlyFlowChanges(previousFlows, nextFlows) {
  const ignoredKeys = new Set([
    "agentStatus",
    "agentRuntimeKind",
    "agentRuntimeStatus",
    "shellRuntimeStatus",
    "updatedAt",
  ]);
  if ((previousFlows || []).length !== (nextFlows || []).length) return false;
  const previousById = new Map((previousFlows || []).map((flow) => [flow.id, flow]));
  for (const next of nextFlows || []) {
    const previous = previousById.get(next.id);
    if (!previous) return false;
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
      if (ignoredKeys.has(key)) continue;
      if (previous[key] !== next[key]) return false;
    }
  }
  return true;
}

export function githubCiOnlyFlowChanges(previousFlows, nextFlows) {
  const ignoredKeys = new Set([
    "githubCiStatus",
    "githubCiCheckedAt",
    "githubCiTargetUrl",
    "githubCiDescription",
    "updatedAt",
  ]);
  if ((previousFlows || []).length !== (nextFlows || []).length) return false;
  const previousById = new Map((previousFlows || []).map((flow) => [flow.id, flow]));
  for (const next of nextFlows || []) {
    const previous = previousById.get(next.id);
    if (!previous) return false;
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
      if (ignoredKeys.has(key)) continue;
      if (previous[key] !== next[key]) return false;
    }
  }
  return true;
}

export function tokenUsageOnlyFlowChanges(previousFlows, nextFlows) {
  const ignoredKeys = new Set([
    "agentContextTokensUsed",
    "agentContextWindow",
    "agentTotalTokensUsed",
    "updatedAt",
  ]);
  if ((previousFlows || []).length !== (nextFlows || []).length) return false;
  const previousById = new Map((previousFlows || []).map((flow) => [flow.id, flow]));
  for (const next of nextFlows || []) {
    const previous = previousById.get(next.id);
    if (!previous) return false;
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
      if (ignoredKeys.has(key)) continue;
      if (previous[key] !== next[key]) return false;
    }
  }
  return true;
}

export function agentModelLabel(flow) {
  if (!flow) return "unknown";
  const provider = agentProviderKindForFlow(flow);
  return [
    flow.agentModel || (provider === "claude" ? defaultClaudeModel : defaultCodexModel),
    flow.agentReasoningEffort || defaultCodexReasoningEffort,
    flow.agentServiceTier === "fast" ? "fast" : "",
  ].filter(Boolean).join(" ");
}

export function wouldBeAgentContext(ticket) {
  if (!ticket?.identifier) return null;
  const provider = state.defaultAgentProvider === "claude" ? "claude" : "codex";
  const issueSlug = ticket.identifier.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    agentProvider: provider,
    agentModel: provider === "claude" ? defaultClaudeModel : defaultCodexModel,
    agentReasoningEffort: defaultCodexReasoningEffort,
    branchName: issueSlug ? `turbo/${issueSlug}` : "",
  };
}

export function agentProviderIcon(flow) {
  const icon = document.createElement("span");
  icon.className = "agent-provider-icon";
  icon.dataset.provider = agentProviderKindForFlow(flow);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function agentContextWindowLabel(flow) {
  const used = Number(flow?.agentContextTokensUsed || 0);
  const total = Number(flow?.agentContextWindow || 0);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return "--";
  if (used > total) return "--";
  const available = Math.max(0, total - Math.max(0, used));
  return `${Math.round((available / total) * 100)}%`;
}

export function renderAgentContext(flow, root = els.flowPane.querySelector(".terminal-panel > .message-form"), input = promptInput(), options = {}) {
  const context = root?.querySelector(".agent-context");
  if (!context) return;
  const branch = context.querySelector(".agent-context-branch");
  const model = context.querySelector(".agent-context-model");
  const diffButton = context.querySelector(".agent-context-diff");
  const diff = flow?.id ? state.flowDiffs.get(flow.id) : null;
  context.hidden = !flow;
  context.querySelector(".agent-context-window").textContent = agentContextWindowLabel(flow);
  model.textContent = agentModelLabel(flow);
  model.prepend(agentProviderIcon(flow));
  const modelDisabled = !flow || flowAgentRunning(flow);
  const modelInteractive = flow && options.modelMenu !== false;
  model.setAttribute("aria-disabled", String(!modelInteractive || modelDisabled));
  model.tabIndex = modelInteractive ? 0 : -1;
  model.onclick = modelInteractive ? () => (modelDisabled ? flashBlockedInput(input) : openModelMenu()) : null;
  model.onkeydown = modelInteractive ? (event) => handleModelMenuKeydown(event, modelDisabled, input) : null;
  diffButton.hidden = !flow || !diffHasChanges(diff);
  renderDiffIndicator(diffButton, flow?.id || "", diff);
  diffButton.disabled = !flow;
  diffButton.onclick = flow ? () => openDiffViewer(flow.id) : null;
  const branchName = flow?.branchName || "";
  branch.textContent = branchName;
  if (flow?.prUrl) {
    branch.href = flow.prUrl;
    branch.target = "_blank";
    branch.rel = "noreferrer";
    branch.onclick = null;
    branch.onkeydown = null;
    branch.removeAttribute("role");
    branch.removeAttribute("tabindex");
    branch.removeAttribute("aria-label");
  } else {
    branch.removeAttribute("href");
    branch.removeAttribute("target");
    branch.removeAttribute("rel");
    branch.setAttribute("role", "button");
    branch.setAttribute("tabindex", "0");
    branch.setAttribute("aria-label", "Copy branch name");
    branch.onclick = () => copyAgentBranchName(branchName);
    branch.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void copyAgentBranchName(branchName);
    };
  }
  if (flow?.id && !diff && !state.flowDiffLoadingIds.has(diffLoadingKey(flow.id))) void loadFlowDiff(flow.id);
}

export function openModelMenu() {
  if (state.slashMenuCommands) return hideSlashMenu();
  state.slashCommandIndex = 0;
  renderSlashMenuCommands(slashCommandExpansionMatches("/model"));
}

export function handleModelMenuKeydown(event, blocked = false, input = promptInput()) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  if (blocked) {
    flashBlockedInput(input);
    return;
  }
  openModelMenu();
}

export function upsertFlow(flow) {
  if (!flow?.id) return;
  if (!flowShellRunning(flow)) {
    state.shellInterruptingFlowIds.delete(flow.id);
  }
  const next = [...state.flows];
  const index = next.findIndex((item) => item.id === flow.id);
  if (index !== -1 && flowUpdatedAtMs(flow) < flowUpdatedAtMs(next[index])) return;
  if (index === -1) next.push(flow);
  else next[index] = flow;
  setFlows(next);
}

export function updateFlowQueuedPrompt(flowId, queuedPrompt, options = {}) {
  if (!flowId) return;
  const index = state.flows.findIndex((item) => item.id === flowId);
  if (index === -1) return;
  const next = [...state.flows];
  next[index] = { ...next[index], queuedPrompt };
  setFlows(next, options);
}

export function updateFlowShellQueuedCommand(flowId, shellQueuedCommand) {
  if (!flowId) return;
  const index = state.flows.findIndex((item) => item.id === flowId);
  if (index === -1) return;
  const next = [...state.flows];
  next[index] = { ...next[index], shellQueuedCommand };
  setFlows(next);
}

export function flowUpdatedAtMs(flow) {
  const timestamp = Date.parse(flow?.updatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function loadSelectedFlowLogs(issueId, flowId, options = {}) {
  return loadLogs(flowId, options).catch((error) => {
    if (issueId === state.selectedLinearIssueId && flowId === state.selectedFlowId) {
      toast(error.message || "Could not load agent session.", { kind: "error" });
    }
  });
}

export function scheduleSelectedFlowPaneRender(issueId, flowId = "") {
  if (state.selectionRenderFrame) cancelAnimationFrame(state.selectionRenderFrame);
  state.selectionRenderFrame = requestAnimationFrame(() => {
    state.selectionRenderFrame = requestAnimationFrame(() => {
      state.selectionRenderFrame = 0;
      if (issueId !== state.selectedLinearIssueId || flowId !== state.selectedFlowId) return;
      const hasCachedLogs = flowId && ((state.logs.get(flowId) || []).length || state.logBackfilledFlowIds.has(flowId));
      if (flowId && !hasCachedLogs) {
        void loadSelectedFlowLogs(issueId, flowId, { scrollToLatest: true, suppressIncoming: true }).then(() => {
          if (issueId === state.selectedLinearIssueId && flowId === state.selectedFlowId) renderFlowPane();
        });
        void loadFlowDiff(flowId, { force: true });
        return;
      }
      renderFlowPane();
      if (flowId) {
        void loadSelectedFlowLogs(issueId, flowId, { scrollToLatest: true, suppressIncoming: true });
        void loadFlowDiff(flowId, { force: true });
      }
    });
  });
}

export function selectedFlow() {
  return state.flows.find((flow) => flow.id === state.selectedFlowId) || flowForLinearIssue(state.selectedLinearIssueId);
}

export function selectedTicket() {
  return state.linearTickets.find((ticket) => ticket.identifier === state.selectedLinearIssueId) || null;
}

export function flowForLinearIssue(identifier) {
  if (!identifier) return null;
  return state.flows.find((flow) => flow.linearIssueId === identifier && !flow.parentFlowId) || null;
}

export function flowForTicket(ticket) {
  if (!ticket) return null;
  return (ticket.flowId ? state.flows.find((flow) => flow.id === ticket.flowId) : null) || flowForLinearIssue(ticket.identifier);
}

export function syncSelectedGithubCiFlow(flow) {
  const flowId = flow?.prUrl ? flow.id : "";
  if (state.githubCiSelectedFlowId === flowId) return;
  state.githubCiSelectedFlowId = flowId;
  void wsRequest("selected-github-flow", { flowId }).catch(() => {});
}

export async function selectFlow(id) {
  const flow = state.flows.find((item) => item.id === id);
  if (!flow) return;
  const previousIssueId = state.selectedLinearIssueId;
  state.selectedFlowId = id;
  state.selectedLinearIssueId = flow.linearIssueId;
  clearLinearIssueNotification(flow.linearIssueId, { render: false });
  localStorage.setItem("flow.selectedFlowId", id);
  localStorage.setItem("flow.selectedLinearIssueId", flow.linearIssueId);
  resumeTerminalFollow();
  updateTicketSelectionCards(previousIssueId, flow.linearIssueId);
  renderFlowPane({ light: true });
  if (previousIssueId !== flow.linearIssueId) animateTicketSwitch();
  scheduleSelectedFlowPaneRender(flow.linearIssueId, id);
}

export async function openTicketInFlowPane(ticket) {
  const flow = flowForTicket(ticket);
  const previousIssueId = state.selectedLinearIssueId;
  state.selectedLinearIssueId = ticket.identifier;
  clearLinearIssueNotification(ticket.identifier, { render: false });
  localStorage.setItem("flow.selectedLinearIssueId", ticket.identifier);
  if (flow) {
    state.selectedFlowId = flow.id;
    localStorage.setItem("flow.selectedFlowId", flow.id);
  } else {
    state.selectedFlowId = "";
    localStorage.removeItem("flow.selectedFlowId");
  }
  resumeTerminalFollow();
  updateTicketSelectionCards(previousIssueId, ticket.identifier);
  renderFlowPane({ light: true });
  if (previousIssueId !== ticket.identifier) animateTicketSwitch();
  scheduleSelectedFlowPaneRender(ticket.identifier, flow?.id || "");
}

export async function startTicketAgentSession(ticket) {
  if (!ticket?.identifier) return;
  setLinearIssuePinned(ticket.identifier, true, { position: "top" });
  await openTicketInFlowPane(ticket);
  const input = promptInput();
  input.value = "get started on this. open a pr if you have a changeset";
  resizeMessageInput();
  saveActiveTicketInputState();
  await submitPromptMessage();
}

export function renderFlowPane(options = {}) {
  const selectedFlowById = state.flows.find((item) => item.id === state.selectedFlowId) || null;
  if (!selectedFlowById && state.selectedFlowId) {
    state.selectedFlowId = "";
    localStorage.removeItem("flow.selectedFlowId");
  }
  const flow = selectedFlow();
  if (flow && state.selectedFlowId !== flow.id) {
    state.selectedFlowId = flow.id;
    localStorage.setItem("flow.selectedFlowId", flow.id);
  }
  syncSelectedGithubCiFlow(flow);
  const ticket = selectedTicket();
  if (!flow && !ticket && state.selectedLinearIssueId && state.linearTicketsLoaded) {
    state.selectedLinearIssueId = "";
    localStorage.removeItem("flow.selectedLinearIssueId");
  }
  const issueId = flow?.linearIssueId || ticket?.identifier || "";
  const title = flow?.title || ticket?.title || "";
  const issueUrl = flow?.linearIssueUrl || ticket?.url || "";
  const agentEnabled = repoUrlConfigured();
  const agentPanel = els.flowPane.querySelector(".agent-panel");

  syncTicketInputState(issueId);
  agentPanel.classList.toggle("disabled", !agentEnabled);
  els.flowPane.classList.toggle("empty", !issueId);
  renderAgentContext(flow || wouldBeAgentContext(ticket));
  syncAgentOutputToolbar(els.flowPane.querySelector(".agent-column > .agent-output-toolbar"), flow?.id || "");
  renderAgentImageContext();
  if (!issueId) {
    return;
  }

  const messageForm = els.flowPane.querySelector(".terminal-panel > .message-form");
  const messageInput = promptInput();
  const commandInput = shellInput();
  messageInput.disabled = false;
  commandInput.disabled = false;
  messageForm.classList.remove("input-disabled");
  messageForm.setAttribute("aria-disabled", "false");
  updateMessageInputMode();
  resizeMessageInput();

  renderLinearDetail({ issueId, title, issueUrl, ticket, flow }, { light: options.light });
  applyFlowSplitSize();
  if (flow && options.light) {
    const terminal = els.flowPane.querySelector(".terminal");
    terminal._flowLogFlowId = "";
    terminal._flowLogSignature = "";
    terminal._flowLogRenderedKeys = null;
    terminal.textContent = "Loading agent session.";
  } else if (flow) {
    renderLogs(flow.id);
  } else {
    renderShellOutputPane("");
    const terminal = els.flowPane.querySelector(".terminal");
    terminal._flowLogFlowId = "";
    terminal._flowLogSignature = "";
    terminal._flowLogRenderedKeys = null;
    if (ticketFlowCreating(ticket)) {
      terminal.innerHTML = '<div class="flow-creating-message" role="status"><span class="flow-create-spinner" aria-hidden="true"></span><span>Creating worktree.</span></div>';
    } else {
      terminal.textContent = "No agent session yet.";
    }
  }
  renderSplitPanes();
  if (!options.light) void loadLinearDetail(issueId);
  scheduleQueuedPromptFlush();
}

export async function createFlowFromTicket(ticket, options = {}) {
  const issueId = ticket?.identifier || "";
  if (issueId) {
    state.creatingFlowIssueIds.add(issueId);
    renderTickets();
    if (issueId === state.selectedLinearIssueId) renderFlowPane();
  }
  try {
    const data = await api("/api/flows", {
      method: "POST",
      body: JSON.stringify({
        issue: ticket.identifier,
        title: ticket.title,
        url: ticket.url,
        linearStatus: linearStatusName(ticket),
        state: ticket.state || null,
      }),
    });
    upsertFlow(data.flow);
    render();
    await loadLogs(data.flow.id);
    if (options.select !== false) await selectFlow(data.flow.id);
    return data.flow;
  } catch (error) {
    if (isGitCloneError(error)) {
      toast(error.message, { kind: "error" });
    }
    throw error;
  } finally {
    if (issueId) {
      state.creatingFlowIssueIds.delete(issueId);
      renderTickets();
      if (issueId === state.selectedLinearIssueId) renderFlowPane();
    }
  }
}

export async function ensureSelectedFlow() {
  const flow = selectedFlow();
  if (flow) return flow;
  const ticket = selectedTicket();
  if (!ticket) return null;
  return createFlowFromTicket(ticket);
}

export function agentWorkingForFlow(flow) {
  const agentEnabled = repoUrlConfigured();
  return Boolean(
    agentEnabled &&
      flow &&
      (state.messageSubmittingFlowId === flow.id ||
        flowAgentRunning(flow) ||
        (state.interruptSubmitting && flowRuntimeKind(flow) === "agent")),
  );
}

export function syncAgentWorkingPushState(flowId, agentWorking) {
  if (agentWorking && flowId === state.selectedFlowId) requestFlowSnapshot(flowId);
}
