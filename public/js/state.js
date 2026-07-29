import {
  COLLAPSED_LINEAR_STATUSES_KEY,
  COLLAPSED_SETTINGS_SECTIONS_KEY,
  DEFAULT_COLLAPSED_LINEAR_STATUSES,
  FLOW_SPLIT_SIZE_KEY,
  LINEAR_PANE_HIDDEN_KEY,
  NOTIFIED_LINEAR_ISSUES_KEY,
  PINNED_LINEAR_ISSUES_KEY,
  PROMPT_HISTORY_KEY,
  SHELL_HISTORY_KEY,
  SHELL_OUTPUT_SPLIT_SIZE_KEY,
  SHELL_PANE_HIDDEN_KEY,
  SPLIT_PANES_KEY,
  THEME_KEY,
  TICKET_DRAWER_MAX_SIZE,
  TICKET_DRAWER_MIN_SIZE,
  TICKET_DRAWER_SIZE_KEY,
} from "./constants.js";

export function initialCollapsedLinearStatuses() {
  const raw = localStorage.getItem(COLLAPSED_LINEAR_STATUSES_KEY);
  if (raw === null) return new Set(DEFAULT_COLLAPSED_LINEAR_STATUSES);
  try {
    return new Set(JSON.parse(raw));
  } catch {
    return new Set(DEFAULT_COLLAPSED_LINEAR_STATUSES);
  }
}

export function initialPinnedLinearIssues() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_LINEAR_ISSUES_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : []);
  } catch {
    return new Set();
  }
}

export function initialNotifiedLinearIssues() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTIFIED_LINEAR_ISSUES_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : []);
  } catch {
    return new Set();
  }
}

export function initialCollapsedSettingsSections() {
  const raw = localStorage.getItem(COLLAPSED_SETTINGS_SECTIONS_KEY);
  if (raw === null) return new Set(["checkouts"]);
  try {
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : []);
  } catch {
    return new Set(["checkouts"]);
  }
}

export function initialFlowSplitSize() {
  const value = Number(localStorage.getItem(FLOW_SPLIT_SIZE_KEY) || 50);
  return clampFlowSplitSize(Number.isFinite(value) ? value : 50);
}

export function initialTicketDrawerSize() {
  const value = Number(localStorage.getItem(TICKET_DRAWER_SIZE_KEY) || TICKET_DRAWER_MAX_SIZE);
  return clampTicketDrawerSize(Number.isFinite(value) ? value : TICKET_DRAWER_MAX_SIZE);
}

export function initialTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function initialInputHistory(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : [];
  } catch {
    return [];
  }
}

export function emptyTicketInputState() {
  return {
    promptValue: "",
    shellValue: "",
    historySearch: null,
    historyNavigation: null,
  };
}

export function clampFlowSplitSize(value) {
  return Math.min(100, Math.max(0, value));
}

export function clampTicketDrawerSize(value) {
  return Math.min(TICKET_DRAWER_MAX_SIZE, Math.max(TICKET_DRAWER_MIN_SIZE, value));
}

export function clampShellOutputSplitSize(value) {
  return Math.min(70, Math.max(18, value));
}

export function initialShellOutputSplitSize() {
  const value = Number(localStorage.getItem(SHELL_OUTPUT_SPLIT_SIZE_KEY) || 28);
  return clampShellOutputSplitSize(Number.isFinite(value) ? value : 28);
}

export function initialBooleanSetting(key) {
  return localStorage.getItem(key) === "true";
}

export function initialSplitPanes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SPLIT_PANES_KEY) || "{}");
    return new Map(
      Object.entries(parsed)
        .filter(([, value]) => value && typeof value === "object")
        .map(([flowId, value]) => [flowId, { agent: Boolean(value.agent), shell: Boolean(value.shell) }]),
    );
  } catch {
    return new Map();
  }
}

export const state = {
  flows: [],
  checkouts: [],
  checkoutsLoaded: false,
  checkoutsLoading: false,
  linearTickets: [],
  linearWorkflowStates: [],
  linearTicketsLoaded: false,
  linearTicketsLoading: false,
  linearViewer: null,
  linearViewerName: "",
  linearSignedIn: false,
  notifiedLinearIssueIds: initialNotifiedLinearIssues(),
  notificationFaviconHref: "",
  notificationFaviconLoading: false,
  selectedLinearIssueId: localStorage.getItem("flow.selectedLinearIssueId") || "",
  selectedFlowId: localStorage.getItem("flow.selectedFlowId") || "",
  linearDetails: new Map(),
  editingLinearTitleIssueId: "",
  logs: new Map(),
  logIds: new Map(),
  firstLogId: new Map(),
  lastLogId: new Map(),
  logBackfilledFlowIds: new Set(),
  logOlderCompleteFlowIds: new Set(),
  logOlderLoadingFlowIds: new Set(),
  terminalVisibleTurnCounts: new Map(),
  pendingLogRenders: new Map(),
  logRenderFrame: 0,
  logPrefetchingFlowIds: new Set(),
  logPrefetchFailedFlowIds: new Set(),
  logPrefetchTimer: 0,
  logPrefetchedFlowCount: 0,
  selectionRenderFrame: 0,
  ticketSwitchFadeTimer: 0,
  pendingShellOutputRenders: new Set(),
  shellOutputRenderFrame: 0,
  shellOutputClearAfterLogId: new Map(),
  openTraceGroups: new Map(),
  settingsCollapsed: true,
  ticketDrawerSize: initialTicketDrawerSize(),
  theme: initialTheme(),
  collapsedSettingsSections: initialCollapsedSettingsSections(),
  collapsedLinearStatuses: initialCollapsedLinearStatuses(),
  pinnedLinearIssues: initialPinnedLinearIssues(),
  flowSplitSize: initialFlowSplitSize(),
  linearPaneHidden: initialBooleanSetting(LINEAR_PANE_HIDDEN_KEY),
  shellOutputSplitSize: initialShellOutputSplitSize(),
  ticketDrawerHidden: false,
  ticketSearchOpen: false,
  ticketSearchQuery: "",
  shellPaneHidden: initialBooleanSetting(SHELL_PANE_HIDDEN_KEY),
  splitPanes: initialSplitPanes(),
  splitMessageSubmitting: false,
  splitShellSubmitting: false,
  slashCommandIndex: 0,
  slashMenuCommands: null,
  messageSubmitting: false,
  messageSubmittingFlowId: "",
  optimisticPromptByFlowId: new Map(),
  creatingFlowIssueIds: new Set(),
  queuedPrompt: null,
  queuedPromptFlushTimer: 0,
  shellSubmitting: false,
  interruptSubmitting: false,
  shellInterruptingFlowIds: new Set(),
  pendingAgentImages: [],
  agentImageUploading: false,
  pendingSplitAgentImages: [],
  splitAgentImageUploading: false,
  agentImageDragDepth: 0,
  promptHistory: initialInputHistory(PROMPT_HISTORY_KEY),
  shellHistory: initialInputHistory(SHELL_HISTORY_KEY),
  promptHistoryOrder: new Map(),
  shellHistoryOrder: new Map(),
  ticketInputStates: new Map(),
  activeInputIssueId: "",
  historySearch: null,
  historyNavigation: null,
  terminalFollowPaused: false,
  agentTraceHidden: true,
  rawAgentMarkdown: false,
  agentTraceHiddenByFlow: new Map(),
  rawAgentMarkdownByFlow: new Map(),
  flowDiffs: new Map(),
  flowDiffLoadingIds: new Set(),
  pendingFlowDiffRefreshes: new Map(),
  diffModalFlowId: "",
  diffModalDiff: null,
  diffModalLoadingFlowId: "",
  diffModalSelectedPath: "",
  draggingLinearIssueId: "",
  ticketDragScrollStep: 0,
  suppressTicketClick: false,
  defaultAgentDeveloperInstructions: "",
  defaultAgentProvider: "codex",
  deletingCheckoutNames: new Set(),
  deletingOutputLogIds: new Set(),
  creatingLinearTicket: false,
  githubCiSelectedFlowId: "",
};

state.lastSavedRepoConfig = "";
state.lastSavedAgentConfig = "";
state.lastSavedEnv = "";

export const els = {
  main: document.querySelector("main"),
  settingsPane: document.querySelector("#settingsPane"),
  settingsContent: document.querySelector(".settings-content"),
  settingsToggle: document.querySelector("#settingsToggle"),
  ticketDrawer: document.querySelector(".ticket-drawer"),
  ticketDrawerResizer: document.querySelector(".ticket-drawer-resizer"),
  themeToggle: document.querySelector("#themeToggle"),
  repoUrl: document.querySelector("#repoUrl"),
  serveCommand: document.querySelector("#serveCommand"),
  agentDeveloperInstructions: document.querySelector("#agentDeveloperInstructions"),
  resetAgentDeveloperInstructions: document.querySelector("#resetAgentDeveloperInstructions"),
  linearKeyForm: document.querySelector("#linearKeyForm"),
  linearApiKey: document.querySelector("#linearApiKey"),
  disconnectLinear: document.querySelector("#disconnectLinear"),
  githubKeyForm: document.querySelector("#githubKeyForm"),
  githubApiKey: document.querySelector("#githubApiKey"),
  disconnectGithub: document.querySelector("#disconnectGithub"),
  githubState: document.querySelector("#githubState"),
  refreshLinearTickets: document.querySelector("#refreshLinearTickets"),
  createLinearTicket: document.querySelector("#createLinearTicket"),
  searchLinearTickets: document.querySelector("#searchLinearTickets"),
  ticketSearchPane: document.querySelector("#ticketSearchPane"),
  ticketSearchInput: document.querySelector("#ticketSearchInput"),
  closeTicketSearch: document.querySelector("#closeTicketSearch"),
  linearState: document.querySelector("#linearState"),
  envEditor: document.querySelector("#envEditor"),
  checkoutList: document.querySelector("#checkoutList"),
  ticketState: document.querySelector("#ticketState"),
  ticketGrid: document.querySelector("#ticketGrid"),
  flowPane: document.querySelector("#flowPane"),
  agentTraceToggle: document.querySelector("#agentTraceToggle"),
  agentRawMarkdownToggle: document.querySelector("#agentRawMarkdownToggle"),
  diffModal: document.querySelector("#diffModal"),
  imagePreviewModal: document.querySelector("#imagePreviewModal"),
  toastStack: document.querySelector("#toastStack"),
};
