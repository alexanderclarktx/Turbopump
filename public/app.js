import { renderInlineMarkdown, renderLinearMarkdown } from "./linear-markdown.js";

const COLLAPSED_LINEAR_STATUSES_KEY = "flow.collapsedLinearStatuses";
const COLLAPSED_SETTINGS_SECTIONS_KEY = "flow.collapsedSettingsSections";
const PINNED_LINEAR_ISSUES_KEY = "flow.pinnedLinearIssues";
const NOTIFIED_LINEAR_ISSUES_KEY = "flow.notifiedLinearIssueIds";
const FLOW_SPLIT_SIZE_KEY = "flow.topPaneSize";
const TICKET_DRAWER_SIZE_KEY = "flow.ticketDrawerSize";
const LINEAR_PANE_HIDDEN_KEY = "flow.linearPaneHidden";
const SHELL_OUTPUT_SPLIT_SIZE_KEY = "flow.shellOutputPaneSize";
const SHELL_PANE_HIDDEN_KEY = "flow.shellPaneHidden";
const THEME_KEY = "flow.theme";
const PROMPT_HISTORY_KEY = "flow.promptHistory";
const SHELL_HISTORY_KEY = "flow.shellHistory";
const MAX_INPUT_HISTORY_ITEMS = 200;
const DEFAULT_TOAST_DURATION_MS = 3200;
const ERROR_TOAST_DURATION_MS = 8000;
const DEFAULT_FAVICON_HREF = "/favicon.svg";
const DEFAULT_COLLAPSED_LINEAR_STATUSES = ["backlog", "canceled"];
const LINEAR_STATUS_ORDER = ["in-review", "in-eng", "ready-for-eng", "triage", "backlog", "canceled"];
const LOG_PREFETCH_DELAY_MS = 750;
const LOG_PREFETCH_BATCH_SIZE = 1;
const LOG_PREFETCH_MAX_FLOW_COUNT = 3;
const GITHUB_CI_RECENT_MS = 30 * 60 * 1000;
const LOG_PAGE_SIZE = 200;
const AGENT_TRACE_INITIAL_TURN_COUNT = 6;
const AGENT_TRACE_TURN_PAGE_SIZE = 6;
const TERMINAL_TRACE_INITIAL_RENDER_COUNT = 18;
const TERMINAL_TRACE_RENDER_BATCH_SIZE = 48;
const TERMINAL_TRACE_OPEN_DURATION_MS = 90;
const TERMINAL_TRACE_CLOSE_DURATION_MS = 80;
const MARKDOWN_CODE_COPY_OFFSET = 6;
const MARKDOWN_CODE_COPY_SIZE = 24;
const MARKDOWN_TABLE_MIN_COLUMN_WIDTH = 72;
const TICKET_DRAWER_MIN_SIZE = 280;
const TICKET_DRAWER_MAX_SIZE = 320;
const TICKET_START_AGENT_FLAME_PATH =
  "M33 4C37 14 29 20 29 28C29 23 26 19 22 16C23 27 13 31 13 45C13 55 21 62 32 62S51 55 51 44C51 30 39 23 33 4Z";
const TICKET_START_AGENT_FLAME_ANIMATION_VALUES = [
  TICKET_START_AGENT_FLAME_PATH,
  "M30 4C35 14 27 20 29 28C28 23 25 19 20 16C23 27 13 31 13 45C13 55 21 62 32 62S51 55 51 44C51 30 36 23 30 4Z",
  "M36 4C39 14 31 20 29 28C30 23 27 19 24 16C23 27 13 31 13 45C13 55 21 62 32 62S51 55 51 44C51 30 42 23 36 4Z",
  TICKET_START_AGENT_FLAME_PATH,
].join(";");
const QUEUED_PROMPT_PREFIX_HTML = '<span class="queued-prompt-spinner" aria-hidden="true"></span>';
const SLASH_COMMANDS = [
  { name: "/clear", description: "Start a fresh Codex thread for this flow" },
  { name: "/compact", description: "Compact the current Codex thread context" },
  { name: "/effort", description: "Set Codex reasoning effort" },
  { name: "/fast", description: "Toggle fast mode for this flow" },
  { name: "/model", description: "Set the Codex model for this flow" },
  { name: "/review", description: "Ask Codex to review the current changes" },
];
const SLASH_COMMAND_EXPANSIONS = {
  "/effort": ["xhigh", "high", "medium", "low"].map((effort) => ({
    name: `/effort ${effort}`,
    description: "",
  })),
  "/model": ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"].map((model) => ({
    name: `/model ${model}`,
    description: "",
  })),
  "/review": [
    { name: "/review base", description: "Review against a base branch (PR style)" },
    { name: "/review uncommitted", description: "Review uncommitted changes" },
    { name: "/review commit", description: "Review a commit" },
    { name: "/review custom", description: "Custom review instructions" },
  ],
};
const SLASH_COMMANDS_WITH_ARGUMENTS = ["/review base", "/review commit", "/review custom"];

function sortSlashCommands(commands) {
  return [...commands].sort((a, b) => a.name.localeCompare(b.name));
}

function slashCommandExpansionMatches(query) {
  const exactExpansions = SLASH_COMMAND_EXPANSIONS[query];
  if (exactExpansions) return exactExpansions;
  const [command, ...args] = query.split(/\s+/);
  if (!args.length) return [];
  const expansions = SLASH_COMMAND_EXPANSIONS[command] || [];
  return expansions.filter((item) => item.name.startsWith(query));
}

function slashCommandHasExpansions(commandName) {
  return Boolean(SLASH_COMMAND_EXPANSIONS[commandName]);
}

function slashCommandAllowsArguments(commandName) {
  return SLASH_COMMANDS_WITH_ARGUMENTS.includes(commandName);
}

function validSlashCommand(value) {
  const commandName = value.trim();
  if (slashCommandHasExpansions(commandName)) return false;
  if (SORTED_SLASH_COMMANDS.some((command) => command.name === commandName)) return true;
  return Object.values(SLASH_COMMAND_EXPANSIONS).some((expansions) =>
    expansions.some(
      (command) =>
        command.name === commandName ||
        (slashCommandAllowsArguments(command.name) && commandName.startsWith(`${command.name} `)),
    ),
  );
}

const SORTED_SLASH_COMMANDS = sortSlashCommands(SLASH_COMMANDS);

function initialCollapsedLinearStatuses() {
  const raw = localStorage.getItem(COLLAPSED_LINEAR_STATUSES_KEY);
  if (raw === null) return new Set(DEFAULT_COLLAPSED_LINEAR_STATUSES);
  try {
    return new Set(JSON.parse(raw));
  } catch {
    return new Set(DEFAULT_COLLAPSED_LINEAR_STATUSES);
  }
}

function initialPinnedLinearIssues() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_LINEAR_ISSUES_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : []);
  } catch {
    return new Set();
  }
}

function initialNotifiedLinearIssues() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTIFIED_LINEAR_ISSUES_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : []);
  } catch {
    return new Set();
  }
}

function initialCollapsedSettingsSections() {
  const raw = localStorage.getItem(COLLAPSED_SETTINGS_SECTIONS_KEY);
  if (raw === null) return new Set(["checkouts"]);
  try {
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : []);
  } catch {
    return new Set(["checkouts"]);
  }
}

function initialFlowSplitSize() {
  const value = Number(localStorage.getItem(FLOW_SPLIT_SIZE_KEY) || 50);
  return clampFlowSplitSize(Number.isFinite(value) ? value : 50);
}

function initialTicketDrawerSize() {
  const value = Number(localStorage.getItem(TICKET_DRAWER_SIZE_KEY) || TICKET_DRAWER_MAX_SIZE);
  return clampTicketDrawerSize(Number.isFinite(value) ? value : TICKET_DRAWER_MAX_SIZE);
}

function initialTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialInputHistory(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim()) : [];
  } catch {
    return [];
  }
}

function emptyTicketInputState() {
  return {
    promptValue: "",
    shellValue: "",
    historySearch: null,
    historyNavigation: null,
  };
}

function clampFlowSplitSize(value) {
  return Math.min(100, Math.max(0, value));
}

function clampTicketDrawerSize(value) {
  return Math.min(TICKET_DRAWER_MAX_SIZE, Math.max(TICKET_DRAWER_MIN_SIZE, value));
}

function clampShellOutputSplitSize(value) {
  return Math.min(70, Math.max(18, value));
}

function initialShellOutputSplitSize() {
  const value = Number(localStorage.getItem(SHELL_OUTPUT_SPLIT_SIZE_KEY) || 28);
  return clampShellOutputSplitSize(Number.isFinite(value) ? value : 28);
}

function initialBooleanSetting(key) {
  return localStorage.getItem(key) === "true";
}

const state = {
  flows: [],
  checkouts: [],
  checkoutsLoaded: false,
  checkoutsLoading: false,
  linearTickets: [],
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
  slashCommandIndex: 0,
  messageSubmitting: false,
  messageSubmittingFlowId: "",
  creatingFlowIssueIds: new Set(),
  queuedPrompt: null,
  queuedPromptFlushTimer: 0,
  shellSubmitting: false,
  interruptSubmitting: false,
  shellInterruptingFlowIds: new Set(),
  pendingAgentImages: [],
  agentImageUploading: false,
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
  deletingCheckoutNames: new Set(),
  deletingOutputLogIds: new Set(),
  creatingLinearTicket: false,
  githubCiSelectedFlowId: "",
};

const els = {
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
  diffModal: document.querySelector("#diffModal"),
  imagePreviewModal: document.querySelector("#imagePreviewModal"),
  toastStack: document.querySelector("#toastStack"),
};

let repoConfigSaveTimer = 0;
let agentConfigSaveTimer = 0;
let envSaveTimer = 0;
let diffModalTransitionTimer = 0;
let diffModalScrollFrame = 0;
let imagePreviewTransitionTimer = 0;
let checkoutLoadFrame = 0;
let ticketDragScrollFrame = 0;
let lastSavedRepoConfig = "";
let lastSavedAgentConfig = "";
let lastSavedEnv = "";
let faviconSourceSvg = "";
let realtimeWs = null;
let realtimeWsOpenPromise = null;
let wsRequestId = 0;
const pendingWsRequests = new Map();
const flowSnapshotRequestingIds = new Set();
const TICKET_DRAG_SCROLL_EDGE_PX = 72;
const TICKET_DRAG_SCROLL_MAX_STEP_PX = 18;
const LINEAR_PRIORITY_OPTIONS = [
  { priority: 1, name: "Urgent" },
  { priority: 2, name: "High" },
  { priority: 3, name: "Medium" },
  { priority: 4, name: "Low" },
  { priority: 0, name: "No priority" },
];

function linearStatusName(ticket) {
  return ticket?.state?.name || "No status";
}

function linearStatusId(ticket) {
  return ticket?.state?.id || "";
}

function linearStatusType(ticket) {
  return ticket?.state?.type || "";
}

function linearPriorityValue(priority) {
  const value = Number(priority);
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 0;
}

function linearPriorityName(priority) {
  return LINEAR_PRIORITY_OPTIONS.find((option) => option.priority === linearPriorityValue(priority))?.name || "No priority";
}

function linearPriorityLabel(priority, options = {}) {
  const value = Number(priority);
  if (value === 1) return "Urgent priority";
  if (value === 2) return "High priority";
  if (value === 3) return "Medium priority";
  if (value === 4) return "Low priority";
  if (options.empty) return "No priority";
  return "";
}

function linearPriorityBarCount(priority) {
  const value = Number(priority);
  if (value === 1) return 3;
  if (value === 2) return 3;
  if (value === 3) return 2;
  if (value === 4) return 1;
  return 0;
}

function renderLinearPriorityIcon(priority, options = {}) {
  const barCount = linearPriorityBarCount(priority);
  const label = linearPriorityLabel(priority, options);
  if ((!barCount && !options.empty) || !label) return "";
  const urgent = Number(priority) === 1;
  const bars = [
    { x: 2, y: 9, height: 4 },
    { x: 7, y: 5, height: 8 },
    { x: 12, y: 1, height: 12 },
  ];
  return `
    <span class="ticket-priority${urgent ? " urgent" : ""}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}">
      <svg viewBox="0 0 16 14" aria-hidden="true" focusable="false">
        ${bars
          .map(
            (bar, index) =>
              `<rect x="${bar.x}" y="${bar.y}" width="2" height="${bar.height}" rx="1" opacity="${index < barCount ? 1 : 0.25}"></rect>`,
          )
          .join("")}
      </svg>
    </span>
  `;
}

function githubCiStatus(flow) {
  const status = String(flow?.githubCiStatus || "unknown").toLowerCase();
  if (status === "success" || status === "pending" || status === "failure") return status;
  return "unknown";
}

function githubCiLabel(status) {
  if (status === "success") return "GitHub CI passing";
  if (status === "failure") return "GitHub CI failing";
  if (status === "pending") return "GitHub CI pending";
  return "GitHub CI status unknown";
}

function githubCiStatusRecent(flow) {
  const checkedAt = Date.parse(flow?.githubCiCheckedAt || "");
  return Number.isFinite(checkedAt) && Date.now() - checkedAt <= GITHUB_CI_RECENT_MS;
}

function renderGithubCiPill(flow) {
  if (!flow?.prUrl) return "";
  const status = githubCiStatus(flow);
  const knownRecent = status !== "unknown" && githubCiStatusRecent(flow);
  const label = knownRecent ? githubCiLabel(status) : "GitHub CI status unknown";
  const title = flow.githubCiDescription || label;
  return `<a class="github-ci-pill${knownRecent ? ` github-ci-pill-${status}` : ""}" href="${escapeAttribute(flow.prUrl)}" target="_blank" rel="noreferrer" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(title)}">
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.22.48-2.69-1.07-2.69-1.07-.36-.92-.88-1.17-.88-1.17-.73-.5.05-.49.05-.49.8.06 1.22.82 1.22.82.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.58 7.58 0 0 1 8 3.89c.68 0 1.36.09 2 .27 1.52-1.03 2.19-.82 2.19-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.17c0 .21.14.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
    ${knownRecent ? '<span class="github-ci-dot" aria-hidden="true"></span>' : ""}
  </a>`;
}

function linearStatusIconKind(status, type = "") {
  const key = linearStatusKey(status);
  if (key === "triage") return "triage";
  if (key === "done" || key === "completed") return "done";
  if (key === "review" || key === "in-review" || key === "reviewing" || key === "needs-review") return "review";
  if (key === "in-eng") return "in-eng";
  const typeKey = linearStatusKey(type);
  if (typeKey === "triage") return "triage";
  if (typeKey === "backlog") return "backlog";
  if (typeKey === "unstarted") return "todo";
  if (typeKey === "started") return "started";
  if (typeKey === "completed") return "done";
  if (key === "in-progress" || key === "in-eng" || key === "working" || key === "started") return "started";
  if (key === "ready-for-eng" || key === "ready") return "started";
  if (key === "backlog") return "backlog";
  return "todo";
}

function renderLinearStatusIcon(status) {
  const label = typeof status === "object" ? linearStatusName(status) : status || "No status";
  const kind = linearStatusIconKind(label, typeof status === "object" ? linearStatusType(status) : "");
  return `
    <span class="linear-status-icon linear-status-icon-${kind}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}">
      <span class="linear-status-icon-glyph" aria-hidden="true"></span>
    </span>
  `;
}

function renderLinearStatusPillContent(status, type = "") {
  const label = status || "No status";
  const kind = linearStatusIconKind(label, type);
  return `<span>${escapeHtml(label)}</span><span class="linear-status-icon linear-status-icon-${kind}" aria-hidden="true">
    <span class="linear-status-icon-glyph" aria-hidden="true"></span>
  </span>`;
}

function linearStatusKey(status) {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "no-status";
}

function formatLastUpdated(date = new Date()) {
  return `last updated: ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function setLinearStatusCollapsed(status, collapsed) {
  const key = linearStatusKey(status);
  if (collapsed) state.collapsedLinearStatuses.add(key);
  else state.collapsedLinearStatuses.delete(key);
  localStorage.setItem(COLLAPSED_LINEAR_STATUSES_KEY, JSON.stringify([...state.collapsedLinearStatuses]));

  const group = els.ticketGrid.querySelector(`.ticket-status-group[data-status="${key}"]`);
  if (!group) {
    renderTickets();
    return;
  }
  group.dataset.collapsed = String(collapsed);
  group.querySelector(".ticket-status-separator")?.setAttribute("aria-expanded", String(!collapsed));
}

function setTicketSearchOpen(open) {
  state.ticketSearchOpen = Boolean(open);
  els.refreshLinearTickets.hidden = state.ticketSearchOpen;
  els.createLinearTicket.hidden = state.ticketSearchOpen;
  els.searchLinearTickets.hidden = state.ticketSearchOpen;
  els.ticketSearchPane.hidden = !state.ticketSearchOpen;
}

function updateRefreshLinearTicketsButton() {
  els.refreshLinearTickets.disabled = state.linearTicketsLoading;
  els.refreshLinearTickets.setAttribute("aria-busy", String(state.linearTicketsLoading));
  els.refreshLinearTickets.classList.toggle("is-loading", state.linearTicketsLoading);
}

function openTicketSearch() {
  setTicketSearchOpen(true);
  els.ticketSearchInput.value = state.ticketSearchQuery;
  renderTickets();
  requestAnimationFrame(() => {
    els.ticketSearchInput.focus({ preventScroll: true });
    els.ticketSearchInput.select();
  });
}

function closeTicketSearch() {
  state.ticketSearchQuery = "";
  els.ticketSearchInput.value = "";
  setTicketSearchOpen(false);
  renderTickets();
}

async function api(path, options = {}) {
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

function toast(message, options = {}) {
  const kind = options.kind || "info";
  const stack = els.toastStack;
  if (!stack) {
    console.log(message);
    return;
  }

  const item = document.createElement("div");
  item.className = `toast toast-${kind}`;
  item.setAttribute("role", kind === "error" ? "alert" : "status");
  item.textContent = message;
  stack.appendChild(item);

  const duration = options.duration ?? (kind === "error" ? ERROR_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS);
  window.setTimeout(() => {
    item.classList.add("toast-exiting");
    item.addEventListener("transitionend", () => item.remove(), { once: true });
    window.setTimeout(() => item.remove(), 200);
  }, duration);
}

function isGitCloneError(error) {
  return /\bgit clone failed\b/i.test(error?.message || "");
}

function slashCommandMatches(value) {
  const query = value.trimStart();
  if (!query.startsWith("/")) return [];
  const expansions = slashCommandExpansionMatches(query);
  if (expansions.length) return expansions;
  return SORTED_SLASH_COMMANDS.filter((command) => command.name.startsWith(query));
}

function inputHistoryMode(input = document.activeElement) {
  return input?.classList?.contains("shell-input") ? "shell" : "prompt";
}

function inputHistoryKey(mode = inputHistoryMode()) {
  return mode === "shell" ? SHELL_HISTORY_KEY : PROMPT_HISTORY_KEY;
}

function inputHistory(mode = inputHistoryMode()) {
  return mode === "shell" ? state.shellHistory : state.promptHistory;
}

function inputHistoryOrder(mode = inputHistoryMode()) {
  return mode === "shell" ? state.shellHistoryOrder : state.promptHistoryOrder;
}

function saveInputHistory(mode = inputHistoryMode()) {
  localStorage.setItem(inputHistoryKey(mode), JSON.stringify(inputHistory(mode)));
}

function inputHistoryLogOrder(log) {
  const timestamp = Date.parse(log.createdAt || "");
  const id = Number(log.id || 0);
  if (Number.isFinite(timestamp)) return timestamp + id / 1_000_000;
  return Number.isFinite(id) && id > 0 ? id : Date.now();
}

function sortInputHistory(mode = inputHistoryMode()) {
  const history = inputHistory(mode);
  const order = inputHistoryOrder(mode);
  history.sort((a, b) => (order.get(b) ?? 0) - (order.get(a) ?? 0));
  history.splice(MAX_INPUT_HISTORY_ITEMS);
  saveInputHistory(mode);
}

function shouldRememberInputHistoryItem(item, mode) {
  return !(mode === "prompt" && item.startsWith("/"));
}

function rememberInputHistory(value, mode = inputHistoryMode(), orderValue = Date.now()) {
  const item = value.trim();
  if (!item) return;
  if (!shouldRememberInputHistoryItem(item, mode)) return;
  const history = inputHistory(mode);
  const order = inputHistoryOrder(mode);
  const existingIndex = history.indexOf(item);
  if (existingIndex < 0) history.push(item);
  if ((order.get(item) ?? -Infinity) <= orderValue) order.set(item, orderValue);
  sortInputHistory(mode);
}

function rememberLogHistory(log) {
  const normalized = normalizeTerminalLog(log);
  const order = inputHistoryLogOrder(log);
  if (normalized.source === "user") rememberInputHistory(normalized.message, "prompt", order);
  if (normalized.source === "shell:command") rememberInputHistory(normalized.message, "shell", order);
}

function matchingInputHistory(query, mode = inputHistoryMode()) {
  const needle = query.toLowerCase();
  return inputHistory(mode).filter((item) => item.toLowerCase().includes(needle));
}

function cloneHistorySearch(search) {
  if (!search) return null;
  return {
    ...search,
    matches: [...(search.matches || [])],
  };
}

function cloneHistoryNavigation(navigation) {
  return navigation ? { ...navigation } : null;
}

function ticketInputState(issueId) {
  if (!state.ticketInputStates.has(issueId)) state.ticketInputStates.set(issueId, emptyTicketInputState());
  return state.ticketInputStates.get(issueId);
}

function saveActiveTicketInputState() {
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

function restoreTicketInputState(issueId) {
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

function queuedPromptDraftMatches(value, message = "") {
  if (!message) return true;
  return value === message || value.trim() === message.trim();
}

function clearPromptDraftForIssue(issueId, message = "") {
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

function clearQueuedPromptDraftState(flow, message = "") {
  const flowId = flow?.id || "";
  const issueId = flow?.linearIssueId || linearIssueIdForFlowId(flowId);
  if (state.queuedPrompt?.flowId === flowId) state.queuedPrompt = null;
  if (issueId) {
    clearPromptDraftForIssue(issueId, message);
  }
  if (flowId) updateFlowQueuedPrompt(flowId, null);
}

function syncTicketInputState(issueId) {
  const nextIssueId = issueId || "";
  if (state.activeInputIssueId === nextIssueId) return;
  saveActiveTicketInputState();
  state.activeInputIssueId = nextIssueId;
  restoreTicketInputState(nextIssueId);
}

function applyHistorySearchResult(input) {
  const search = state.historySearch;
  if (!search) return false;
  const result = search.matches[search.index];
  if (!result) return false;
  input.value = result;
  input.setSelectionRange(result.length, result.length);
  resizeMessageInput();
  renderSlashMenu();
  return true;
}

function resetInputHistoryNavigation() {
  state.historyNavigation = null;
}

function updateInputHistoryNavigation(input, direction) {
  const mode = inputHistoryMode(input);
  const history = inputHistory(mode);
  if (!history.length) return false;
  if (!state.historyNavigation || state.historyNavigation.mode !== mode) {
    if (direction < 0) return false;
    state.historyNavigation = {
      mode,
      draft: input.value,
      index: -1,
    };
  }
  const nextIndex = state.historyNavigation.index + direction;
  if (nextIndex < -1 || nextIndex >= history.length) return true;
  state.historyNavigation.index = nextIndex;
  const value = nextIndex === -1 ? state.historyNavigation.draft : history[nextIndex];
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  resizeMessageInput();
  hideSlashMenu();
  return true;
}

function inputCaretOnFirstLine(input) {
  const start = input.selectionStart ?? 0;
  return !input.value.slice(0, start).includes("\n");
}

function inputCaretOnLastLine(input) {
  const end = input.selectionEnd ?? input.value.length;
  return !input.value.slice(end).includes("\n");
}

function handleInputHistoryNavigationKeydown(event) {
  if (state.historySearch) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
  const input = event.currentTarget;
  const direction = event.key === "ArrowUp" ? 1 : -1;
  if (direction > 0 && !inputCaretOnFirstLine(input)) return false;
  if (direction < 0 && !state.historyNavigation && !inputCaretOnLastLine(input)) return false;
  if (!updateInputHistoryNavigation(input, direction)) return false;
  event.preventDefault();
  return true;
}

function renderHistorySearchIndicator() {
  const indicator = els.flowPane.querySelector(".history-search-indicator");
  if (!indicator) return;
  const form = els.flowPane.querySelector(".message-form");
  const search = state.historySearch;
  const terminal = els.flowPane.querySelector(".terminal");
  const shouldFollowLatest = !state.terminalFollowPaused && terminalAtLatest(terminal);
  form?.classList.toggle("history-searching", Boolean(search));
  indicator.setAttribute("aria-hidden", String(!search));
  applyFlowSplitSize();
  if (shouldFollowLatest) followTerminalToLatestDuringLayout(terminal, 160);
  if (!search) {
    indicator.textContent = "";
    indicator.dataset.mode = "";
    return;
  }
  indicator.dataset.mode = search.mode;
  const resultText = search.query && !search.matches.length ? " no match" : "";
  indicator.innerHTML = `<span class="history-search-label">i-search:</span> ${escapeHtml(search.query)}_${resultText}`;
}

function updateHistorySearchMatches(input, query) {
  const search = state.historySearch;
  if (!search) return false;
  search.query = query;
  search.matches = search.query ? matchingInputHistory(search.query, search.mode) : [];
  search.index = 0;
  renderHistorySearchIndicator();
  if (search.matches.length) {
    return applyHistorySearchResult(input);
  }
  input.value = search.query ? "" : search.draft;
  input.setSelectionRange(input.value.length, input.value.length);
  resizeMessageInput();
  renderSlashMenu();
  return true;
}

function cancelHistorySearch() {
  state.historySearch = null;
  renderHistorySearchIndicator();
}

function startOrAdvanceHistorySearch(input) {
  const mode = inputHistoryMode();
  if (!state.historySearch || state.historySearch.mode !== mode) {
    state.historySearch = {
      mode,
      query: "",
      draft: input.value,
      matches: [],
      index: 0,
    };
  } else if (state.historySearch.matches.length) {
    state.historySearch.index = Math.min(state.historySearch.index + 1, state.historySearch.matches.length - 1);
  }
  renderHistorySearchIndicator();
  return applyHistorySearchResult(input);
}

function moveHistorySearchForward(input) {
  const search = state.historySearch;
  if (!search || !search.matches.length) return false;
  search.index = Math.max(search.index - 1, 0);
  return applyHistorySearchResult(input);
}

function handleHistorySearchKeydown(event) {
  const input = event.currentTarget;
  if (event.ctrlKey && event.key.toLowerCase() === "r" && !event.metaKey && !event.altKey) {
    event.preventDefault();
    startOrAdvanceHistorySearch(input);
    return true;
  }
  if (!state.historySearch) return false;
  if (event.ctrlKey && event.key.toLowerCase() === "z" && !event.metaKey && !event.altKey) {
    event.preventDefault();
    moveHistorySearchForward(input);
    return true;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
  if (event.key === "Backspace") {
    event.preventDefault();
    updateHistorySearchMatches(input, state.historySearch.query.slice(0, -1));
    return true;
  }
  if (event.key === "Escape") {
    cancelHistorySearch();
    return true;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    cancelHistorySearch();
    return false;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    cancelHistorySearch();
    return true;
  }
  if (event.key.length === 1) {
    event.preventDefault();
    updateHistorySearchMatches(input, state.historySearch.query + event.key);
    return true;
  }
  return false;
}

function promptInput() {
  return els.flowPane.querySelector(".message-input");
}

function shellInput() {
  return els.flowPane.querySelector(".shell-input");
}

function focusInputPane(kind) {
  if (kind === "shell" && state.shellPaneHidden) return false;
  const input = kind === "shell" ? shellInput() : promptInput();
  if (!input) return false;
  cancelHistorySearch();
  resetInputHistoryNavigation();
  saveActiveTicketInputState();
  input.focus({ preventScroll: true });
  return true;
}

function focusedInputPaneKind() {
  if (document.activeElement === shellInput()) return "shell";
  if (document.activeElement === promptInput()) return "prompt";
  return "";
}

function toggleFocusedInputPane() {
  const focused = focusedInputPaneKind();
  if (focused === "shell") return focusInputPane("prompt");
  if (focused !== "prompt") return focusInputPane("prompt");
  return focusInputPane("shell") || focusInputPane("prompt");
}

function setInputMode(mode) {
  focusInputPane(mode === "command" || mode === "shell" ? "shell" : "prompt");
}

function updateMessageInputMode() {
  const input = promptInput();
  if (!input) return;
  const flow = selectedFlow();
  const queuedPrompt = queuedPromptForFlow(flow);
  const queued = Boolean(queuedPrompt);
  const queuedCanSteer = promptQueuedCanSteer(flow);
  const pane = els.flowPane.querySelector(".prompt-input-pane");
  const prefix = els.flowPane.querySelector(".prompt-input-prefix");
  const queuedHint = els.flowPane.querySelector(".queued-prompt-hint");
  const compactQueued = queued && flowAgentCompacting(flow);
  pane?.classList.toggle("prompt-queued", queued);
  if (queuedHint) {
    queuedHint.hidden = !queued || compactQueued;
    queuedHint.textContent = queuedCanSteer ? 'message queued — press "s" to steer' : "message queued";
  }
  if (prefix) {
    if (queued && !prefix.querySelector(".queued-prompt-spinner")) {
      prefix.innerHTML = QUEUED_PROMPT_PREFIX_HTML;
    } else if (!queued && prefix.textContent !== ">") {
      prefix.textContent = ">";
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

function flowRuntimeActive(flow) {
  if (hasSplitRuntimeStatus(flow)) {
    return (
      runtimeStatusActive(flow.agentRuntimeStatus) ||
      runtimeStatusActive(flow.shellRuntimeStatus) ||
      (!flow.agentRuntimeStatus && !flow.shellRuntimeStatus && runtimeStatusActive(flow.agentStatus))
    );
  }
  return runtimeStatusActive(flow?.agentStatus);
}

function flowRuntimeKind(flow) {
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

function flowAgentRunning(flow) {
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

function flowAgentCompacting(flow) {
  return flowAgentRunning(flow) && Boolean(flow?.agentCompacting);
}

function flowAgentQueuedMessage(flow) {
  return flowAgentCompacting(flow) && Boolean(flow?.agentQueuedMessage);
}

function queuedPromptForFlow(flow) {
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

function queuedPromptEntries() {
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

function promptQueuedForFlow(flow) {
  return Boolean(queuedPromptForFlow(flow));
}

function promptQueuedForSelectedFlow() {
  return promptQueuedForFlow(selectedFlow());
}

function queuedPromptIsCompact(queued) {
  const trimmed = String(queued?.message || "").trim();
  if (!trimmed.startsWith("/")) return false;
  const [command] = trimmed.split(/\s+/, 1);
  return command.toLowerCase() === "/compact";
}

function promptQueuedCanSteer(flow = selectedFlow()) {
  const queued = queuedPromptForFlow(flow);
  return Boolean(queued && !queuedPromptIsCompact(queued) && flowAgentRunning(flow) && !flowAgentCompacting(flow));
}

function flowShellRunning(flow) {
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

function flowShellLive(flow) {
  if (!flow) return false;
  const running = hasSplitRuntimeStatus(flow)
    ? flow.shellRuntimeStatus === "running"
    : flow.agentStatus === "running" && flowRuntimeKind(flow) === "shell";
  return running && !state.shellInterruptingFlowIds.has(flow.id);
}

function hasSplitRuntimeStatus(flow) {
  return Boolean(flow && ("agentRuntimeStatus" in flow || "shellRuntimeStatus" in flow));
}

function runtimeStatusActive(status) {
  return status === "running" || status === "interrupting";
}

function canSubmitPromptMessage() {
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

function canSubmitShellCommand() {
  const flow = selectedFlow();
  const ticket = selectedTicket();
  return Boolean(repoUrlConfigured() && (flow || ticket) && !state.shellSubmitting && !flowShellRunning(flow));
}

function canSwitchInputPane() {
  const flow = selectedFlow();
  const ticket = selectedTicket();
  return Boolean(repoUrlConfigured() && (flow || ticket));
}

function handleInputPaneTabKeydown(event) {
  if (event.defaultPrevented) return false;
  if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
  if (!canSwitchInputPane()) return false;
  event.preventDefault();
  if (event.repeat) return true;
  if (focusedInputPaneKind() === "prompt" && state.shellPaneHidden) {
    revealShellPaneForInputFocus();
    return true;
  }
  toggleFocusedInputPane();
  return true;
}

function focusShellInputPaneForShortcut() {
  if (!canSwitchInputPane()) return false;
  if (state.shellPaneHidden) {
    revealShellPaneForInputFocus();
    return true;
  }
  return focusInputPane("shell");
}

function flashBlockedInput(input) {
  if (!input) return;
  input.classList.remove("input-submit-blocked");
  void input.offsetWidth;
  input.classList.add("input-submit-blocked");
  window.setTimeout(() => input.classList.remove("input-submit-blocked"), 420);
}

function clearQueuedPrompt(options = {}) {
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

async function queuePromptMessage(input) {
  const flow = selectedFlow();
  if (!flow?.id || promptQueuedForFlow(flow) || !input) return false;
  const queuedImages = [...state.pendingAgentImages];
  const queuedMessage = agentMessageWithImages(
    input.value.trim() || (queuedImages.length ? "Use the attached image context." : ""),
    queuedImages,
  );
  if (!queuedMessage.trim()) return false;
  const queued = {
    flowId: flow.id,
    message: queuedMessage,
  };
  state.queuedPrompt = queued;
  state.pendingAgentImages = [];
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
    state.pendingAgentImages = [...queuedImages, ...state.pendingAgentImages];
    if (state.queuedPrompt === queued) clearQueuedPrompt({ persist: false });
    throw error;
  }
  return true;
}

async function submitQueuedPromptSteer() {
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

function handleQueuedPromptKeydown(event) {
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

function handleQueuedPromptBeforeInput(event) {
  if (!promptQueuedForSelectedFlow()) return false;
  event.preventDefault();
  flashBlockedInput(event.currentTarget);
  return true;
}

function scheduleQueuedPromptFlush() {
  if (!queuedPromptEntries().length || state.queuedPromptFlushTimer) return;
  state.queuedPromptFlushTimer = window.setTimeout(() => {
    state.queuedPromptFlushTimer = 0;
    void flushQueuedPrompt();
  }, 0);
}

async function flushQueuedPrompt() {
  if (state.messageSubmitting) return;
  for (const { queued, flow } of queuedPromptEntries()) {
    if (!queued || !flow?.id || flowAgentRunning(flow)) continue;
    await submitQueuedPromptMessage(queued, flow);
    return;
  }
}

async function submitQueuedPromptMessage(queued, flow) {
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

async function interruptSelectedFlow() {
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

async function interruptSelectedShellCommand() {
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

function isEditableKeyTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  return target.closest("[contenteditable]:not([contenteditable='false'])") !== null;
}

function shouldFocusMessageInputForKey(event) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key.length !== 1) return false;
  if (isEditableKeyTarget(event.target)) return false;
  const input = promptInput();
  return Boolean(input && document.activeElement !== input);
}

function focusMessageInputForKey(event) {
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

function handleShellInterruptKeydown(event) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (!event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== "c") return false;
  if (!flowShellRunning(selectedFlow())) return false;
  event.preventDefault();
  void interruptSelectedShellCommand();
  return true;
}

function handleAgentInterruptKeydown(event) {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (focusedInputPaneKind() !== "prompt") return false;
  if (!flowAgentRunning(selectedFlow())) return false;
  event.preventDefault();
  if (!event.repeat) void interruptSelectedFlow();
  return true;
}

function handleCommandE(event) {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "e") return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat) return true;
  toggleTheme();
  return true;
}

function handleCommandK(event) {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "k") return false;
  if (focusedInputPaneKind() !== "shell") return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!event.repeat) void submitShellCommand("clear");
  return true;
}

function handlePaneVisibilityShortcuts(event) {
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

function handleGlobalHistorySearchKeydown(event) {
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

function hideSlashMenu() {
  const menu = els.flowPane.querySelector(".slash-menu");
  menu.hidden = true;
  menu.replaceChildren();
}

function resizeMessageInput() {
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

function renderSlashMenu() {
  const input = promptInput();
  const menu = els.flowPane.querySelector(".slash-menu");
  if (!input || document.activeElement === shellInput() || promptQueuedForSelectedFlow()) {
    hideSlashMenu();
    return;
  }
  const matches = slashCommandMatches(input.value);
  if (!matches.length) {
    hideSlashMenu();
    return;
  }

  state.slashCommandIndex = Math.min(state.slashCommandIndex, matches.length - 1);
  const fragment = document.createDocumentFragment();
  matches.forEach((command, index) => {
    const button = document.createElement("button");
    button.className = `slash-command${index === state.slashCommandIndex ? " active" : ""}`;
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === state.slashCommandIndex));
    button.dataset.command = command.name;

    const name = document.createElement("span");
    name.className = "slash-command-name";
    name.textContent = command.name;

    const description = document.createElement("span");
    description.className = "slash-command-description";
    description.textContent = command.description;

    button.replaceChildren(name, description);
    fragment.appendChild(button);
  });
  menu.replaceChildren(fragment);
  menu.hidden = false;
}

function selectSlashCommand(index = state.slashCommandIndex) {
  const input = promptInput();
  if (!input) return false;
  const matches = slashCommandMatches(input.value);
  const command = matches[index];
  if (!command) return false;
  input.value = command.name;
  resizeMessageInput();
  if (slashCommandHasExpansions(command.name)) {
    state.slashCommandIndex = 0;
    renderSlashMenu();
  } else {
    hideSlashMenu();
  }
  input.focus();
  return true;
}

function repoConfigSignature() {
  return JSON.stringify({
    repoUrl: els.repoUrl.value,
    serveCommand: els.serveCommand.value,
  });
}

function agentConfigSignature() {
  return JSON.stringify({
    developerInstructions: els.agentDeveloperInstructions.value,
  });
}

function repoUrlConfigured() {
  return Boolean(els.repoUrl.value.trim());
}

function reportAutoSaveError(error) {
  console.error(error);
}

function scheduleRepoConfigSave() {
  clearTimeout(repoConfigSaveTimer);
  repoConfigSaveTimer = setTimeout(() => void saveRepoConfig().catch(reportAutoSaveError), 600);
}

function scheduleAgentConfigSave() {
  clearTimeout(agentConfigSaveTimer);
  agentConfigSaveTimer = setTimeout(() => void saveAgentConfig().catch(reportAutoSaveError), 600);
}

async function saveRepoConfig() {
  clearTimeout(repoConfigSaveTimer);
  const signature = repoConfigSignature();
  if (signature === lastSavedRepoConfig) return;
  await api("/api/repo", {
    method: "POST",
    body: JSON.stringify({
      repoUrl: els.repoUrl.value,
      serveCommand: els.serveCommand.value,
    }),
  });
  lastSavedRepoConfig = signature;
  renderFlowPane();
  toast("Repo config saved");
}

async function saveAgentConfig() {
  clearTimeout(agentConfigSaveTimer);
  const signature = agentConfigSignature();
  if (signature === lastSavedAgentConfig) return;
  await api("/api/agents", {
    method: "POST",
    body: JSON.stringify({
      developerInstructions: els.agentDeveloperInstructions.value,
    }),
  });
  lastSavedAgentConfig = signature;
  toast("Agent settings saved");
}

function scheduleEnvSave() {
  clearTimeout(envSaveTimer);
  envSaveTimer = setTimeout(() => void saveEnv().catch(reportAutoSaveError), 900);
}

function parseEnvEditorRows(contents) {
  return contents
    .split(/\r?\n/)
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) return null;
      const normalizedLine = line.startsWith("export ") ? line.slice(7).trim() : line;
      const index = normalizedLine.indexOf("=");
      if (index === -1) return null;
      const key = normalizedLine.slice(0, index).trim();
      if (!key) return null;
      let value = normalizedLine.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return { key, value };
    })
    .filter(Boolean);
}

function maskedEnvValue(value) {
  return value ? "*".repeat(value.length) : "";
}

function revealEnvValueInput(input) {
  if (!input?.classList?.contains("env-value")) return;
  input.value = input.dataset.envValue || "";
  input.dataset.envMasked = "false";
}

function maskEnvValueInput(input) {
  if (!input?.classList?.contains("env-value")) return;
  input.dataset.envValue = input.value;
  input.value = maskedEnvValue(input.dataset.envValue);
  input.dataset.envMasked = "true";
}

function createEnvValueRow(value = "", active = false) {
  const valueField = document.createElement("div");
  valueField.className = "env-value-field";
  valueField.dataset.envActive = active ? "true" : "false";

  const activeInput = document.createElement("input");
  activeInput.className = "env-active-value";
  activeInput.type = "radio";
  activeInput.setAttribute("aria-label", "Active value");

  const valueInput = document.createElement("input");
  valueInput.className = "env-value";
  valueInput.placeholder = "VALUE";
  valueInput.autocomplete = "off";
  valueInput.spellcheck = false;
  valueInput.dataset.envValue = value;
  valueInput.dataset.envMasked = "true";
  valueInput.value = maskedEnvValue(value);

  valueField.append(activeInput, valueInput);
  return valueField;
}

function createEnvRow(key = "", values = [{ value: "", active: false }]) {
  const row = document.createElement("div");
  row.className = "env-row";

  const keyField = document.createElement("div");
  keyField.className = "env-key-field";

  const keyInput = document.createElement("input");
  keyInput.className = "env-key";
  keyInput.placeholder = "KEYNAME";
  keyInput.autocomplete = "off";
  keyInput.spellcheck = false;
  keyInput.value = key;

  const addValueButton = document.createElement("button");
  addValueButton.className = "env-add-value";
  addValueButton.type = "button";
  addValueButton.setAttribute("aria-label", "Add value");
  addValueButton.title = "Add value";
  addValueButton.textContent = "+";

  const valueList = document.createElement("div");
  valueList.className = "env-values";
  for (const value of values.length ? values : [{ value: "", active: false }]) {
    valueList.append(createEnvValueRow(value.value, value.active));
  }

  keyField.append(keyInput, addValueButton);
  row.append(keyField, valueList);
  return row;
}

function envValueRowValue(valueRow) {
  const valueInput = valueRow.querySelector(".env-value");
  return valueInput?.dataset.envValue ?? valueInput?.value ?? "";
}

function envRowValues(row) {
  return {
    key: row.querySelector(".env-key")?.value.trim() || "",
    values: [...row.querySelectorAll(".env-value-field")].map((valueRow) => ({
      value: envValueRowValue(valueRow),
      active: valueRow.dataset.envActive === "true",
    })),
  };
}

function envRowIsEmpty(row) {
  const values = envRowValues(row);
  return !values.key && values.values.every((item) => !item.value);
}

function ensureTrailingEnvRow() {
  const rows = [...els.envEditor.querySelectorAll(".env-row")];
  if (!rows.length || !envRowIsEmpty(rows.at(-1))) {
    els.envEditor.append(createEnvRow());
  }
  updateEnvRowControls();
}

function updateEnvRowControls() {
  const rows = [...els.envEditor.querySelectorAll(".env-row")];
  for (const [rowIndex, row] of rows.entries()) {
    const valueRows = [...row.querySelectorAll(".env-value-field")];
    let activeValueRow = valueRows.find((valueRow) => valueRow.dataset.envActive === "true") || valueRows.at(-1);
    const hasMultipleValues = valueRows.length > 1;
    row.classList.toggle("env-has-active-choice", hasMultipleValues);
    for (const valueRow of valueRows) {
      const radio = valueRow.querySelector(".env-active-value");
      valueRow.dataset.envActive = valueRow === activeValueRow ? "true" : "false";
      if (!radio) continue;
      radio.name = `env-active-${rowIndex}`;
      radio.hidden = !hasMultipleValues;
      radio.checked = valueRow === activeValueRow;
    }
  }
}

function envEditorGroupsFromRows(rows) {
  const groups = [];
  const groupByKey = new Map();
  for (const row of rows) {
    if (!groupByKey.has(row.key)) {
      const group = { key: row.key, values: [] };
      groupByKey.set(row.key, group);
      groups.push(group);
    }
    groupByKey.get(row.key).values.push({ value: row.value, active: false });
  }
  for (const group of groups) {
    const activeValue = group.values.at(-1);
    if (activeValue) activeValue.active = true;
  }
  return groups;
}

function renderEnvEditor(contents) {
  els.envEditor.replaceChildren();
  for (const group of envEditorGroupsFromRows(parseEnvEditorRows(contents || ""))) {
    els.envEditor.append(createEnvRow(group.key, group.values));
  }
  ensureTrailingEnvRow();
}

function envEditorContents() {
  const lines = [];
  for (const row of els.envEditor.querySelectorAll(".env-row")) {
    const rowValues = envRowValues(row);
    if (!rowValues.key) continue;
    const activeValues = rowValues.values.filter((value) => value.active);
    const activeValue = activeValues.at(-1) || rowValues.values.at(-1);
    const orderedValues = [
      ...rowValues.values.filter((value) => value !== activeValue),
      ...(activeValue ? [activeValue] : []),
    ];
    for (const value of orderedValues) {
      lines.push(`${rowValues.key}=${value.value}`);
    }
  }
  return lines.join("\n");
}

async function saveEnv() {
  clearTimeout(envSaveTimer);
  const contents = envEditorContents();
  if (contents === lastSavedEnv) return;
  await api("/api/env", {
    method: "PUT",
    body: JSON.stringify({ contents }),
  });
  lastSavedEnv = contents;
}

function flushEnvSaveOnPageHide() {
  clearTimeout(envSaveTimer);
  const contents = envEditorContents();
  if (contents === lastSavedEnv) return;
  lastSavedEnv = contents;
  void fetch("/api/env", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents }),
    keepalive: true,
  }).catch(reportAutoSaveError);
}

function activateEnvValueRow(valueRow) {
  const row = valueRow?.closest(".env-row");
  if (!row) return;
  for (const candidate of row.querySelectorAll(".env-value-field")) {
    candidate.dataset.envActive = candidate === valueRow ? "true" : "false";
  }
  updateEnvRowControls();
  scheduleEnvSave();
}

function handleEnvEditorInput(event) {
  if (event.target.closest(".env-active-value")) return;
  const valueInput = event.target.closest(".env-value");
  if (valueInput) valueInput.dataset.envValue = valueInput.value;
  ensureTrailingEnvRow();
  scheduleEnvSave();
}

function handleEnvEditorChange(event) {
  const activeInput = event.target.closest(".env-active-value");
  if (!activeInput?.checked) return;
  const valueRow = activeInput.closest(".env-value-field");
  if (valueRow) activateEnvValueRow(valueRow);
}

function handleEnvEditorClick(event) {
  const activeInput = event.target.closest(".env-active-value");
  if (activeInput) {
    const valueRow = activeInput.closest(".env-value-field");
    if (valueRow) activateEnvValueRow(valueRow);
    return;
  }

  const button = event.target.closest(".env-add-value");
  if (!button) return;
  const row = button.closest(".env-row");
  if (!row) return;
  const keyInput = row?.querySelector(".env-key");
  const key = envRowValues(row).key;
  if (!key) {
    keyInput?.focus();
    return;
  }
  const nextRow = createEnvValueRow("");
  row.querySelector(".env-values")?.append(nextRow);
  ensureTrailingEnvRow();
  nextRow.querySelector(".env-value")?.focus();
  scheduleEnvSave();
}

function handleEnvEditorFocusIn(event) {
  revealEnvValueInput(event.target.closest(".env-value"));
}

function handleEnvEditorPaste(event) {
  const input = event.target.closest(".env-key, .env-value");
  const row = input?.closest(".env-row");
  if (!row || !envRowIsEmpty(row)) return;
  const pastedRows = parseEnvEditorRows(event.clipboardData?.getData("text") || "");
  if (!pastedRows.length) return;

  event.preventDefault();
  const pastedEnvRows = envEditorGroupsFromRows(pastedRows).map((group) => createEnvRow(group.key, group.values));
  row.replaceWith(...pastedEnvRows);
  ensureTrailingEnvRow();
  pastedEnvRows.at(-1)?.querySelector(".env-value")?.focus();
  scheduleEnvSave();
}

function handleEnvEditorFocusOut(event) {
  maskEnvValueInput(event.target.closest(".env-value"));
  if (event.relatedTarget && els.envEditor.contains(event.relatedTarget)) return;
  void saveEnv().catch(reportAutoSaveError);
}

function settingsSectionKey(section) {
  const label = section.querySelector(".settings-section-toggle span")?.textContent || "";
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

function applySettingsSectionState(section) {
  const key = settingsSectionKey(section);
  const collapsed = state.collapsedSettingsSections.has(key);
  section.classList.toggle("collapsed", collapsed);
  section.querySelector(".settings-section-toggle")?.setAttribute("aria-expanded", String(!collapsed));
}

function resetSettingsHorizontalScroll() {
  if (els.settingsContent.scrollLeft !== 0) els.settingsContent.scrollLeft = 0;
}

function renderSettingsSections() {
  els.settingsContent.querySelectorAll(".settings-section").forEach(applySettingsSectionState);
  resetSettingsHorizontalScroll();
}

function toggleSettingsSection(section) {
  const key = settingsSectionKey(section);
  if (!key) return;
  if (state.collapsedSettingsSections.has(key)) {
    state.collapsedSettingsSections.delete(key);
  } else {
    state.collapsedSettingsSections.add(key);
  }
  localStorage.setItem(COLLAPSED_SETTINGS_SECTIONS_KEY, JSON.stringify([...state.collapsedSettingsSections]));
  applySettingsSectionState(section);
}

function setSettingsCollapsed(collapsed) {
  state.settingsCollapsed = collapsed;
  document.body.classList.toggle("settings-collapsed", collapsed);
  els.settingsToggle.setAttribute("aria-expanded", String(!collapsed));
  els.settingsToggle.setAttribute("aria-label", "Collapse settings");
  els.settingsToggle.title = "Collapse settings";
  els.settingsPane.setAttribute("aria-label", collapsed ? "Expand settings" : "Settings");
  if (collapsed) {
    els.settingsPane.setAttribute("tabindex", "0");
    els.settingsPane.setAttribute("title", "Expand settings");
    els.settingsPane.setAttribute("role", "button");
  } else {
    els.settingsPane.removeAttribute("tabindex");
    els.settingsPane.removeAttribute("title");
    els.settingsPane.removeAttribute("role");
    resetSettingsHorizontalScroll();
    renderCheckouts();
    scheduleCheckoutsLoaded();
  }
}

function toggleSettingsCollapsed() {
  setSettingsCollapsed(!state.settingsCollapsed);
}

function setTicketDrawerHidden(hidden) {
  state.ticketDrawerHidden = hidden;
  document.body.classList.toggle("tickets-collapsed", hidden);
  els.ticketDrawer.setAttribute("aria-label", hidden ? "Expand tickets" : "Tickets");
  if (hidden) els.ticketDrawer.setAttribute("tabindex", "0");
  else els.ticketDrawer.removeAttribute("tabindex");
  applyTicketDrawerSize();
  applyFlowSplitSize();
}

function toggleTicketDrawerHidden() {
  setTicketDrawerHidden(!state.ticketDrawerHidden);
}

function applyTicketDrawerSize() {
  const applied = state.ticketDrawerHidden ? 12 : clampTicketDrawerSize(state.ticketDrawerSize);
  els.main.style.setProperty("--ticket-drawer-size", `${applied}px`);
  els.ticketDrawerResizer.setAttribute("aria-valuenow", String(Math.round(clampTicketDrawerSize(state.ticketDrawerSize))));
  return applied;
}

function setTicketDrawerSize(value) {
  state.ticketDrawerSize = clampTicketDrawerSize(value);
  applyTicketDrawerSize();
  localStorage.setItem(TICKET_DRAWER_SIZE_KEY, String(state.ticketDrawerSize));
}

function setLinearPaneHidden(hidden) {
  const restoreTerminalBottom = terminalBottomRestorer();
  if (!hidden && state.flowSplitSize <= 1) state.flowSplitSize = 50;
  state.linearPaneHidden = hidden;
  document.body.classList.toggle("linear-pane-hidden", hidden);
  const linearPanel = els.flowPane.querySelector(".linear-panel");
  const linearRail = els.flowPane.querySelector(".linear-pane-rail");
  if (linearPanel) linearPanel.setAttribute("aria-hidden", String(hidden));
  if (linearRail) linearRail.setAttribute("aria-expanded", String(!hidden));
  localStorage.setItem(LINEAR_PANE_HIDDEN_KEY, String(hidden));
  applyFlowSplitSize();
  restoreTerminalBottom();
}

function toggleLinearPaneHidden() {
  setLinearPaneHidden(!state.linearPaneHidden);
}

function setShellPaneHidden(hidden) {
  const restoreTerminalBottom = terminalBottomRestorer();
  state.shellPaneHidden = hidden;
  document.body.classList.toggle("shell-pane-hidden", hidden);
  const shellPanel = els.flowPane.querySelector(".shell-command-panel");
  const shellRail = els.flowPane.querySelector(".shell-pane-rail");
  if (shellPanel) shellPanel.setAttribute("aria-hidden", String(hidden));
  if (shellRail) shellRail.setAttribute("aria-expanded", String(!hidden));
  if (hidden && focusedInputPaneKind() === "shell") focusInputPane("prompt");
  localStorage.setItem(SHELL_PANE_HIDDEN_KEY, String(hidden));
  renderShellOutputPane(state.selectedFlowId);
  restoreTerminalBottom();
}

function toggleShellPaneHidden() {
  setShellPaneHidden(!state.shellPaneHidden);
}

function revealShellPaneForInputFocus() {
  setShellPaneHidden(false);
  focusInputPane("shell");
}

function applyTheme(theme) {
  state.theme = theme;
  const dark = theme === "dark";
  document.body.classList.toggle("theme-dark", dark);
  document.body.classList.toggle("theme-light", !dark);
  els.themeToggle.setAttribute("aria-pressed", String(dark));
  els.themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  els.themeToggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
}

function setTheme(theme) {
  applyTheme(theme);
  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

function faviconLink() {
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.append(link);
  }
  return link;
}

function notifiedFaviconSvg(source) {
  const dot = `
  <g aria-hidden="true">
    <circle cx="50" cy="54" r="9" fill="#ffff00" />
  </g>`;
  return source.includes("</svg>") ? source.replace("</svg>", `${dot}\n</svg>`) : source;
}

async function notificationFaviconHref() {
  if (state.notificationFaviconHref) return state.notificationFaviconHref;
  if (!faviconSourceSvg) faviconSourceSvg = await fetch(DEFAULT_FAVICON_HREF).then((response) => response.text());
  state.notificationFaviconHref = `data:image/svg+xml,${encodeURIComponent(notifiedFaviconSvg(faviconSourceSvg))}`;
  return state.notificationFaviconHref;
}

async function updateBrowserTabNotification() {
  const link = faviconLink();
  if (!state.notifiedLinearIssueIds.size) {
    link.href = DEFAULT_FAVICON_HREF;
    return;
  }
  if (state.notificationFaviconLoading) return;
  state.notificationFaviconLoading = true;
  try {
    link.href = await notificationFaviconHref();
  } catch {
    link.href =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='50' cy='54' r='9' fill='%23ffff00'/%3E%3C/svg%3E";
  } finally {
    state.notificationFaviconLoading = false;
  }
  if (!state.notifiedLinearIssueIds.size) link.href = DEFAULT_FAVICON_HREF;
}

function persistLinearIssueNotifications() {
  localStorage.setItem(NOTIFIED_LINEAR_ISSUES_KEY, JSON.stringify([...state.notifiedLinearIssueIds]));
}

function flowForId(flowId) {
  return state.flows.find((flow) => flow.id === flowId) || null;
}

function linearIssueIdForFlowId(flowId) {
  return flowForId(flowId)?.linearIssueId || "";
}

function clearLinearIssueNotification(identifier, options = {}) {
  if (!identifier || !state.notifiedLinearIssueIds.delete(identifier)) return false;
  persistLinearIssueNotifications();
  void updateBrowserTabNotification();
  if (options.render !== false) renderTickets();
  return true;
}

function canAcknowledgeSelectedNotification() {
  return document.visibilityState === "visible" && (typeof document.hasFocus !== "function" || document.hasFocus());
}

function acknowledgeSelectedLinearIssueNotification() {
  if (!canAcknowledgeSelectedNotification()) return;
  clearLinearIssueNotification(state.selectedLinearIssueId);
}

function notifyAgentTurnEnded(flowId) {
  const issueId = linearIssueIdForFlowId(flowId);
  if (!issueId || (issueId === state.selectedLinearIssueId && canAcknowledgeSelectedNotification())) return;
  state.notifiedLinearIssueIds.add(issueId);
  persistLinearIssueNotifications();
  void updateBrowserTabNotification();
  renderTickets();
}

function refreshFlowDiffAfterAgentTurn(flowId) {
  if (!flowId) return;
  const modalOpen = state.diffModalFlowId === flowId;
  void loadFlowDiff(flowId, { force: true, modal: modalOpen, patch: modalOpen });
}

function setDefaultSettingsState(linear) {
  setSettingsCollapsed(Boolean(linear.signedIn));
}

function flowSplitBounds(content, rect) {
  const resizer = content.querySelector(".flow-resizer");
  const messageForm = content.querySelector(".message-form");
  const minTopPx = 0;
  const resizerHeight = resizer?.getBoundingClientRect().height || 0;
  const messageFormStyle = messageForm ? getComputedStyle(messageForm) : null;
  const messageFormVisible = messageFormStyle && messageFormStyle.display !== "none";
  const messageFormHeight = messageFormVisible ? messageForm.getBoundingClientRect().height : 0;
  const maxTopPx = Math.max(minTopPx, rect.height - resizerHeight - messageFormHeight);

  return {
    min: (Math.min(rect.height, Math.max(0, minTopPx)) / rect.height) * 100,
    max: (Math.min(rect.height, Math.max(0, maxTopPx)) / rect.height) * 100,
  };
}

function appliedFlowSplitSize() {
  const content = els.flowPane.querySelector(".flow-content");
  const rect = content.getBoundingClientRect();
  if (!rect.height) return state.flowSplitSize;
  const bounds = flowSplitBounds(content, rect);
  return Math.min(bounds.max, Math.max(bounds.min, state.flowSplitSize));
}

function applyFlowSplitSize() {
  const content = els.flowPane.querySelector(".flow-content");
  const rect = content.getBoundingClientRect();
  const applied = appliedFlowSplitSize();
  const resizer = els.flowPane.querySelector(".flow-resizer");
  if (state.linearPaneHidden) {
    resizer.setAttribute("aria-valuenow", "0");
    content.style.setProperty("--top-pane-size", "0px");
    return 0;
  }
  if (rect.height) {
    const bounds = flowSplitBounds(content, rect);
    resizer.setAttribute("aria-valuemin", String(Math.round(bounds.min)));
    resizer.setAttribute("aria-valuemax", String(Math.round(bounds.max)));
  }
  resizer.setAttribute("aria-valuenow", String(Math.round(applied)));
  content.style.setProperty("--top-pane-size", `${applied}%`);
  return applied;
}

function setFlowSplitSize(value) {
  const next = clampFlowSplitSize(value);
  if (!state.linearPaneHidden && next <= 1) {
    setLinearPaneHidden(true);
    return;
  }
  state.flowSplitSize = next;
  const applied = applyFlowSplitSize();
  if (!state.linearPaneHidden) state.flowSplitSize = applied;
  localStorage.setItem(FLOW_SPLIT_SIZE_KEY, String(state.flowSplitSize));
}

function shellOutputSplitBounds(panel, rect) {
  const resizer = panel.querySelector(".shell-output-resizer");
  const resizerWidth = resizer?.getBoundingClientRect().width || 0;
  const minShellPx = Math.min(180, Math.max(80, rect.width - resizerWidth - 180));
  const maxShellPx = Math.max(minShellPx, rect.width - resizerWidth - 260);
  return {
    min: (Math.min(rect.width, Math.max(0, minShellPx)) / rect.width) * 100,
    max: (Math.min(rect.width, Math.max(0, maxShellPx)) / rect.width) * 100,
  };
}

function constrainedShellOutputSplitSize(value, bounds) {
  return Math.min(bounds.max, Math.max(bounds.min, clampShellOutputSplitSize(value)));
}

function writeShellOutputSplitSize(panel, resizer, applied, bounds) {
  if (bounds) {
    resizer.setAttribute("aria-valuemin", String(Math.round(bounds.min)));
    resizer.setAttribute("aria-valuemax", String(Math.round(bounds.max)));
  }
  resizer.setAttribute("aria-valuenow", String(Math.round(applied)));
  panel.style.setProperty("--shell-pane-size", `${applied}%`);
  return applied;
}

function appliedShellOutputSplitSize() {
  const panel = els.flowPane.querySelector(".terminal-panel");
  const rect = panel.getBoundingClientRect();
  if (!rect.width) return state.shellOutputSplitSize;
  const bounds = shellOutputSplitBounds(panel, rect);
  return constrainedShellOutputSplitSize(state.shellOutputSplitSize, bounds);
}

function applyShellOutputSplitSize() {
  const panel = els.flowPane.querySelector(".terminal-panel");
  const rect = panel.getBoundingClientRect();
  const applied = appliedShellOutputSplitSize();
  const resizer = panel.querySelector(".shell-output-resizer");
  let bounds = null;
  if (rect.width) {
    bounds = shellOutputSplitBounds(panel, rect);
  }
  return writeShellOutputSplitSize(panel, resizer, applied, bounds);
}

function setShellOutputSplitSize(value) {
  state.shellOutputSplitSize = clampShellOutputSplitSize(value);
  const applied = applyShellOutputSplitSize();
  state.shellOutputSplitSize = applied;
  localStorage.setItem(SHELL_OUTPUT_SPLIT_SIZE_KEY, String(state.shellOutputSplitSize));
}

async function bootstrap() {
  applyTheme(state.theme);
  void updateBrowserTabNotification();
  renderSettingsSections();
  setSettingsCollapsed(state.settingsCollapsed);
  setTicketDrawerSize(state.ticketDrawerSize);
  setTicketDrawerHidden(state.ticketDrawerHidden);
  setFlowSplitSize(state.flowSplitSize);
  setShellOutputSplitSize(state.shellOutputSplitSize);
  setLinearPaneHidden(state.linearPaneHidden);
  setShellPaneHidden(state.shellPaneHidden);
  requestAnimationFrame(() => document.body.classList.remove("app-booting"));
  const [data, env] = await Promise.all([api("/api/bootstrap"), api("/api/env")]);
  setFlows(data.flows);
  els.repoUrl.value = data.repo.repoUrl || "";
  els.serveCommand.value = data.repo.serveCommand || "";
  lastSavedRepoConfig = repoConfigSignature();
  els.agentDeveloperInstructions.value = data.agents.developerInstructions || "";
  state.defaultAgentDeveloperInstructions = data.agents.defaultDeveloperInstructions || "";
  lastSavedAgentConfig = agentConfigSignature();
  state.linearSignedIn = data.linear.signedIn;
  setDefaultSettingsState(data.linear);
  updateLinearState(data.linear);
  renderEnvEditor(env.contents || "");
  lastSavedEnv = envEditorContents();
  render();
  const flow = selectedFlow();
  if (flow) {
    await loadLogs(flow.id);
    void loadFlowDiff(flow.id, { force: true });
  }
  if (state.linearSignedIn) await loadLinearTickets();
  void connectWs().catch(() => {});
}

function render() {
  renderCheckouts();
  renderTickets();
  renderFlowPane();
}

function setFlows(flows, options = {}) {
  const nextFlows = flows || [];
  if (!options.preserveQueuedPromptDraft) syncClearedQueuedPromptDrafts(state.flows, nextFlows);
  const nextIds = new Set(nextFlows.map((flow) => flow.id));
  for (const flow of state.flows) {
    if (!nextIds.has(flow.id)) clearFlowClientState(flow.id);
  }
  state.flows = nextFlows;
  syncShellOutputClearState(state.flows);
  syncLinearTicketsWithFlows();
  scheduleQueuedPromptFlush();
  scheduleTicketLogPrefetch();
}

function queuedPromptMessage(flow) {
  return String(flow?.queuedPrompt?.message || "");
}

function syncClearedQueuedPromptDrafts(previousFlows, nextFlows) {
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

function clearFlowClientState(flowId) {
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
}

function syncShellOutputClearState(flows) {
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

function runtimeOnlyFlowChanges(previousFlows, nextFlows) {
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

function githubCiOnlyFlowChanges(previousFlows, nextFlows) {
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

function setCheckouts(checkouts) {
  state.checkouts = [...(checkouts || [])].sort(compareCheckouts);
}

function compareCheckouts(a, b) {
  const aTime = Date.parse(a.lastPromptAt || a.createdAt || 0);
  const bTime = Date.parse(b.lastPromptAt || b.createdAt || 0);
  return bTime - aTime || String(a.name || "").localeCompare(String(b.name || ""));
}

function formatCheckoutTimestamp(value) {
  if (!value) return "no prompts";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function loadCheckouts() {
  if (state.checkoutsLoading) return;
  state.checkoutsLoading = true;
  renderCheckouts();
  try {
    const data = await api("/api/checkouts");
    setCheckouts(data.checkouts);
    state.checkoutsLoaded = true;
  } finally {
    state.checkoutsLoading = false;
    renderCheckouts();
  }
}

async function ensureCheckoutsLoaded() {
  if (state.settingsCollapsed || state.checkoutsLoaded || state.checkoutsLoading) return;
  await loadCheckouts();
}

function scheduleCheckoutsLoaded() {
  if (checkoutLoadFrame) return;
  checkoutLoadFrame = requestAnimationFrame(() => {
    checkoutLoadFrame = requestAnimationFrame(() => {
      checkoutLoadFrame = 0;
      void ensureCheckoutsLoaded();
    });
  });
}

async function deleteCheckout(name) {
  if (!name) return;
  const data = await api(`/api/checkouts/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (data.flows) setFlows(data.flows);
  if (data.checkouts) setCheckouts(data.checkouts);
  else state.checkouts = state.checkouts.filter((checkout) => checkout.name !== name);
  render();
}

function renderCheckoutCard(checkout) {
  const card = document.createElement("article");
  card.className = "checkout-card";
  card.dataset.checkoutName = checkout.name || "";

  const title = document.createElement("div");
  title.className = "checkout-card-title";

  const ticketName = document.createElement("span");
  ticketName.className = "checkout-ticket-name";
  ticketName.textContent = checkout.ticketName || checkout.name || "Unknown worktree";

  const ticketId = document.createElement("span");
  ticketId.className = "checkout-ticket-id";
  ticketId.textContent = checkout.ticketId || checkout.name || "";

  title.replaceChildren(ticketName);

  const meta = document.createElement("dl");
  meta.className = "checkout-meta";
  const fields = [
    ["Linear", renderLinearStatusIcon(checkout.linearStatus)],
    ["Last prompt", formatCheckoutTimestamp(checkout.lastPromptAt)],
  ];
  for (const [label, value] of fields) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    if (label === "Linear") detail.innerHTML = value;
    else detail.textContent = value;
    meta.append(term, detail);
  }

  const button = document.createElement("button");
  button.className = "checkout-delete";
  button.type = "button";
  button.title = "Delete worktree";
  button.setAttribute("aria-label", `Delete worktree ${checkout.name}`);
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 15h10l1-15" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  `;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    state.deletingCheckoutNames.add(checkout.name);
    renderCheckouts();
    try {
      await deleteCheckout(checkout.name);
    } catch (error) {
      state.deletingCheckoutNames.delete(checkout.name);
      renderCheckouts();
      alert(error.message);
    }
  });

  if (state.deletingCheckoutNames.has(checkout.name)) {
    const spinner = document.createElement("span");
    spinner.className = "checkout-spinner";
    spinner.setAttribute("aria-label", `Deleting worktree ${checkout.name}`);
    spinner.setAttribute("role", "status");
    card.replaceChildren(title, ticketId, meta, spinner);
  } else {
    card.replaceChildren(title, ticketId, meta, button);
  }
  return card;
}

function renderCheckouts() {
  if (!els.checkoutList) return;
  if (state.settingsCollapsed) return;
  if (state.checkoutsLoading) {
    const loading = document.createElement("p");
    loading.className = "note";
    loading.textContent = "Loading worktrees.";
    els.checkoutList.replaceChildren(loading);
    return;
  }
  if (!state.checkoutsLoaded) {
    const pending = document.createElement("p");
    pending.className = "note";
    pending.textContent = "Open settings to load worktree directories.";
    els.checkoutList.replaceChildren(pending);
    return;
  }
  if (!state.checkouts.length) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = "No worktree directories.";
    els.checkoutList.replaceChildren(empty);
    return;
  }
  els.checkoutList.replaceChildren(...state.checkouts.map((checkout) => renderCheckoutCard(checkout)));
}

function agentModelLabel(flow) {
  if (!flow) return "unknown";
  return [
    flow.agentModel || "unknown",
    flow.agentReasoningEffort || "",
    flow.agentServiceTier === "fast" ? "fast" : "",
  ].filter(Boolean).join(" ");
}

function agentContextWindowLabel(flow) {
  const used = Number(flow?.agentContextTokensUsed || 0);
  const total = Number(flow?.agentContextWindow || 0);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return "--";
  if (used > total) return "--";
  const available = Math.max(0, total - Math.max(0, used));
  return `${Math.round((available / total) * 100)}%`;
}

function normalizeDiff(data) {
  return {
    status: data?.status || "",
    stat: data?.stat || "",
    names: data?.names || "",
    patch: data?.patch || "",
    error: data?.error || "",
    files: Array.isArray(data?.files) ? data.files : [],
    count: Number(data?.count || 0),
    additions: Number(data?.additions || 0),
    deletions: Number(data?.deletions || 0),
    baseRef: data?.baseRef || "",
  };
}

function diffText(diff) {
  return [diff?.status, diff?.stat, diff?.names, diff?.patch].filter(Boolean).join("\n").trim();
}

function diffHasChanges(diff) {
  return Boolean(diffText(diff));
}

function diffFileCount(diff) {
  if (Array.isArray(diff?.files) && diff.files.length) return diff.files.length;
  if (Number.isFinite(diff?.count) && diff.count > 0) return diff.count;
  const paths = new Set();
  for (const line of `${diff?.status || ""}\n${String(diff?.names || "").replaceAll("\0", "\n")}`.split("\n")) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    const path = parts[parts.length - 1];
    if (path) paths.add(path);
  }
  return paths.size;
}

function ensureDiffIndicatorCount(button, kind, className, prefix) {
  let count = button.querySelector(`.diff-count[data-kind="${kind}"]`);
  if (count) return count;
  count = document.createElement("span");
  count.className = `${className} diff-count`;
  count.dataset.kind = kind;
  const prefixNode = document.createElement("span");
  prefixNode.className = "diff-count-prefix";
  prefixNode.setAttribute("aria-hidden", "true");
  prefixNode.textContent = prefix;
  const digits = document.createElement("span");
  digits.className = "diff-count-digits";
  digits.setAttribute("aria-hidden", "true");
  count.append(prefixNode, digits);
  button.append(count);
  return count;
}

function appendDiffCountDigit(container, previousChar, nextChar, direction, animate) {
  const digit = document.createElement("span");
  digit.className = "diff-count-digit";
  const visibleNextChar = nextChar === " " ? "" : nextChar;
  if (!animate || previousChar === nextChar) {
    digit.textContent = visibleNextChar;
    container.append(digit);
    return;
  }

  const stack = document.createElement("span");
  stack.className = `diff-count-digit-stack ${direction > 0 ? "is-up" : "is-down"}`;
  const oldValue = document.createElement("span");
  const newValue = document.createElement("span");
  oldValue.textContent = previousChar === " " ? "" : previousChar;
  newValue.textContent = visibleNextChar;
  if (direction > 0) {
    stack.append(oldValue, newValue);
  } else {
    stack.append(newValue, oldValue);
  }
  digit.append(stack);
  container.append(digit);
}

function updateDiffIndicatorCount(button, kind, className, prefix, value) {
  const count = ensureDiffIndicatorCount(button, kind, className, prefix);
  const digits = count.querySelector(".diff-count-digits");
  const numericValue = Number(value || 0);
  const nextValue = Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
  const nextText = String(nextValue);
  const previousText = count.dataset.value;
  const shouldAnimate = previousText !== undefined && previousText !== nextText;
  const previousNumber = Number(previousText);
  const direction = Number.isFinite(previousNumber) && nextValue < previousNumber ? -1 : 1;
  const width = nextText.length;
  const previousDigits = (previousText || nextText).padStart(width, " ").slice(-width);
  const nextDigits = nextText.padStart(width, " ");
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < width; index += 1) {
    appendDiffCountDigit(fragment, previousDigits[index], nextDigits[index], direction, shouldAnimate);
  }

  count.dataset.value = nextText;
  count.setAttribute("aria-label", `${prefix}${nextText}`);
  digits.replaceChildren(fragment);
}

function renderDiffIndicator(button, flowId, diff) {
  if (button.dataset.flowId !== (flowId || "")) {
    button.replaceChildren();
    button.dataset.flowId = flowId || "";
  }

  const additions = Number(diff?.additions || 0);
  const deletions = Number(diff?.deletions || 0);
  if (!additions && !deletions && !diffFileCount(diff)) {
    button.replaceChildren();
    return;
  }

  updateDiffIndicatorCount(button, "additions", "diff-additions", "+", additions);
  updateDiffIndicatorCount(button, "deletions", "diff-deletions", "-", deletions);
}

function diffCountLabel(value, prefix) {
  if (value === null || value === undefined || value === "") return "";
  const count = Number(value);
  return Number.isFinite(count) ? `${prefix}${count}` : "";
}

function diffLoadingKey(flowId, options = {}) {
  return `${flowId}:${options.patch ? "patch" : "summary"}`;
}

function rememberPendingFlowDiffRefresh(flowId, options = {}) {
  const loadingKey = diffLoadingKey(flowId, options);
  const pending = state.pendingFlowDiffRefreshes.get(loadingKey) || {};
  state.pendingFlowDiffRefreshes.set(loadingKey, {
    ...pending,
    ...options,
    force: true,
    patch: Boolean(pending.patch || options.patch),
    modal: Boolean(pending.modal || options.modal),
  });
}

async function loadFlowDiff(flowId, options = {}) {
  if (!flowId) return null;
  const existing = state.flowDiffs.get(flowId);
  if (!options.force && existing && (!options.patch || existing.patch)) {
    if (options.modal && state.diffModalFlowId === flowId) {
      state.diffModalDiff = { ...existing };
      state.diffModalLoadingFlowId = "";
      renderDiffModal();
    }
    return existing;
  }
  const loadingKey = diffLoadingKey(flowId, options);
  if (state.flowDiffLoadingIds.has(loadingKey)) {
    if (options.force) rememberPendingFlowDiffRefresh(flowId, options);
    return state.flowDiffs.get(flowId) || null;
  }
  state.flowDiffLoadingIds.add(loadingKey);
  if (options.modal && state.diffModalFlowId === flowId) {
    state.diffModalLoadingFlowId = flowId;
    renderDiffModal();
  }
  renderAgentContext(selectedFlow());
  try {
    const diff = normalizeDiff(await api(`/api/flows/${encodeURIComponent(flowId)}/diff${options.patch ? "?patch=1" : ""}`));
    const latest = state.flowDiffs.get(flowId);
    if (!options.patch && !options.force && latest?.patch) diff.patch = latest.patch;
    state.flowDiffs.set(flowId, diff);
    if (options.modal && state.diffModalFlowId === flowId) {
      state.diffModalDiff = { ...diff };
      state.diffModalLoadingFlowId = "";
      renderDiffModal();
    }
    return diff;
  } catch (error) {
    const diff = normalizeDiff({ error: error.message || String(error) });
    state.flowDiffs.set(flowId, diff);
    if (options.modal && state.diffModalFlowId === flowId) {
      state.diffModalDiff = { ...diff };
      state.diffModalLoadingFlowId = "";
      renderDiffModal();
    }
    return diff;
  } finally {
    state.flowDiffLoadingIds.delete(loadingKey);
    renderAgentContext(selectedFlow());
    const pending = state.pendingFlowDiffRefreshes.get(loadingKey);
    if (pending) {
      state.pendingFlowDiffRefreshes.delete(loadingKey);
      void loadFlowDiff(flowId, pending);
    }
  }
}

function renderAgentContext(flow) {
  const context = els.flowPane.querySelector(".agent-context");
  const branch = context.querySelector(".agent-context-branch");
  const diffButton = context.querySelector(".agent-context-diff");
  const diff = flow?.id ? state.flowDiffs.get(flow.id) : null;
  context.hidden = !flow;
  context.querySelector(".agent-context-window").textContent = agentContextWindowLabel(flow);
  context.querySelector(".agent-context-model").textContent = agentModelLabel(flow);
  diffButton.hidden = !flow || !diffHasChanges(diff);
  renderDiffIndicator(diffButton, flow?.id || "", diff);
  diffButton.title = "Open diff viewer";
  diffButton.disabled = !flow;
  diffButton.onclick = flow ? () => openDiffViewer(flow.id) : null;
  const branchName = flow?.branchName || "";
  branch.textContent = branchName;
  if (flow?.prUrl) {
    branch.href = flow.prUrl;
    branch.target = "_blank";
    branch.rel = "noreferrer";
    branch.title = flow.prUrl;
    branch.onclick = null;
    branch.onkeydown = null;
    branch.removeAttribute("role");
    branch.removeAttribute("tabindex");
    branch.removeAttribute("aria-label");
  } else {
    branch.removeAttribute("href");
    branch.removeAttribute("target");
    branch.removeAttribute("rel");
    branch.title = branchName ? "Copy branch name" : "";
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

function openDiffViewer(flowId) {
  state.diffModalFlowId = flowId || "";
  state.diffModalDiff = flowId && state.flowDiffs.get(flowId) ? { ...state.flowDiffs.get(flowId) } : null;
  state.diffModalLoadingFlowId = flowId || "";
  state.diffModalSelectedPath = "";
  renderDiffModal();
  if (flowId) void loadFlowDiff(flowId, { patch: true, modal: true, force: true });
}

function closeDiffViewer() {
  state.diffModalFlowId = "";
  state.diffModalDiff = null;
  state.diffModalLoadingFlowId = "";
  state.diffModalSelectedPath = "";
  renderDiffModal();
}

function showDiffModal() {
  clearTimeout(diffModalTransitionTimer);
  els.diffModal.hidden = false;
  els.diffModal.classList.remove("is-closing");
  requestAnimationFrame(() => els.diffModal.classList.add("is-open"));
}

function hideDiffModal() {
  clearTimeout(diffModalTransitionTimer);
  els.diffModal.classList.remove("is-open");
  els.diffModal.classList.add("is-closing");
  diffModalTransitionTimer = setTimeout(() => {
    if (state.diffModalFlowId) return;
    els.diffModal.hidden = true;
    els.diffModal.classList.remove("is-closing");
  }, 180);
}

function openImagePreview(src, alt = "") {
  if (!els.imagePreviewModal || !src) return;
  clearTimeout(imagePreviewTransitionTimer);
  const image = els.imagePreviewModal.querySelector(".image-preview-frame img");
  const title = els.imagePreviewModal.querySelector("#imagePreviewTitle");
  image.src = src;
  image.alt = alt;
  title.textContent = alt || "Image preview";
  els.imagePreviewModal.hidden = false;
  els.imagePreviewModal.classList.remove("is-closing");
  requestAnimationFrame(() => els.imagePreviewModal.classList.add("is-open"));
}

function closeImagePreview() {
  if (!els.imagePreviewModal || els.imagePreviewModal.hidden) return;
  clearTimeout(imagePreviewTransitionTimer);
  els.imagePreviewModal.classList.remove("is-open");
  els.imagePreviewModal.classList.add("is-closing");
  imagePreviewTransitionTimer = setTimeout(() => {
    const image = els.imagePreviewModal.querySelector(".image-preview-frame img");
    image.removeAttribute("src");
    image.alt = "";
    els.imagePreviewModal.hidden = true;
    els.imagePreviewModal.classList.remove("is-closing");
  }, 180);
}

function handleImagePreviewClick(event) {
  const link = event.target.closest?.("a[data-image-preview]");
  if (!link) return;
  event.preventDefault();
  openImagePreview(link.href, link.dataset.imagePreviewAlt || link.querySelector("img")?.alt || "");
}

function diffLineClass(line) {
  if (/^(diff --git|index |new file mode|deleted file mode|similarity index|rename from|rename to)/.test(line)) return "diff-line-meta";
  if (/^(@@|\+\+\+|---)/.test(line)) return "diff-line-coord";
  if (line.startsWith("+")) return "diff-line-inserted";
  if (line.startsWith("-")) return "diff-line-deleted";
  return "";
}

function shouldHideDiffLine(line) {
  return /^(diff --git|index |\+\+\+ |--- |new file mode|deleted file mode|similarity index|rename from|rename to)/.test(line);
}

function diffFilePathFromHeader(line) {
  const pathStart = line.lastIndexOf(" b/");
  return pathStart >= 0 ? line.slice(pathStart + 3).trim() : "";
}

function diffPatchFilePaths(text) {
  const paths = [];
  const seen = new Set();
  for (const line of String(text || "").split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    const path = diffFilePathFromHeader(line);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function orderedDiffFiles(diff) {
  const files = Array.isArray(diff?.files) ? diff.files.filter((file) => file?.path) : [];
  const patchPaths = diffPatchFilePaths(diff?.patch || "");
  if (!patchPaths.length) return files;
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const usedPaths = new Set();
  const ordered = [];
  for (const path of patchPaths) {
    const file = filesByPath.get(path) || { path, additions: null, deletions: null };
    ordered.push(file);
    usedPaths.add(file.path);
  }
  for (const file of files) {
    if (!usedPaths.has(file.path)) ordered.push(file);
  }
  return ordered;
}

function diffHunkLineState(line) {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return { oldLine: Number(match[1]), newLine: Number(match[2]) };
}

function appendDiffLine(fragment, line, lineState) {
  const row = document.createElement("span");
  row.className = "diff-code-line";

  const oldNumber = document.createElement("span");
  oldNumber.className = "diff-line-number";

  const newNumber = document.createElement("span");
  newNumber.className = "diff-line-number";

  const text = document.createElement("span");
  const className = diffLineClass(line);
  text.className = `diff-line-text${className ? ` ${className}` : ""}`;
  text.textContent = line;

  if (lineState && line.startsWith("@@")) {
    const hunkState = diffHunkLineState(line);
    if (hunkState) {
      lineState.oldLine = hunkState.oldLine;
      lineState.newLine = hunkState.newLine;
    }
  } else if (lineState && line.startsWith("+")) {
    newNumber.textContent = String(lineState.newLine);
    lineState.newLine += 1;
  } else if (lineState && line.startsWith("-")) {
    oldNumber.textContent = String(lineState.oldLine);
    lineState.oldLine += 1;
  } else if (lineState && lineState.oldLine && lineState.newLine) {
    oldNumber.textContent = String(lineState.oldLine);
    newNumber.textContent = String(lineState.newLine);
    lineState.oldLine += 1;
    lineState.newLine += 1;
  }

  row.append(oldNumber, newNumber, text);
  fragment.appendChild(row);
}

function renderDiffCode(code, text, selectedPath = "") {
  code.className = "language-diff diff-code";
  code.replaceChildren();
  if (!text) return;
  const fragment = document.createDocumentFragment();
  const lines = String(text).split("\n");
  let fileDividerCount = 0;
  const lineState = { oldLine: 0, newLine: 0 };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const filePath = diffFilePathFromHeader(line);
      if (filePath) {
        const anchor = document.createElement("span");
        anchor.className = "diff-file-anchor";
        anchor.dataset.diffPath = filePath;
        fragment.appendChild(anchor);

        const divider = document.createElement("span");
        divider.className = `diff-file-divider${fileDividerCount ? "" : " is-first"}`;
        divider.dataset.diffPath = filePath;
        divider.classList.toggle("is-selected", filePath === selectedPath);
        divider.textContent = filePath;
        fragment.appendChild(divider);
        fileDividerCount += 1;
        lineState.oldLine = 0;
        lineState.newLine = 0;
      }
      continue;
    }
    if (shouldHideDiffLine(line)) continue;
    appendDiffLine(fragment, line, lineState);
  }
  code.appendChild(fragment);
}

function setSelectedDiffFile(path, options = {}) {
  if (!path) return;
  state.diffModalSelectedPath = path;
  const modal = els.diffModal;
  if (!modal) return;
  let selectedRow = null;
  for (const row of modal.querySelectorAll(".diff-summary-file")) {
    const selected = row.dataset.diffPath === path;
    row.classList.toggle("is-selected", selected);
    row.setAttribute("aria-current", selected ? "true" : "false");
    if (selected) selectedRow = row;
  }
  for (const divider of modal.querySelectorAll(".diff-file-divider")) {
    divider.classList.toggle("is-selected", divider.dataset.diffPath === path);
  }
  if (options.revealSummary && selectedRow) selectedRow.scrollIntoView({ block: "nearest" });
  if (!options.scroll) return;
  scrollDiffFileIntoView(path);
}

function scrollDiffFileIntoView(path) {
  const scroller = els.diffModal?.querySelector(".diff-modal-code");
  if (!scroller) return;
  const target = [...scroller.querySelectorAll(".diff-file-anchor")].find((anchor) => anchor.dataset.diffPath === path);
  if (!target) return;
  const paddingTop = Number.parseFloat(getComputedStyle(scroller).paddingTop) || 0;
  scroller.scrollTop = Math.max(0, target.offsetTop - paddingTop - 8);
}

function selectedDiffFileFromScroll() {
  const scroller = els.diffModal?.querySelector(".diff-modal-code");
  if (!scroller) return "";
  const dividers = [...scroller.querySelectorAll(".diff-file-divider")];
  if (!dividers.length) return "";
  const scrollerTop = scroller.getBoundingClientRect().top;
  let selectedPath = dividers[0].dataset.diffPath || "";
  for (const divider of dividers) {
    if (divider.getBoundingClientRect().top > scrollerTop + 24) break;
    selectedPath = divider.dataset.diffPath || selectedPath;
  }
  return selectedPath;
}

function syncSelectedDiffFileFromScroll() {
  diffModalScrollFrame = 0;
  const path = selectedDiffFileFromScroll();
  if (path && path !== state.diffModalSelectedPath) setSelectedDiffFile(path, { revealSummary: true });
}

function scheduleSelectedDiffFileSync() {
  if (diffModalScrollFrame) return;
  diffModalScrollFrame = requestAnimationFrame(syncSelectedDiffFileFromScroll);
}

function renderDiffSummary(summary, diff, loading, selectedPath = "") {
  summary.replaceChildren();
  if (loading || diff?.error) {
    summary.textContent = loading ? "Loading diff..." : diff.error;
    return;
  }
  const files = orderedDiffFiles(diff);
  if (!files.length) {
    summary.textContent = diff?.stat?.trim() || diff?.names?.trim() || diff?.status?.trim() || "No diff.";
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const file of files) {
    const row = document.createElement("button");
    row.className = "diff-summary-file";
    row.type = "button";
    row.dataset.diffPath = file.path;
    row.classList.toggle("is-selected", file.path === selectedPath);
    row.setAttribute("aria-current", file.path === selectedPath ? "true" : "false");

    const path = document.createElement("span");
    path.className = "diff-summary-path";
    path.textContent = file.path;

    const counts = document.createElement("span");
    counts.className = "diff-summary-counts";

    const additions = document.createElement("span");
    additions.className = "diff-additions";
    additions.textContent = diffCountLabel(file.additions, "+");

    const deletions = document.createElement("span");
    deletions.className = "diff-deletions";
    deletions.textContent = diffCountLabel(file.deletions, "-");

    counts.append(additions, deletions);
    row.append(counts, path);
    fragment.appendChild(row);
  }
  summary.appendChild(fragment);
}

function renderDiffModal() {
  if (!els.diffModal) return;
  const flowId = state.diffModalFlowId;
  if (!flowId) {
    hideDiffModal();
    return;
  }
  showDiffModal();
  const flow = state.flows.find((item) => item.id === flowId);
  const diff = state.diffModalDiff;
  const loading = state.diffModalLoadingFlowId === flowId && !diff?.patch;
  const summary = els.diffModal.querySelector(".diff-modal-summary");
  const code = els.diffModal.querySelector(".diff-modal-code code");
  const files = orderedDiffFiles(diff);
  const selectedPath = files.some((file) => file.path === state.diffModalSelectedPath)
    ? state.diffModalSelectedPath
    : files[0]?.path || "";
  state.diffModalSelectedPath = selectedPath;
  els.diffModal.querySelector(".diff-modal")?.setAttribute("aria-label", `${flow?.linearIssueId || "Flow"} diff`);
  renderDiffSummary(summary, diff, loading, selectedPath);
  renderDiffCode(code, loading ? "" : diff?.patch?.trim() || diff?.names?.trim() || diff?.status?.trim() || "", selectedPath);
}

function appendLogEntry(log) {
  const flowId = log.flowId;
  const id = Number(log.id || Date.now());
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
    list.push(entry);
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

function upsertFlow(flow) {
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

function updateFlowQueuedPrompt(flowId, queuedPrompt, options = {}) {
  if (!flowId) return;
  const index = state.flows.findIndex((item) => item.id === flowId);
  if (index === -1) return;
  const next = [...state.flows];
  next[index] = { ...next[index], queuedPrompt };
  setFlows(next, options);
}

function flowUpdatedAtMs(flow) {
  const timestamp = Date.parse(flow?.updatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function linearIssueUpdatedAtMs(issue) {
  const timestamp = Date.parse(issue?.updatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeLinearIssue(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const existingUpdatedAt = linearIssueUpdatedAtMs(existing);
  const incomingUpdatedAt = linearIssueUpdatedAtMs(incoming);
  const merged = { ...existing, ...incoming };
  if (existingUpdatedAt && incomingUpdatedAt && existingUpdatedAt > incomingUpdatedAt) {
    return {
      ...merged,
      title: existing.title,
      url: existing.url,
      priority: existing.priority,
      estimate: existing.estimate,
      updatedAt: existing.updatedAt,
      state: existing.state,
      team: existing.team,
      project: existing.project,
      labels: existing.labels,
    };
  }
  return merged;
}

function syncLinearTicketsWithFlows() {
  if (!state.linearTickets.length) return;
  const flowsByIssue = new Map(state.flows.map((flow) => [flow.linearIssueId, flow]));
  state.linearTickets = state.linearTickets.map((ticket) => {
    const flow = flowsByIssue.get(ticket.identifier);
    const flowId = flow?.id || "";
    if (ticket.flowId === flowId) return ticket;
    return { ...ticket, flowId };
  });
}

function clearSelectedLinearIssue(identifier) {
  if (state.selectedLinearIssueId !== identifier || flowForLinearIssue(identifier)) return;
  state.selectedLinearIssueId = "";
  localStorage.removeItem("flow.selectedLinearIssueId");
}

function removeLinearIssueFromTurbopump(identifier) {
  if (!identifier) return false;
  const issueId = String(identifier).toUpperCase();
  const previousLength = state.linearTickets.length;
  state.linearTickets = state.linearTickets.filter((ticket) => ticket.identifier !== issueId);
  state.linearDetails.delete(issueId);
  state.ticketInputStates.delete(issueId);
  clearLinearIssueNotification(issueId, { render: false });
  const removedPin = state.pinnedLinearIssues.delete(issueId);
  if (removedPin) persistPinnedLinearIssues();
  clearSelectedLinearIssue(issueId);
  return removedPin || state.linearTickets.length !== previousLength;
}

function reconcileRemovedLinearTickets(previousTickets, nextTickets) {
  const nextIssueIds = new Set(nextTickets.map((ticket) => ticket.identifier));
  for (const ticket of previousTickets) {
    if (!nextIssueIds.has(ticket.identifier)) removeLinearIssueFromTurbopump(ticket.identifier);
  }
}

function updateLinearState(linear) {
  state.linearSignedIn = Boolean(linear.signedIn);
  state.linearViewerName = linear.viewerName || state.linearViewer?.name || "";
  els.linearState.textContent = state.linearSignedIn
    ? linear.viewerName
      ? `Linear connected: ${linear.viewerName}`
      : "Linear connected"
    : "Linear disconnected";
  els.linearState.classList.toggle("live", state.linearSignedIn);
  els.linearKeyForm.classList.toggle("hidden", state.linearSignedIn);
  els.ticketState.textContent = state.linearSignedIn
    ? "Loading assigned tickets."
    : "Add a Linear API key in settings to load assigned tickets.";
}

async function loadLinearTickets(options = {}) {
  if (state.linearTicketsLoading) return;
  state.linearTicketsLoading = true;
  updateRefreshLinearTicketsButton();
  try {
    els.ticketState.textContent = "Loading assigned tickets.";
    const data = await api("/api/linear/issues");
    const previousTickets = state.linearTickets;
    const nextTickets = data.issues || [];
    state.linearViewer = data.viewer;
    state.linearViewerName = data.viewer?.name || state.linearViewerName;
    reconcileRemovedLinearTickets(previousTickets, nextTickets);
    state.linearTickets = nextTickets;
    state.linearTicketsLoaded = true;
    state.logPrefetchFailedFlowIds.clear();
    state.logPrefetchedFlowCount = 0;
    if (options.refreshDetails) state.linearDetails.clear();
    syncLinearTicketsWithFlows();
    els.ticketState.textContent = data.cached ? "Showing cached tickets." : formatLastUpdated();
    els.linearState.textContent = data.cached ? "Linear unavailable; using cached tickets" : `Linear connected: ${data.viewer.name}`;
    els.linearState.classList.toggle("live", !data.cached);
    if (!state.settingsCollapsed && state.checkoutsLoaded) await loadCheckouts();
    renderTickets();
    renderFlowPane();
    scheduleTicketLogPrefetch();
  } catch (error) {
    state.linearTicketsLoaded = true;
    syncLinearTicketsWithFlows();
    renderTickets();
    renderFlowPane();
    els.ticketState.textContent = state.linearTickets.length ? `Showing cached tickets. ${error.message}` : error.message;
    els.linearState.textContent = "Linear needs attention";
    els.linearState.classList.remove("live");
  } finally {
    state.linearTicketsLoading = false;
    updateRefreshLinearTicketsButton();
  }
}

function renderTickets() {
  const tickets = sortedLinearTickets(state.linearTickets);
  const searchQuery = normalizedTicketSearchQuery();
  const pinnedTickets = orderedPinnedTickets(tickets).filter((ticket) => !searchQuery || ticketMatchesTicketSearch(ticket, searchQuery));
  const groups = groupedTicketsByLinearStatus(tickets.filter((ticket) => !isLinearIssuePinned(ticket.identifier)));
  const ticketGroups = searchQuery
    ? groups.map((group) => ({
        ...group,
        collapsed: false,
        tickets: group.tickets.filter((ticket) => ticketMatchesTicketSearch(ticket, searchQuery)),
      }))
    : groups;
  const signature = tickets
    .map((ticket) =>
      [
        ticket.identifier,
        ticket.title,
        linearStatusId(ticket),
        linearStatusName(ticket),
        linearStatusType(ticket),
        ticket.priority || "",
        ticket.project?.name || "",
        ticket.flowId || "",
      ].join("\u001f"),
    )
    .join("\u001e")
    .concat("\u001d", [...state.collapsedLinearStatuses].sort().join("\u001f"))
    .concat("\u001d", [...state.pinnedLinearIssues].join("\u001f"))
    .concat("\u001d", state.ticketSearchOpen ? "search-open" : "search-closed", "\u001f", searchQuery)
    .concat("\u001d", state.selectedLinearIssueId);

  if (els.ticketGrid.dataset.ticketSignature === signature) {
    for (const card of els.ticketGrid.querySelectorAll(".ticket-card")) {
      updateTicketCardState(card);
    }
    return;
  }

  els.ticketGrid.dataset.ticketSignature = signature;

  const nodes = [renderPinnedTicketGroup(pinnedTickets)];
  for (const group of ticketGroups) {
    nodes.push(renderTicketStatusGroup(group));
  }
  els.ticketGrid.replaceChildren(...nodes);
}

function normalizedTicketSearchQuery() {
  return state.ticketSearchQuery.trim().toLowerCase();
}

function ticketMatchesTicketSearch(ticket, query) {
  return String(ticket.title || "").toLowerCase().includes(query);
}

function ticketHasAgentSession(ticket) {
  return Boolean(ticket.flowId);
}

function linearPrioritySortRank(priority) {
  const value = Number(priority);
  if (value >= 1 && value <= 4) return value;
  return 5;
}

function compareLinearTickets(a, b) {
  return (
    Number(ticketHasAgentSession(b)) - Number(ticketHasAgentSession(a)) ||
    linearPrioritySortRank(a.priority) - linearPrioritySortRank(b.priority)
  );
}

function sortedLinearTickets(tickets) {
  return [...tickets].sort(compareLinearTickets);
}

function orderedPinnedTickets(tickets) {
  const ticketsByIdentifier = new Map(tickets.map((ticket) => [ticket.identifier, ticket]));
  return [...state.pinnedLinearIssues].map((identifier) => ticketsByIdentifier.get(identifier)).filter(Boolean);
}

function groupedTicketsByLinearStatus(tickets) {
  const groups = [];
  const byKey = new Map();
  for (const ticket of tickets) {
    const status = linearStatusName(ticket);
    const key = linearStatusKey(status);
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        stateId: linearStatusId(ticket),
        status,
        type: linearStatusType(ticket),
        tickets: [],
        collapsed: state.collapsedLinearStatuses.has(key),
      };
      byKey.set(key, group);
      groups.push(group);
    } else if (!group.stateId) {
      group.stateId = linearStatusId(ticket);
      group.type = linearStatusType(ticket);
    }
    group.tickets.push(ticket);
  }
  return groups.sort((a, b) => linearStatusRank(a.key) - linearStatusRank(b.key) || a.status.localeCompare(b.status));
}

function linearStatusRank(key) {
  const rank = LINEAR_STATUS_ORDER.indexOf(key);
  if (rank !== -1) return rank;
  return LINEAR_STATUS_ORDER.length - 1;
}

function renderTicketStatusGroup(group) {
  const section = document.createElement("section");
  section.className = "ticket-status-group";
  section.dataset.status = group.key;
  section.dataset.stateId = group.stateId;
  section.dataset.collapsed = String(group.collapsed);
  const selectedTicketVisible = group.collapsed && group.tickets.some((ticket) => ticket.identifier === state.selectedLinearIssueId);
  section.dataset.selectedTicketVisible = String(selectedTicketVisible);
  section.addEventListener("dragenter", (event) => handleTicketStatusDragEnter(event, group));
  section.addEventListener("dragover", (event) => handleTicketStatusDragOver(event, group));
  section.addEventListener("dragleave", handleTicketStatusDragLeave);
  section.addEventListener("drop", (event) => handleTicketStatusDrop(event, group));

  const body = document.createElement("div");
  body.className = "ticket-status-group-body";
  const items = document.createElement("div");
  items.className = "ticket-status-group-items";
  const visibleTickets = selectedTicketVisible
    ? group.tickets.filter((ticket) => ticket.identifier === state.selectedLinearIssueId)
    : group.tickets;
  items.replaceChildren(...visibleTickets.map((ticket) => renderTicketCard(ticket)));
  body.append(items);

  section.append(renderTicketStatusSeparator(group), body);
  return section;
}

function renderPinnedTicketGroup(tickets) {
  const section = document.createElement("section");
  section.className = "ticket-status-group pinned-ticket-group";
  section.addEventListener("dragenter", handlePinnedTicketDragEnter);
  section.addEventListener("dragover", handlePinnedTicketDragOver);
  section.addEventListener("dragleave", handleTicketStatusDragLeave);
  section.addEventListener("drop", handlePinnedTicketDrop);

  const separator = document.createElement("div");
  separator.className = "ticket-status-separator pinned-ticket-separator";
  separator.innerHTML = `
    <svg class="ticket-pinned-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9L12 3.5Z" />
    </svg>
    <span class="ticket-status-label">Pinned</span>
    <span class="ticket-status-count">${tickets.length}</span>
  `;

  const body = document.createElement("div");
  body.className = "ticket-status-group-body";
  const items = document.createElement("div");
  items.className = "ticket-status-group-items";
  items.replaceChildren(...tickets.map((ticket) => renderTicketCard(ticket)));
  body.append(items);

  section.append(separator, body);
  return section;
}

function renderTicketStatusSeparator(group) {
  const separator = document.createElement("button");
  separator.className = "ticket-status-separator";
  separator.type = "button";
  separator.dataset.status = group.key;
  separator.setAttribute("aria-expanded", String(!group.collapsed));
  separator.innerHTML = `
    <span class="ticket-status-label">${escapeHtml(group.status)}</span>
    <span class="ticket-status-count">${group.tickets.length}</span>
  `;
  separator.addEventListener("click", () => {
    setLinearStatusCollapsed(group.status, !state.collapsedLinearStatuses.has(group.key));
  });
  return separator;
}

function linearStatusOptions(issue = null, fallbackStatus = null) {
  const byStateId = new Map();
  const addStatus = (stateId, status, type = "") => {
    if (!stateId || !status || byStateId.has(stateId)) return;
    byStateId.set(stateId, {
      stateId,
      status,
      type,
      key: linearStatusKey(status),
    });
  };
  const addIssueStatus = (item) => {
    addStatus(linearStatusId(item), linearStatusName(item), linearStatusType(item));
  };
  state.linearTickets.forEach(addIssueStatus);
  if (issue) addIssueStatus(issue);
  if (fallbackStatus) addStatus(fallbackStatus.stateId, fallbackStatus.status, fallbackStatus.type);
  return [...byStateId.values()].sort((a, b) => linearStatusRank(a.key) - linearStatusRank(b.key) || a.status.localeCompare(b.status));
}

function renderLinearStatusControl(issue, statusName) {
  const issueId = issue.identifier || state.selectedLinearIssueId;
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  const currentStateId = linearStatusId(issue) || linearStatusId(ticket);
  const currentStatusType = linearStatusType(issue) || linearStatusType(ticket);
  if (!issueId || !statusName) return "";
  const options = linearStatusOptions(issue, { stateId: currentStateId, status: statusName, type: currentStatusType }).filter((option) => option.stateId !== currentStateId);
  const optionButtons = options
    .map(
      (option, index) =>
        `<button class="linear-status-option" type="button" data-linear-status-option="true" data-issue="${escapeAttribute(issueId)}" data-state-id="${escapeAttribute(option.stateId)}" data-status="${escapeAttribute(option.status)}" style="--linear-status-option-index: ${index};">${renderLinearStatusPillContent(option.status, option.type)}</button>`,
    )
    .join("");
  return `<span class="linear-status-control">
    <button class="linear-status-pill" type="button" data-linear-status-pill="true" data-issue="${escapeAttribute(issueId)}" title="Change Linear status" aria-haspopup="${options.length ? "true" : "false"}">${renderLinearStatusPillContent(statusName, currentStatusType)}</button>
    ${options.length ? `<span class="linear-status-options" aria-label="Linear status options">${optionButtons}</span>` : ""}
  </span>`;
}

function renderLinearPriorityControl(issue) {
  const issueId = issue.identifier || state.selectedLinearIssueId;
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  const currentPriority = linearPriorityValue(issue.priority ?? ticket?.priority);
  if (!issueId) return "";
  const options = LINEAR_PRIORITY_OPTIONS.filter((option) => option.priority !== currentPriority);
  const currentIcon = renderLinearPriorityIcon(currentPriority, { empty: true });
  const currentName = linearPriorityName(currentPriority);
  const optionButtons = options
    .map((option, index) => {
      const icon = renderLinearPriorityIcon(option.priority, { empty: true });
      return `<button class="linear-priority-option" type="button" data-linear-priority-option="true" data-issue="${escapeAttribute(issueId)}" data-priority="${option.priority}" title="${escapeAttribute(option.name)}" aria-label="${escapeAttribute(option.name)}" style="--linear-priority-option-index: ${index};">${icon}</button>`;
    })
    .join("");
  return `<span class="linear-priority-control">
    <button class="linear-priority-pill" type="button" data-linear-priority-pill="true" data-issue="${escapeAttribute(issueId)}" title="Change Linear priority" aria-label="${escapeAttribute(currentName)}" aria-haspopup="true">${currentIcon}</button>
    <span class="linear-priority-options" aria-label="Linear priority options">${optionButtons}</span>
  </span>`;
}

function renderLinearPinButton(issue) {
  const issueId = issue.identifier || state.selectedLinearIssueId;
  if (!issueId) return "";
  const pinned = isLinearIssuePinned(issueId);
  const label = pinned ? "Unpin Linear ticket" : "Pin Linear ticket";
  return `<button class="linear-pin-toggle${pinned ? " active" : ""}" type="button" data-linear-pin-toggle="true" data-issue="${escapeAttribute(issueId)}" aria-label="${label}" title="${label}" aria-pressed="${pinned}">
    <svg class="linear-pin-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m12 2.75 2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.31l-5.7 3 1.09-6.35-4.62-4.5 6.38-.93L12 2.75Z" />
    </svg>
  </button>`;
}

function updateLinearPinButtons(issueId) {
  const pinned = isLinearIssuePinned(issueId);
  const label = pinned ? "Unpin Linear ticket" : "Pin Linear ticket";
  for (const button of els.flowPane.querySelectorAll("[data-linear-pin-toggle]")) {
    if (button.dataset.issue !== issueId) continue;
    button.classList.toggle("active", pinned);
    button.setAttribute("aria-pressed", String(pinned));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }
}

function handleLinearDetailClick(event) {
  if (!(event.target instanceof Element)) return;
  const copyButton = event.target.closest("[data-code-copy]");
  if (copyButton && els.flowPane.contains(copyButton)) {
    event.preventDefault();
    event.stopPropagation();
    void copyMarkdownCodeBlock(copyButton);
    return;
  }

  const pinButton = event.target.closest("[data-linear-pin-toggle]");
  if (pinButton && els.flowPane.contains(pinButton)) {
    event.preventDefault();
    event.stopPropagation();
    const issueId = pinButton.dataset.issue || "";
    if (!issueId) return;
    const pinned = !isLinearIssuePinned(issueId);
    setLinearIssuePinned(issueId, pinned, pinned ? { position: "top" } : {});
    updateLinearPinButtons(issueId);
    return;
  }

  const priorityButton = event.target.closest("[data-linear-priority-option]");
  if (priorityButton && els.flowPane.contains(priorityButton)) {
    event.preventDefault();
    const issueId = priorityButton.dataset.issue || "";
    const priority = Number(priorityButton.dataset.priority);
    if (!issueId || !Number.isInteger(priority)) {
      renderFlowPane();
      return;
    }
    void moveTicketToLinearPriority(issueId, priority);
    return;
  }

  const button = event.target.closest("[data-linear-status-option]");
  if (!button || !els.flowPane.contains(button)) return;
  event.preventDefault();
  const issueId = button.dataset.issue || "";
  const stateId = button.dataset.stateId || "";
  const status = button.dataset.status || button.textContent || "";
  if (!issueId || !stateId || !status) {
    renderFlowPane();
    return;
  }
  void moveTicketToLinearStatus(issueId, { stateId, status });
}

function isLinearIssuePinned(identifier) {
  return state.pinnedLinearIssues.has(identifier);
}

function persistPinnedLinearIssues() {
  localStorage.setItem(PINNED_LINEAR_ISSUES_KEY, JSON.stringify([...state.pinnedLinearIssues]));
}

function setPinnedLinearIssueOrder(identifiers) {
  const knownIssueIds = new Set(state.linearTickets.map((ticket) => ticket.identifier));
  const nextPinnedIssueIds = identifiers.filter((identifier) => knownIssueIds.has(identifier));
  for (const identifier of state.pinnedLinearIssues) {
    if (knownIssueIds.has(identifier) && !nextPinnedIssueIds.includes(identifier)) nextPinnedIssueIds.push(identifier);
  }
  state.pinnedLinearIssues = new Set(nextPinnedIssueIds);
  persistPinnedLinearIssues();
}

function moveLinearIssueToPinnedPosition(identifier, index) {
  const pinnedIssueIds = [...state.pinnedLinearIssues].filter((issueId) => issueId !== identifier);
  const insertionIndex = Math.max(0, Math.min(index, pinnedIssueIds.length));
  pinnedIssueIds.splice(insertionIndex, 0, identifier);
  setPinnedLinearIssueOrder(pinnedIssueIds);
  renderTickets();
}

function setLinearIssuePinned(identifier, pinned, options = {}) {
  if (pinned && options.position === "top") {
    state.pinnedLinearIssues = new Set([identifier, ...[...state.pinnedLinearIssues].filter((issueId) => issueId !== identifier)]);
  } else if (pinned) state.pinnedLinearIssues.add(identifier);
  else state.pinnedLinearIssues.delete(identifier);
  persistPinnedLinearIssues();
  renderTickets();
}

function focusLinearTicketCard(identifier) {
  requestAnimationFrame(() => {
    const card = [...els.ticketGrid.querySelectorAll(".ticket-card")].find((item) => item.dataset.issue === identifier);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
  });
}

function upsertLinearIssue(issue) {
  const existing = state.linearTickets.find((ticket) => ticket.identifier === issue.identifier);
  if (!existing) {
    state.linearTickets = [issue, ...state.linearTickets];
    return;
  }
  state.linearTickets = state.linearTickets.map((ticket) => {
    if (ticket.identifier !== issue.identifier) return ticket;
    return {
      ...mergeLinearIssue(ticket, issue),
      flowId: issue.flowId || ticket.flowId || "",
    };
  });
}

function ticketCanMoveToStatus(issueId, group) {
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  return Boolean(ticket && group.stateId && (isLinearIssuePinned(issueId) || linearStatusId(ticket) !== group.stateId));
}

function ticketWouldHighlightStatusGroup(issueId, group) {
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  return Boolean(ticket && group.stateId && linearStatusId(ticket) !== group.stateId);
}

function setTicketStatusGroupDragOver(groupElement, active) {
  groupElement.classList.toggle("drag-over", active);
}

function ticketDragScrollStep(event) {
  if (!state.draggingLinearIssueId) return 0;
  const grid = els.ticketGrid;
  const rect = grid.getBoundingClientRect();
  const maxScrollTop = grid.scrollHeight - grid.clientHeight;
  const topDistance = event.clientY - rect.top;
  const bottomDistance = rect.bottom - event.clientY;
  if (topDistance < TICKET_DRAG_SCROLL_EDGE_PX && grid.scrollTop > 0) {
    const edgeProgress = Math.min(1, (TICKET_DRAG_SCROLL_EDGE_PX - topDistance) / TICKET_DRAG_SCROLL_EDGE_PX);
    return -TICKET_DRAG_SCROLL_MAX_STEP_PX * edgeProgress;
  }
  if (bottomDistance < TICKET_DRAG_SCROLL_EDGE_PX && grid.scrollTop < maxScrollTop) {
    const edgeProgress = Math.min(1, (TICKET_DRAG_SCROLL_EDGE_PX - bottomDistance) / TICKET_DRAG_SCROLL_EDGE_PX);
    return TICKET_DRAG_SCROLL_MAX_STEP_PX * edgeProgress;
  }
  return 0;
}

function stopTicketDragAutoScroll() {
  if (ticketDragScrollFrame) cancelAnimationFrame(ticketDragScrollFrame);
  ticketDragScrollFrame = 0;
  state.ticketDragScrollStep = 0;
}

function runTicketDragAutoScroll() {
  ticketDragScrollFrame = 0;
  if (!state.draggingLinearIssueId || !state.ticketDragScrollStep) return;
  els.ticketGrid.scrollTop += state.ticketDragScrollStep;
  ticketDragScrollFrame = requestAnimationFrame(runTicketDragAutoScroll);
}

function updateTicketDragAutoScroll(event) {
  state.ticketDragScrollStep = ticketDragScrollStep(event);
  if (!state.ticketDragScrollStep) {
    stopTicketDragAutoScroll();
    return;
  }
  if (!ticketDragScrollFrame) ticketDragScrollFrame = requestAnimationFrame(runTicketDragAutoScroll);
}

function clearTicketDragState() {
  state.draggingLinearIssueId = "";
  stopTicketDragAutoScroll();
  for (const element of els.ticketGrid.querySelectorAll(".ticket-status-group.drag-over, .ticket-card.dragging, .ticket-card.drop-before, .ticket-card.drop-after")) {
    element.classList.remove("drag-over", "dragging", "drop-before", "drop-after");
  }
}

function handleTicketStatusDragEnter(event, group) {
  if (!ticketCanMoveToStatus(state.draggingLinearIssueId, group)) {
    setTicketStatusGroupDragOver(event.currentTarget, false);
    return;
  }
  event.preventDefault();
  setTicketStatusGroupDragOver(event.currentTarget, ticketWouldHighlightStatusGroup(state.draggingLinearIssueId, group));
}

function handleTicketStatusDragOver(event, group) {
  updateTicketDragAutoScroll(event);
  if (!ticketCanMoveToStatus(state.draggingLinearIssueId, group)) {
    setTicketStatusGroupDragOver(event.currentTarget, false);
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  setTicketStatusGroupDragOver(event.currentTarget, ticketWouldHighlightStatusGroup(state.draggingLinearIssueId, group));
}

function handleTicketStatusDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  setTicketStatusGroupDragOver(event.currentTarget, false);
}

function handleTicketStatusDrop(event, group) {
  const issueId = state.draggingLinearIssueId || event.dataTransfer.getData("text/plain");
  if (!ticketCanMoveToStatus(issueId, group)) return;
  event.preventDefault();
  clearTicketDragState();
  if (isLinearIssuePinned(issueId)) {
    state.pinnedLinearIssues.delete(issueId);
    persistPinnedLinearIssues();
  }
  if (linearStatusId(state.linearTickets.find((item) => item.identifier === issueId)) === group.stateId) {
    renderTickets();
    return;
  }
  void moveTicketToLinearStatus(issueId, group);
}

function ticketCanMoveToPinned(issueId) {
  return Boolean(state.linearTickets.some((ticket) => ticket.identifier === issueId));
}

function ticketWouldHighlightPinnedGroup(issueId) {
  return ticketCanMoveToPinned(issueId) && !isLinearIssuePinned(issueId);
}

function clearPinnedTicketDropTarget(section) {
  for (const card of section.querySelectorAll(".ticket-card.drop-before, .ticket-card.drop-after")) {
    card.classList.remove("drop-before", "drop-after");
  }
}

function pinnedTicketDropIndex(event) {
  const cards = [...event.currentTarget.querySelectorAll(".ticket-card.pinned:not(.dragging)")];
  for (const [index, card] of cards.entries()) {
    const rect = card.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) return index;
  }
  return cards.length;
}

function updatePinnedTicketDropTarget(event) {
  const section = event.currentTarget;
  clearPinnedTicketDropTarget(section);
  const cards = [...section.querySelectorAll(".ticket-card.pinned:not(.dragging)")];
  if (!cards.length) return;
  const index = pinnedTicketDropIndex(event);
  const target = cards[Math.min(index, cards.length - 1)];
  target.classList.add(index >= cards.length ? "drop-after" : "drop-before");
}

function handlePinnedTicketDragEnter(event) {
  if (!ticketCanMoveToPinned(state.draggingLinearIssueId)) return;
  event.preventDefault();
  setTicketStatusGroupDragOver(event.currentTarget, ticketWouldHighlightPinnedGroup(state.draggingLinearIssueId));
}

function handlePinnedTicketDragOver(event) {
  updateTicketDragAutoScroll(event);
  if (!ticketCanMoveToPinned(state.draggingLinearIssueId)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  setTicketStatusGroupDragOver(event.currentTarget, ticketWouldHighlightPinnedGroup(state.draggingLinearIssueId));
  updatePinnedTicketDropTarget(event);
}

function handleTicketGridDragOver(event) {
  if (!state.draggingLinearIssueId) return;
  updateTicketDragAutoScroll(event);
}

function handlePinnedTicketDrop(event) {
  const issueId = state.draggingLinearIssueId || event.dataTransfer.getData("text/plain");
  if (!ticketCanMoveToPinned(issueId)) return;
  const index = pinnedTicketDropIndex(event);
  event.preventDefault();
  clearTicketDragState();
  moveLinearIssueToPinnedPosition(issueId, index);
}

function replaceLinearIssue(issue) {
  upsertLinearIssue(issue);

  const cached = state.linearDetails.get(issue.identifier);
  if (cached) {
    state.linearDetails.set(issue.identifier, {
      ...cached,
      loading: false,
      issue: mergeLinearIssue(cached.issue, issue),
    });
  }
}

async function moveTicketToLinearStatus(issueId, group) {
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  if (!ticket || !group.stateId || linearStatusId(ticket) === group.stateId) return;

  const previousTickets = state.linearTickets;
  const previousDetail = state.linearDetails.get(issueId);
  replaceLinearIssue({
    ...ticket,
    state: {
      ...(ticket.state || {}),
      id: group.stateId,
      name: group.status,
      type: group.type || ticket.state?.type,
    },
  });
  renderTickets();
  renderFlowPane();
  els.ticketState.textContent = `Moving ${issueId} to ${group.status}.`;

  try {
    const data = await api(`/api/linear/issues/${encodeURIComponent(issueId)}/status`, {
      method: "POST",
      body: JSON.stringify({ issueId: ticket.id, stateId: group.stateId }),
    });
    if (data.issue) replaceLinearIssue(data.issue);
    if (data.flow) upsertFlow(data.flow);
    syncLinearTicketsWithFlows();
    renderTickets();
    renderFlowPane();
    focusLinearTicketCard(issueId);
    els.ticketState.textContent = formatLastUpdated();
  } catch (error) {
    state.linearTickets = previousTickets;
    if (previousDetail) state.linearDetails.set(issueId, previousDetail);
    else state.linearDetails.delete(issueId);
    renderTickets();
    renderFlowPane();
    els.ticketState.textContent = error.message;
  }
}

async function moveTicketToLinearPriority(issueId, priority) {
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  const detailIssue = state.linearDetails.get(issueId)?.issue;
  const issue = ticket || detailIssue;
  const nextPriority = linearPriorityValue(priority);
  if (!issue || linearPriorityValue(issue.priority) === nextPriority) return;

  const previousTickets = state.linearTickets;
  const previousDetail = state.linearDetails.get(issueId);
  replaceLinearIssue({
    ...issue,
    priority: nextPriority,
  });
  renderTickets();
  renderFlowPane();
  els.ticketState.textContent = `Changing ${issueId} priority to ${linearPriorityName(nextPriority)}.`;

  try {
    const data = await api(`/api/linear/issues/${encodeURIComponent(issueId)}/priority`, {
      method: "POST",
      body: JSON.stringify({ issueId: issue.id, priority: nextPriority }),
    });
    if (data.issue) replaceLinearIssue(data.issue);
    renderTickets();
    renderFlowPane();
    focusLinearTicketCard(issueId);
    els.ticketState.textContent = formatLastUpdated();
  } catch (error) {
    state.linearTickets = previousTickets;
    if (previousDetail) state.linearDetails.set(issueId, previousDetail);
    else state.linearDetails.delete(issueId);
    renderTickets();
    renderFlowPane();
    els.ticketState.textContent = error.message;
  }
}

async function createPinnedLinearTicket() {
  if (state.creatingLinearTicket) return;
  state.creatingLinearTicket = true;
  els.createLinearTicket.disabled = true;
  els.ticketState.textContent = "Creating In Eng ticket.";

  try {
    const data = await api("/api/linear/issues", { method: "POST" });
    const issue = data.issue;
    if (!issue?.identifier) throw new Error("Linear did not return the created issue.");
    upsertLinearIssue(issue);
    state.selectedLinearIssueId = issue.identifier;
    localStorage.setItem("flow.selectedLinearIssueId", issue.identifier);
    state.linearDetails.set(issue.identifier, { loading: false, issue });
    syncLinearTicketsWithFlows();
    setLinearIssuePinned(issue.identifier, true, { position: "top" });
    renderFlowPane();
    focusLinearTicketCard(issue.identifier);
    els.ticketState.textContent = formatLastUpdated();
  } catch (error) {
    els.ticketState.textContent = error.message;
    toast(error.message, { kind: "error" });
  } finally {
    state.creatingLinearTicket = false;
    els.createLinearTicket.disabled = false;
  }
}

function ticketAgentWorking(ticket) {
  const flow = flowForTicket(ticket);
  return Boolean(
    repoUrlConfigured() &&
      flow &&
      (flowAgentRunning(flow) || state.messageSubmittingFlowId === flow.id),
  );
}

function ticketFlowCreating(ticket) {
  return Boolean(ticket?.identifier && state.creatingFlowIssueIds.has(ticket.identifier));
}

function ticketShellRunning(ticket) {
  return flowShellLive(flowForTicket(ticket));
}

function updateTicketCardState(card) {
  const ticket = state.linearTickets.find((item) => item.identifier === card.dataset.issue);
  const active = card.dataset.issue === state.selectedLinearIssueId;
  card.classList.toggle("active", active);
  card.classList.toggle("agent-turn-active", ticketAgentWorking(ticket));
  card.classList.toggle("creating-flow", ticketFlowCreating(ticket));
  card.classList.toggle("shell-command-active", ticketShellRunning(ticket));
  card.classList.toggle("agent-turn-notified", !active && state.notifiedLinearIssueIds.has(card.dataset.issue));
  card.classList.toggle("pinned", isLinearIssuePinned(card.dataset.issue));
}

function updateTicketCardsForIdentifiers(...identifiers) {
  const issueIds = new Set(identifiers.filter(Boolean));
  if (!issueIds.size) return;
  for (const card of els.ticketGrid.querySelectorAll(".ticket-card")) {
    if (issueIds.has(card.dataset.issue)) updateTicketCardState(card);
  }
}

function ticketInCollapsedStatusGroup(identifier) {
  const ticket = state.linearTickets.find((item) => item.identifier === identifier);
  return Boolean(ticket && !isLinearIssuePinned(identifier) && state.collapsedLinearStatuses.has(linearStatusKey(linearStatusName(ticket))));
}

function updateTicketSelectionCards(previousIssueId, nextIssueId) {
  if (ticketInCollapsedStatusGroup(previousIssueId) || ticketInCollapsedStatusGroup(nextIssueId)) {
    renderTickets();
    return;
  }
  updateTicketCardsForIdentifiers(previousIssueId, nextIssueId);
}

function loadSelectedFlowLogs(issueId, flowId, options = {}) {
  return loadLogs(flowId, options).catch((error) => {
    if (issueId === state.selectedLinearIssueId && flowId === state.selectedFlowId) {
      toast(error.message || "Could not load agent session.", { kind: "error" });
    }
  });
}

function scheduleSelectedFlowPaneRender(issueId, flowId = "") {
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

function animateTicketSwitch() {
  const content = els.flowPane.querySelector(".flow-content");
  if (!content) return;
  if (state.ticketSwitchFadeTimer) window.clearTimeout(state.ticketSwitchFadeTimer);
  content.classList.remove("ticket-switch-fade-in");
  void content.offsetWidth;
  content.classList.add("ticket-switch-fade-in");
  state.ticketSwitchFadeTimer = window.setTimeout(() => {
    content.classList.remove("ticket-switch-fade-in");
    state.ticketSwitchFadeTimer = 0;
  }, 120);
}

function renderTicketCard(ticket) {
  const card = document.createElement("article");
  const creatingFlow = ticketFlowCreating(ticket);
  card.className = "ticket-card";
  card.classList.toggle("in-flow", Boolean(ticket.flowId));
  card.classList.toggle("can-start-agent", !ticket.flowId && !creatingFlow);
  card.classList.toggle("creating-flow", creatingFlow);
  card.tabIndex = 0;
  card.role = "button";
  card.draggable = true;
  card.dataset.issue = ticket.identifier;
  const projectName = ticket.project?.name ? escapeHtml(ticket.project.name) : "";
  card.innerHTML = `
    <span class="ticket-id">${escapeHtml(ticket.identifier)}</span>
    <p class="ticket-title">${escapeHtml(ticket.title)}</p>
    <div class="ticket-meta">
      ${renderLinearStatusIcon(ticket)}
      ${renderLinearPriorityIcon(ticket.priority)}
      ${projectName ? `<span class="ticket-project">${projectName}</span>` : ""}
    </div>
    ${
      ticket.flowId
        ? `<div class="ticket-flow-corner"><img class="ticket-flow-mark" src="${DEFAULT_FAVICON_HREF}" alt="In flow" title="In flow"></div>`
        : creatingFlow
          ? renderTicketCreatingFlowIndicator(ticket)
          : renderTicketStartAgentButton(ticket)
    }
  `;
  updateTicketCardState(card);
  const startAgentButton = card.querySelector("[data-ticket-start-agent]");
  startAgentButton?.addEventListener("mouseenter", () => updateTicketStartAgentAnimation(startAgentButton));
  startAgentButton?.addEventListener("mouseleave", () => updateTicketStartAgentAnimation(startAgentButton));
  startAgentButton?.addEventListener("focus", () => updateTicketStartAgentAnimation(startAgentButton));
  startAgentButton?.addEventListener("blur", () => updateTicketStartAgentAnimation(startAgentButton));
  startAgentButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void startTicketAgentSession(ticket);
  });
  card.addEventListener("dragstart", (event) => {
    state.draggingLinearIssueId = ticket.identifier;
    state.suppressTicketClick = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ticket.identifier);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    clearTicketDragState();
    setTimeout(() => {
      state.suppressTicketClick = false;
    }, 0);
  });
  card.addEventListener("click", () => {
    if (state.suppressTicketClick) return;
    void openTicketInFlowPane(ticket);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openTicketInFlowPane(ticket);
  });
  return card;
}

function renderTicketStartAgentButton(ticket) {
  return `<button class="ticket-flow-corner ticket-flow-start" type="button" data-ticket-start-agent="true" data-issue="${escapeAttribute(ticket.identifier)}" aria-label="Start agent session">
    <svg class="ticket-flow-start-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="${TICKET_START_AGENT_FLAME_PATH}">
        <animate class="ticket-flow-start-shape" attributeName="d" values="${TICKET_START_AGENT_FLAME_ANIMATION_VALUES}" dur="1.8s" repeatCount="indefinite" begin="indefinite" />
      </path>
    </svg>
  </button>`;
}

function renderTicketCreatingFlowIndicator(ticket) {
  return `<div class="ticket-flow-corner ticket-flow-creating" role="status" aria-label="Creating flow for ${escapeAttribute(ticket.identifier)}">
    <span class="flow-create-spinner" aria-hidden="true"></span>
  </div>`;
}

function updateTicketStartAgentAnimation(button) {
  const animation = button.querySelector(".ticket-flow-start-shape");
  const path = button.querySelector(".ticket-flow-start-icon path");
  const active = button.matches(":hover, :focus-visible");
  if (button.dataset.animationActive === String(active)) return;
  button.dataset.animationActive = String(active);
  if (active) {
    animation?.beginElement?.();
    return;
  }
  animation?.endElement?.();
  path?.setAttribute("d", TICKET_START_AGENT_FLAME_PATH);
}

function selectedFlow() {
  return state.flows.find((flow) => flow.id === state.selectedFlowId) || flowForLinearIssue(state.selectedLinearIssueId);
}

function selectedTicket() {
  return state.linearTickets.find((ticket) => ticket.identifier === state.selectedLinearIssueId) || null;
}

function flowForLinearIssue(identifier) {
  if (!identifier) return null;
  return state.flows.find((flow) => flow.linearIssueId === identifier) || null;
}

function flowForTicket(ticket) {
  if (!ticket) return null;
  return (ticket.flowId ? state.flows.find((flow) => flow.id === ticket.flowId) : null) || flowForLinearIssue(ticket.identifier);
}

function syncSelectedGithubCiFlow(flow) {
  const flowId = flow?.prUrl ? flow.id : "";
  if (state.githubCiSelectedFlowId === flowId) return;
  state.githubCiSelectedFlowId = flowId;
  void wsRequest("selected-github-flow", { flowId }).catch(() => {});
}

async function selectFlow(id) {
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

async function openTicketInFlowPane(ticket) {
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

async function startTicketAgentSession(ticket) {
  if (!ticket?.identifier) return;
  setLinearIssuePinned(ticket.identifier, true, { position: "top" });
  await openTicketInFlowPane(ticket);
  const input = promptInput();
  input.value = "get started on this. open a pr if you have a changeset";
  resizeMessageInput();
  saveActiveTicketInputState();
  await submitPromptMessage();
}

function renderFlowPane(options = {}) {
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
  renderAgentContext(flow);
  renderAgentImageContext();
  if (!issueId) {
    return;
  }

  const messageForm = els.flowPane.querySelector(".message-form");
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
  if (!options.light) void loadLinearDetail(issueId);
  scheduleQueuedPromptFlush();
}

function renderAgentImageContext() {
  const container = els.flowPane.querySelector(".agent-image-context");
  if (!container) return;
  const images = state.pendingAgentImages;
  container.hidden = !images.length && !state.agentImageUploading;
  const uploading = state.agentImageUploading ? '<span class="agent-image-chip pending">uploading...</span>' : "";
  container.innerHTML = `${images
    .map((image, index) => renderAgentImageChip(image, { index }))
    .join("")}${uploading}`;
}

function renderAgentImageChip(image, options = {}) {
  const label = image.name || imageLabelFromPath(image.relativePath || image.path) || "image";
  const removable = options.index !== undefined;
  return `
    <span class="agent-image-chip" title="${escapeAttribute(image.path || label)}">
      <span>${escapeHtml(label)}</span>
      ${removable ? `<button type="button" aria-label="Remove image" data-index="${options.index}">×</button>` : ""}
    </span>
  `;
}

function imageLabelFromPath(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "";
}

function agentMessageWithImages(message, images = state.pendingAgentImages) {
  if (!images.length) return message;
  const attachments = images
    .map((image) => {
      const name = image.name ? `${image.name}: ` : "";
      return `- ${name}${image.path}${image.relativePath ? ` (${image.relativePath})` : ""}`;
    })
    .join("\n");
  return `${message}\n\nAttached images:\n${attachments}`;
}

function droppedImageFiles(event) {
  const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
  if (files.length) return files;
  return [...(event.dataTransfer?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function pastedImageFiles(event) {
  const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
  if (files.length) return files;
  return [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function eventHasDraggedFiles(event) {
  const types = [...(event.dataTransfer?.types || [])];
  if (types.includes("Files")) return true;
  return [...(event.dataTransfer?.items || [])].some((item) => item.kind === "file");
}

function eventTargetsPromptInputPane(event) {
  return Boolean(event.target?.closest?.(".prompt-input-pane"));
}

function focusPromptInputForImageDrag(event) {
  if (eventTargetsPromptInputPane(event)) focusInputPane("prompt");
}

function setAgentImageDragActive(active) {
  document.body.classList.toggle("agent-image-drag-active", active);
  promptInput().classList.toggle("drag-over", active);
}

async function uploadAgentImages(files) {
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

function linearCommentParentId(comment) {
  return comment.parent?.id || comment.parentId || "";
}

function linearCommentTree(comments) {
  const sorted = [...comments].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  );
  const byId = new Map(sorted.map((comment) => [comment.id, { ...comment, replies: [] }]));
  const roots = [];

  for (const comment of byId.values()) {
    const parentId = linearCommentParentId(comment);
    const parent = parentId ? byId.get(parentId) : null;
    if (parent) parent.replies.push(comment);
    else roots.push(comment);
  }

  return roots;
}

function renderLinearComment(comment, nested = false) {
  const replies = comment.replies || [];
  return `
    <article class="linear-comment${nested ? " linear-comment-reply" : ""}">
      <header>
        <strong>${escapeHtml(comment.user?.name || "Unknown")}</strong>
        <time>${escapeHtml(formatDate(comment.createdAt))}</time>
      </header>
      <div class="linear-comment-body linear-markdown">${renderLinearMarkdown(comment.body)}</div>
      ${replies.length ? `<div class="linear-comment-replies">${replies.map((reply) => renderLinearComment(reply, true)).join("")}</div>` : ""}
    </article>
  `;
}

function renderLinearDetail(context, options = {}) {
  const container = els.flowPane.querySelector(".linear-detail");
  const cached = options.light ? null : state.linearDetails.get(context.issueId);
  const issue = (options.light ? context.ticket || cached?.issue : cached?.issue || context.ticket) || {
    identifier: context.issueId,
    title: context.title,
    url: context.issueUrl,
  };
  const loading = options.light || cached?.loading;
  const comments = options.light ? [] : issue.comments?.nodes || [];
  const commentTree = linearCommentTree(comments);
  const meta = [
    issue.project?.name,
    issue.estimate ? `${issue.estimate} pts` : "",
  ].filter(Boolean);
  const priorityControl = renderLinearPriorityControl(issue);
  const statusName = issue.state?.name || context.ticket?.state?.name || "";
  const statusControl = renderLinearStatusControl(issue, statusName);
  const githubCiPill = renderGithubCiPill(context.flow);
  const pinButton = renderLinearPinButton(issue);
  const issueDescription = issue.description || "";
  const descriptionHtml = issueDescription.trim()
    ? `<div class="linear-description linear-markdown">${options.light ? escapeHtml(issueDescription) : renderLinearMarkdown(issueDescription, "")}</div>`
    : "";

  container.innerHTML = `
    <section class="linear-issue">
      <div class="linear-issue-header">
        <div>
          <div class="linear-issue-kicker">
            <a href="${escapeAttribute(issue.url || context.issueUrl)}" target="_blank" rel="noreferrer">
              ${escapeHtml(issue.identifier || context.issueId)}
            </a>
            ${pinButton}
          </div>
          <h3>${escapeHtml(issue.title || context.title)}</h3>
        </div>
      </div>
      <div class="linear-meta">
        ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        ${statusControl}
        ${priorityControl}
        ${githubCiPill}
      </div>
      ${descriptionHtml}
    </section>
    <section class="linear-comments">
      <header>
        <h3>Comments</h3>
        <span>${loading ? "Loading" : `${comments.length} loaded`}</span>
      </header>
      ${
        cached?.error
          ? `<p class="linear-error">${escapeHtml(cached.error)}</p>`
          : comments.length
            ? commentTree.map((comment) => renderLinearComment(comment)).join("")
            : `<p class="linear-empty-copy">${loading ? "Loading comments." : "No comments."}</p>`
      }
    </section>
  `;
  updateMarkdownCodeCopyPositions(container);
}

async function loadLinearDetail(identifier) {
  const cached = state.linearDetails.get(identifier);
  if (cached?.issue || cached?.loading) return;
  state.linearDetails.set(identifier, { loading: true });
  if (identifier === state.selectedLinearIssueId) renderFlowPane();
  try {
    const data = await api(`/api/linear/issues/${encodeURIComponent(identifier)}`);
    const current = state.linearDetails.get(identifier);
    state.linearDetails.set(identifier, { ...current, loading: false, issue: mergeLinearIssue(current?.issue, data.issue) });
    if (data.issue?.identifier) {
      upsertLinearIssue(data.issue);
      syncLinearTicketsWithFlows();
      renderTickets();
    }
  } catch (error) {
    if (error.status === 404) {
      removeLinearIssueFromTurbopump(identifier);
      if (flowForLinearIssue(identifier)) {
        state.linearDetails.set(identifier, { loading: false, deleted: true, error: "Linear issue not found" });
      }
      renderTickets();
      renderFlowPane();
      return;
    }
    state.linearDetails.set(identifier, { loading: false, error: error.message });
  }
  if (identifier === state.selectedLinearIssueId) renderFlowPane();
}

async function createFlowFromTicket(ticket, options = {}) {
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

async function ensureSelectedFlow() {
  const flow = selectedFlow();
  if (flow) return flow;
  const ticket = selectedTicket();
  if (!ticket) return null;
  return createFlowFromTicket(ticket);
}

async function loadLogs(id, options = {}) {
  if (!state.logs.has(id)) state.logs.set(id, []);
  if (options.resetCursor) resetFlowLogWindow(id);
  const shouldLoadRecent = !state.logBackfilledFlowIds.has(id);
  let cursor = state.lastLogId.get(id) || 0;

  const appendedLogs = [];
  if (shouldLoadRecent) {
    while (true) {
      const before = state.firstLogId.get(id) || Number.MAX_SAFE_INTEGER;
      const data = await wsRequest("logs", { flowId: id, before, limit: LOG_PAGE_SIZE });
      for (const log of data.logs) {
        if (appendLogEntry(log)) appendedLogs.push(log);
      }
      rememberLoadedLogBounds(id, data.logs);
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

function resetFlowLogWindow(flowId) {
  state.logs.set(flowId, []);
  state.logIds.set(flowId, new Set());
  state.firstLogId.delete(flowId);
  state.lastLogId.delete(flowId);
  state.logBackfilledFlowIds.delete(flowId);
  state.logOlderCompleteFlowIds.delete(flowId);
  state.logOlderLoadingFlowIds.delete(flowId);
  state.terminalVisibleTurnCounts.delete(flowId);
}

function rememberLoadedLogBounds(flowId, logs) {
  for (const log of logs) {
    const id = Number(log.id);
    if (!Number.isFinite(id)) continue;
    state.firstLogId.set(flowId, Math.min(state.firstLogId.get(flowId) || id, id));
    state.lastLogId.set(flowId, Math.max(state.lastLogId.get(flowId) || 0, id));
  }
}

async function loadOlderTerminalTraceMessages(options = {}) {
  const flowId = state.selectedFlowId;
  if (!flowId || state.logOlderLoadingFlowIds.has(flowId)) return;
  const terminal = els.flowPane.querySelector(".terminal");
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

function scheduleTicketLogPrefetch() {
  if (state.logPrefetchTimer || !state.linearTicketsLoaded) return;
  if (state.logPrefetchedFlowCount >= LOG_PREFETCH_MAX_FLOW_COUNT) return;
  state.logPrefetchTimer = window.setTimeout(() => {
    state.logPrefetchTimer = 0;
    void prefetchTicketLogs();
  }, LOG_PREFETCH_DELAY_MS);
}

async function prefetchTicketLogs() {
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

function logMeta(source) {
  const userLabel = state.linearViewer?.name || state.linearViewerName || "user";
  if (source === "user:queued") return { label: userLabel, marker: "o", tone: "user" };
  const map = {
    user: { label: userLabel, marker: ">", tone: "user" },
    "agent:message": { label: "codex", marker: ">", tone: "assistant" },
    agent: { label: "codex", marker: ">", tone: "assistant" },
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

function normalizeTerminalLog(log) {
  const message = String(log.message || "");
  if (log.source === "user" && message.trimStart().startsWith("$ ")) {
    return { ...log, source: "shell:command", message: message.trimStart().slice(2).trim() };
  }
  if (log.source === "agent" && message.startsWith("$ ")) {
    return { ...log, source: "agent:tool", message: message.slice(2) };
  }
  return { ...log, message };
}

function isStreamingSource(source) {
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

function isLiveAgentTextSource(source) {
  return ["agent", "agent:message", "agent:thinking", "agent:reasoning"].includes(source);
}

function isAgentMessageSource(source) {
  return source === "agent" || source === "agent:message";
}

function isAgentMessageBoundarySource(source) {
  return source === "agent:message-boundary";
}

function isUserLogSource(source) {
  return source === "user" || source === "user:queued";
}

function parseTraceGroup(log) {
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

function isAgentTurnEndedLog(log) {
  return (
    log.source === "agent:status" &&
    /^turn (completed|failed|canceled|cancelled|interrupted|stopped)\b/.test(String(log.message || "").trim())
  );
}

function isShellExitLog(log) {
  return isShellResultLog(log) || isLegacyShellExitLog(log);
}

function isShellResultLog(log) {
  return log.source === "shell:result" && /^(completed|interrupted|failed) exit \d+\b/.test(String(log.message || "").trim());
}

function isLegacyShellExitLog(log) {
  return (
    log.source === "agent:tool-result" && /^(completed|interrupted|failed) exit \d+\b/.test(String(log.message || "").trim())
  );
}

function isRoutineShellExitLog(log) {
  return (log.source === "shell:result" || log.source === "agent:tool-result") && String(log.message || "").trim() === "completed exit 0";
}

function syntheticCompletedTurnTraceRanges(logs, existingRanges) {
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
      if (isUserLogSource(nextLog.source)) break;
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

function traceRangeHasAgentTurnEnd(logs, range) {
  return logs.some((log) => log.id > range.afterId && log.id < range.beforeId && isAgentTurnEndedLog(log));
}

function traceRangeForLog(log, ranges) {
  return ranges.find((range) => log.id > range.afterId && log.id < range.beforeId) || null;
}

function isTraceGroupSource(source) {
  return source === "agent:trace-group" || source === "shell:trace-group";
}

function isStructuralTerminalSource(source) {
  return isTraceGroupSource(source) || isAgentMessageBoundarySource(source);
}

function traceRangeLogCount(logs, afterId, beforeId) {
  return logs.filter((log) => log.id > afterId && log.id < beforeId && !isStructuralTerminalSource(log.source)).length;
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function logIdsHaveRangeEntry(ids, afterId, beforeId) {
  return lowerBound(ids, beforeId) > upperBound(ids, afterId);
}

function traceRangeLogCounter(logs) {
  const ids = logs
    .filter((log) => !isStructuralTerminalSource(log.source))
    .map((log) => Number(log.id))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return (afterId, beforeId) => lowerBound(ids, beforeId) - upperBound(ids, afterId);
}

function sortedTraceRanges(ranges) {
  return [...ranges].sort((a, b) => a.afterId - b.afterId || a.beforeId - b.beforeId);
}

function addSanitizedTraceRange(result, seen, logs, range, afterId, beforeId, countRange = traceRangeLogCounter(logs)) {
  const key = `${afterId}:${beforeId}`;
  if (seen.has(key)) return;
  const count = countRange(afterId, beforeId);
  if (count <= 1) return;
  result.push({ ...range, afterId, beforeId, key, count });
  seen.add(key);
}

function finalResponseStartIdForTrace(range, rangeLogs) {
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

function traceRangeShouldIncludeUserLogs(range, rangeLogs) {
  if (range.kind === "compact") return true;
  if (range.kind === "shell") return false;
  return rangeLogs.some((log) => isUserLogSource(log.source)) && rangeLogs.some((log) => isAgentTurnEndedLog(log));
}

function sanitizeTraceRanges(logs, ranges) {
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
      if (!isUserLogSource(log.source)) continue;
      addSanitizedTraceRange(result, seen, logs, range, segmentAfterId, log.id, countRange);
      segmentAfterId = log.id;
    }
    addSanitizedTraceRange(result, seen, logs, range, segmentAfterId, beforeId, countRange);
  }
  return result;
}

function appendTerminalGroup(groups, log, options = {}) {
  const previous = groups[groups.length - 1];
  if (!options.forceNew && previous && previous.source === log.source && isStreamingSource(log.source)) {
    previous.message += log.message;
    previous.lastAt = log.createdAt;
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
    lastAt: log.createdAt,
    boundaryBefore: Boolean(options.forceNew),
  };
  groups.push(group);
  return group;
}

function flattenSingleChildTraceGroups(groups) {
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

function mergeAdjacentStreamingGroups(groups) {
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

function latestTerminalContentGroup(groups) {
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

function terminalContentGroups(groups, result = []) {
  for (const group of groups || []) {
    if (group.source === "agent:trace-group") terminalContentGroups(group.children || [], result);
    else result.push(group);
  }
  return result;
}

function markPendingTerminalTurnGroups(groups, flow) {
  if (!flowAgentRunning(flow) || state.messageSubmittingFlowId === flow?.id) return groups;
  const contentGroups = terminalContentGroups(groups);
  let lastUserIndex = -1;
  for (let index = 0; index < contentGroups.length; index += 1) {
    if (isUserLogSource(contentGroups[index].source)) lastUserIndex = index;
  }
  if (lastUserIndex < 0) return groups;
  for (let index = lastUserIndex + 1; index < contentGroups.length; index += 1) {
    if (isLiveAgentTextSource(contentGroups[index].source)) contentGroups[index].turnPending = true;
  }
  return groups;
}

function markLiveTerminalGroup(groups, flow) {
  if (!flowAgentRunning(flow) || state.messageSubmittingFlowId === flow?.id) return groups;
  const group = latestTerminalContentGroup(groups);
  if (group && isLiveAgentTextSource(group.source)) group.liveStreaming = true;
  return groups;
}

function plainTerminalText(message) {
  return String(message || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\[(\d{1,3}(?:;\d{1,3})*)m/g, "");
}

function isNoisyAgentStderr(message) {
  return /ERROR\s+rmcp::transport::worker:\s+worker quit with fatal:\s+Transport channel closed\b/.test(
    plainTerminalText(message),
  );
}

function isHiddenTerminalLog(log) {
  if (isAgentMessageBoundarySource(log.source)) return true;
  const message = String(log.message || "").trim();
  if (log.source === "agent:tool-result" && message === "completed exit 0") return true;
  if (log.source === "agent:tool-result" && message === "failed exit 7") return true;
  if (log.source === "agent:stderr" && isNoisyAgentStderr(message)) return true;
  return (
    log.source === "agent:status" &&
    (/^turn started\b/.test(message) ||
      /^turn completed\b/.test(message) ||
      /^interrupt requested\b/.test(message) ||
      /^[$]\s*codex app-server --listen stdio:\/\/$/i.test(message) ||
      /^Codex thread \S+ ready$/i.test(message))
  );
}

function terminalGroups(logs, flow) {
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
    if (traceRange && (!isUserLogSource(log.source) || traceRange.includeUserLogs)) {
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

function agentPaneLogs(logs, flow) {
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

function isShellPaneLog(log, command) {
  if (isShellOwnedLog(log)) return true;
  if (isShellExitLog(log)) return true;
  if (isLegacyShellOutputLog(log)) return true;
  return (
    log.source === "agent:tool" &&
    formatTerminalMessage(log.source, log.message) === formatTerminalMessage(command.source, command.message)
  );
}

function latestShellCommandLogId(logs) {
  let id = 0;
  for (const log of logs) {
    const normalized = normalizeTerminalLog(log);
    if (normalized.source !== "shell:command") continue;
    const logId = Number(normalized.id);
    if (Number.isFinite(logId) && logId > id) id = logId;
  }
  return id;
}

function isShellOwnedLog(log) {
  return String(log.source || "").startsWith("shell:") && log.source !== "shell:command";
}

function isLegacyShellOutputLog(log) {
  if (log.source === "agent:cmd" || log.source === "agent:stderr") return true;
  return log.source === "agent:status" && /^shell interrupt (requested|escalated|forced cleanup)\b/.test(String(log.message || "").trim());
}

function isShellTraceGroupLog(log) {
  if (log.source === "shell:trace-group") return true;
  if (log.source !== "agent:trace-group") return false;
  return parseTraceGroup(log)?.kind === "shell";
}

function isShellOnlyRenderLog(log) {
  const normalized = normalizeTerminalLog(log);
  return (
    String(normalized.source || "").startsWith("shell:") ||
    isShellTraceGroupLog(normalized) ||
    isLegacyShellOutputLog(normalized)
  );
}

function runningShellGroups(logs, flow, clearAfterLogId = 0) {
  if (!flowShellRunning(flow)) return [];
  return latestShellGroups(logs, clearAfterLogId);
}

function latestShellGroups(logs, clearAfterLogId = 0) {
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

function hasVisibleTerminalOutput(message) {
  return Boolean(plainTerminalText(message).trim());
}

function isShellOutputLog(log) {
  return log.source === "shell:output" || log.source === "shell:stderr" || log.source === "shell:status";
}

function shellOutputPane() {
  return els.flowPane.querySelector(".shell-output-pane");
}

function shellOutputGroups(logs, flow) {
  const flowId = flow?.id || state.selectedFlowId;
  const clearAfterLogId = Math.max(
    state.shellOutputClearAfterLogId.get(flowId) || 0,
    Number(flow?.shellOutputClearAfterLogId || 0),
  );
  const runningGroups = runningShellGroups(logs, flow, clearAfterLogId);
  if (runningGroups.length) return runningGroups;
  return latestShellGroups(logs, clearAfterLogId);
}

function renderShellOutputPane(flowId) {
  const pane = shellOutputPane();
  const agentPanel = els.flowPane.querySelector(".agent-panel");
  if (!pane) return;
  if (!flowId) {
    pane.hidden = true;
    pane.replaceChildren();
    pane._shellOutputSignature = "";
    agentPanel?.classList.remove("shell-output-visible");
    return;
  }
  if (flowId !== state.selectedFlowId) return;
  const flow = state.flows.find((item) => item.id === flowId) || null;
  const groups = shellOutputGroups(state.logs.get(flowId) || [], flow);
  const hasGroups = Boolean(groups.length);
  const showPane = !state.shellPaneHidden;
  const keepShellGrid = showPane || state.shellPaneHidden;
  const shellLive = showPane && flowShellLive(flow);
  pane.hidden = !showPane;
  agentPanel?.classList.toggle("shell-output-visible", keepShellGrid);
  if (showPane) applyShellOutputSplitSize();
  if (!hasGroups && !shellLive) {
    pane.replaceChildren();
    pane._shellOutputSignature = "";
    return;
  }
  const signature = `${terminalGroupsSignature(groups)}\u001fshell-live:${shellLive}`;
  if (pane._shellOutputSignature === signature) return;
  const fragment = document.createDocumentFragment();
  for (const group of groups) appendTerminalBlock(fragment, group);
  if (shellLive) appendTerminalWorkingBlock(fragment, "shell");
  pane.replaceChildren(fragment);
  pane._shellOutputSignature = signature;
  pane.scrollTop = pane.scrollHeight;
}

function scheduleShellOutputRender(flowId) {
  if (!flowId) return;
  state.pendingShellOutputRenders.add(flowId);
  if (state.shellOutputRenderFrame) return;
  state.shellOutputRenderFrame = requestAnimationFrame(() => {
    state.shellOutputRenderFrame = 0;
    const flowIds = [...state.pendingShellOutputRenders];
    state.pendingShellOutputRenders.clear();
    for (const id of flowIds) renderShellOutputPane(id);
  });
}

async function clearShellOutputPane() {
  const flowId = state.selectedFlowId;
  if (flowId) state.shellOutputClearAfterLogId.set(flowId, state.lastLogId.get(flowId) || 0);
  const pane = shellOutputPane();
  pane?.replaceChildren();
  if (pane) pane._shellOutputSignature = "";
  renderShellOutputPane(flowId);
  if (!flowId) return;
  try {
    const data = await api(`/api/flows/${encodeURIComponent(flowId)}/shell-output/clear`, { method: "POST" });
    const clearAfterLogId = Number(data.clearAfterLogId || 0);
    if (Number.isFinite(clearAfterLogId)) state.shellOutputClearAfterLogId.set(flowId, clearAfterLogId);
    if (data.flow) upsertFlow(data.flow);
    renderShellOutputPane(flowId);
  } catch (error) {
    alert(error.message);
  }
}

function formatTerminalMessage(source, message, options = {}) {
  const text = String(message || "");
  if (source === "agent:tool") return text.trim();
  if (source === "agent:tool-result") return text.trim();
  if (source === "agent:status" || source === "flow" || source === "linear") return text.trim();
  const withoutLeadingNewlines = text.replace(/^\n+/, "");
  return options.preserveTrailingNewlines ? withoutLeadingNewlines : withoutLeadingNewlines.replace(/\n+$/, "");
}

function localDayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function terminalDateLabel(date, now = new Date()) {
  const days = Math.floor((localDayStart(now) - localDayStart(date)) / 86_400_000);
  if (days <= 0) return "";
  return `${days}d ago`;
}

function formatTerminalTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  }).replace(/\s+([AP]M)$/i, "$1").toLowerCase();
  const dateLabel = terminalDateLabel(date);
  return dateLabel ? `${time} (${dateLabel})` : time;
}

function usesTerminalBlockMarkdown(source) {
  return ["user", "user:queued", "agent", "agent:message", "agent:thinking", "agent:reasoning"].includes(source);
}

function usesTerminalMarkdownToggle(source) {
  return ["agent", "agent:message"].includes(source);
}

function splitTerminalAttachedImages(message) {
  const text = String(message || "");
  const marker = "\n\nAttached images:\n";
  const markerIndex = text.lastIndexOf(marker);
  if (markerIndex === -1) return { message: text, images: [] };

  const visibleMessage = text.slice(0, markerIndex);
  const attachmentText = text.slice(markerIndex + marker.length);
  const images = [];
  for (const line of attachmentText.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^-\s+(?:(.*?):\s+)?(.+?)(?:\s+\(([^()]+)\))?$/);
    if (!match) return { message: text, images: [] };
    images.push({
      name: match[1] || "",
      path: match[2] || "",
      relativePath: match[3] || "",
    });
  }
  return images.length ? { message: visibleMessage, images } : { message: text, images: [] };
}

function renderTerminalAttachedImages(images) {
  if (!images.length) return "";
  return `<div class="terminal-attached-images">${images.map((image) => renderAgentImageChip(image)).join("")}</div>`;
}

function renderTerminalMarkdownContent(message, options = {}) {
  const parsed = splitTerminalAttachedImages(message);
  return `${renderLinearMarkdown(parsed.message, "", {
    images: false,
    links: true,
    compactBlankLines: true,
    copyCode: options.copyCode !== false,
  })}${renderTerminalAttachedImages(parsed.images)}`;
}

function renderTerminalMarkdownOutput(message, options = {}) {
  return `<div class="terminal-markdown-content" data-raw-markdown="${escapeAttribute(message)}">${renderTerminalMarkdownContent(message, options)}</div>`;
}

function renderTerminalStreamingTextOutput(message) {
  return `<div class="terminal-streaming-markdown">${renderLinearMarkdown(message, "", {
    images: false,
    links: true,
    compactBlankLines: true,
    copyCode: false,
  })}</div>`;
}

function ansiClassForCode(code) {
  const colors = {
    30: "black",
    31: "red",
    32: "green",
    33: "yellow",
    34: "blue",
    35: "magenta",
    36: "cyan",
    37: "white",
    90: "bright-black",
    91: "bright-red",
    92: "bright-green",
    93: "bright-yellow",
    94: "bright-blue",
    95: "bright-magenta",
    96: "bright-cyan",
    97: "bright-white",
  };
  return colors[code] ? `ansi-fg-${colors[code]}` : "";
}

function ansiColorValueForCode(code) {
  const colors = {
    30: "#111827",
    31: "#b91c1c",
    32: "#15803d",
    33: "#a16207",
    34: "#1d4ed8",
    35: "#a21caf",
    36: "#0e7490",
    37: "#475569",
    90: "#64748b",
    91: "#dc2626",
    92: "#16a34a",
    93: "#ca8a04",
    94: "#2563eb",
    95: "#c026d3",
    96: "#0891b2",
    97: "#334155",
  };
  return colors[code] || "";
}

function ansi256ColorValue(value) {
  const color = Number(value);
  if (!Number.isInteger(color) || color < 0 || color > 255) return "";
  const base = [
    "#000000",
    "#800000",
    "#008000",
    "#808000",
    "#000080",
    "#800080",
    "#008080",
    "#c0c0c0",
    "#808080",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#0000ff",
    "#ff00ff",
    "#00ffff",
    "#ffffff",
  ];
  if (color < base.length) return base[color];
  if (color >= 232) {
    const level = 8 + (color - 232) * 10;
    return `rgb(${level}, ${level}, ${level})`;
  }
  const index = color - 16;
  const channel = (step) => (step === 0 ? 0 : 55 + step * 40);
  const red = channel(Math.floor(index / 36) % 6);
  const green = channel(Math.floor(index / 6) % 6);
  const blue = channel(index % 6);
  return `rgb(${red}, ${green}, ${blue})`;
}

function ansiTrueColorValue(red, green, blue) {
  const channels = [red, green, blue].map(Number);
  if (channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) return "";
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

function ansiParams(value) {
  if (!value) return [0];
  const params = String(value)
    .split(/[;:]/)
    .filter((item) => item !== "")
    .map((item) => Number(item));
  return params.length ? params : [0];
}

function renderAnsiText(root, message) {
  const text = String(message || "");
  const pattern = /\x1b\[([0-?]*)([ -/]*)([@-~])|\[((?:\d{1,3}|[;:])+)m/g;
  let index = 0;
  let colorClass = "";
  let inlineColor = "";
  let backgroundColor = "";
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;

  const appendText = (value) => {
    if (!value) return;
    if (!colorClass && !inlineColor && !backgroundColor && !bold && !dim && !italic && !underline) {
      root.appendChild(document.createTextNode(value));
      return;
    }
    const span = document.createElement("span");
    if (colorClass) span.classList.add(colorClass);
    if (bold) span.classList.add("ansi-bold");
    if (dim) span.classList.add("ansi-dim");
    if (italic) span.classList.add("ansi-italic");
    if (underline) span.classList.add("ansi-underline");
    if (inlineColor) span.style.color = inlineColor;
    if (backgroundColor) span.style.backgroundColor = backgroundColor;
    span.textContent = value;
    root.appendChild(span);
  };

  for (const match of text.matchAll(pattern)) {
    appendText(text.slice(index, match.index));
    index = match.index + match[0].length;
    const command = match[3] || "m";
    if (command !== "m") continue;
    const params = ansiParams(match[1] || match[4] || "0");
    for (let paramIndex = 0; paramIndex < params.length; paramIndex += 1) {
      const code = params[paramIndex];
      if (code === 0) {
        colorClass = "";
        inlineColor = "";
        backgroundColor = "";
        bold = false;
        dim = false;
        italic = false;
        underline = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (code === 3) {
        italic = true;
      } else if (code === 4) {
        underline = true;
      } else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 23) {
        italic = false;
      } else if (code === 24) {
        underline = false;
      } else if (code === 39) {
        colorClass = "";
        inlineColor = "";
      } else if (code === 49) {
        backgroundColor = "";
      } else if (code >= 40 && code <= 47) {
        backgroundColor = ansiColorValueForCode(code - 10);
      } else if (code >= 100 && code <= 107) {
        backgroundColor = ansiColorValueForCode(code - 10);
      } else if ((code === 38 || code === 48) && params[paramIndex + 1] === 5) {
        const nextColor = ansi256ColorValue(params[paramIndex + 2]);
        if (nextColor) {
          if (code === 38) {
            colorClass = "";
            inlineColor = nextColor;
          } else {
            backgroundColor = nextColor;
          }
        }
        paramIndex += 2;
      } else if ((code === 38 || code === 48) && params[paramIndex + 1] === 2) {
        const nextColor = ansiTrueColorValue(params[paramIndex + 2], params[paramIndex + 3], params[paramIndex + 4]);
        if (nextColor) {
          if (code === 38) {
            colorClass = "";
            inlineColor = nextColor;
          } else {
            backgroundColor = nextColor;
          }
        }
        paramIndex += 4;
      } else {
        const nextColorClass = ansiClassForCode(code);
        if (nextColorClass) {
          colorClass = nextColorClass;
          inlineColor = "";
        }
      }
    }
  }
  appendText(text.slice(index));
}

function toggleTerminalMarkdownOutput(button) {
  const entry = button.closest(".terminal-entry");
  const body = entry?.querySelector(".terminal-entry-body");
  const content = body?.querySelector(".terminal-markdown-content");
  if (!content) return;

  const raw = content.dataset.rawMarkdown || "";
  const showingRaw = body.classList.toggle("showing-raw-markdown");
  button.setAttribute("aria-pressed", String(showingRaw));
  button.setAttribute("aria-label", "Toggle raw markdown");
  button.title = "Toggle raw markdown";
  button.textContent = "raw";
  content.innerHTML = showingRaw
    ? `<pre class="terminal-raw-markdown">${escapeHtml(raw)}</pre>`
    : renderTerminalMarkdownContent(raw);
  if (!showingRaw) highlightCodeBlocks(content);
  applyTerminalMessageClamps(body.closest(".terminal-entry") || body);
}

function highlightCodeBlocks(root) {
  window.Prism?.highlightAllUnder?.(root);
  updateMarkdownCodeCopyPositions(root);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyAgentBranchName(branchName) {
  if (!branchName) return;
  try {
    await copyTextToClipboard(branchName);
    toast("Branch copied");
  } catch {
    toast("Could not copy branch", { kind: "error" });
  }
}

async function copyMarkdownCodeBlock(button) {
  const code = button.closest(".markdown-code-block")?.querySelector("code")?.textContent || "";
  if (!code) return;
  try {
    await copyTextToClipboard(code);
  } catch {
    toast("Could not copy code", { kind: "error" });
  }
}

function markdownTableColumnWidths(table) {
  return Array.from(table.querySelectorAll("thead th")).map((header) =>
    Math.max(MARKDOWN_TABLE_MIN_COLUMN_WIDTH, Math.round(header.getBoundingClientRect().width)),
  );
}

function setMarkdownTableColumnWidths(table, widths) {
  let colgroup = table.querySelector("colgroup");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    table.prepend(colgroup);
  }

  while (colgroup.children.length < widths.length) colgroup.appendChild(document.createElement("col"));
  Array.from(colgroup.children).forEach((column, index) => {
    if (index >= widths.length) return;
    column.style.width = `${widths[index]}px`;
  });
  table.style.width = `${widths.reduce((total, width) => total + width, 0)}px`;
  table.style.tableLayout = "fixed";
}

function startMarkdownTableColumnResize(event) {
  const handle = event.target.closest?.("[data-markdown-column-resizer]");
  if (!handle) return;

  const header = handle.closest("th");
  const table = header?.closest("table.markdown-resizable-table");
  if (!header || !table) return;

  const headers = Array.from(table.querySelectorAll("thead th"));
  const columnIndex = headers.indexOf(header);
  if (columnIndex === -1) return;

  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const widths = markdownTableColumnWidths(table);
  const startWidth = widths[columnIndex] || MARKDOWN_TABLE_MIN_COLUMN_WIDTH;
  setMarkdownTableColumnWidths(table, widths);
  table.classList.add("markdown-table-resizing");
  document.body.classList.add("markdown-table-resizing");
  handle.setPointerCapture?.(event.pointerId);

  const onPointerMove = (moveEvent) => {
    const nextWidths = [...widths];
    nextWidths[columnIndex] = Math.max(
      MARKDOWN_TABLE_MIN_COLUMN_WIDTH,
      Math.round(startWidth + moveEvent.clientX - startX),
    );
    setMarkdownTableColumnWidths(table, nextWidths);
  };

  const onPointerUp = (upEvent) => {
    onPointerMove(upEvent);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    table.classList.remove("markdown-table-resizing");
    document.body.classList.remove("markdown-table-resizing");
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function updateMarkdownCodeCopyPositions(root = els.flowPane) {
  for (const block of root.querySelectorAll?.(".markdown-code-block") || []) {
    const button = block.querySelector(".markdown-code-copy");
    if (!button) continue;
    const blockRect = block.getBoundingClientRect();
    const clipTop = markdownCodeBlockClipTop(block);
    const rawTop = Math.max(blockRect.top, clipTop) - blockRect.top + MARKDOWN_CODE_COPY_OFFSET;
    const maxTop = Math.max(MARKDOWN_CODE_COPY_OFFSET, blockRect.height - MARKDOWN_CODE_COPY_SIZE - MARKDOWN_CODE_COPY_OFFSET);
    const top = Math.min(Math.max(MARKDOWN_CODE_COPY_OFFSET, rawTop), maxTop);
    button.style.setProperty("--markdown-code-copy-top", `${top}px`);
  }
}

function markdownCodeBlockClipTop(block) {
  let clipTop = 0;
  for (let node = block.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!/(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowY}`)) continue;
    clipTop = Math.max(clipTop, node.getBoundingClientRect().top);
  }
  return clipTop;
}

let markdownCodeCopyPositionFrame = 0;
function scheduleMarkdownCodeCopyPositionUpdate(root = els.flowPane) {
  if (markdownCodeCopyPositionFrame) return;
  markdownCodeCopyPositionFrame = requestAnimationFrame(() => {
    markdownCodeCopyPositionFrame = 0;
    updateMarkdownCodeCopyPositions(root);
  });
}

function terminalMessageMaxLines(root) {
  const panel = root.closest?.(".agent-panel") || els.flowPane.querySelector(".agent-panel");
  const value = getComputedStyle(panel || document.documentElement)
    .getPropertyValue("--terminal-message-max-lines")
    .trim();
  const maxLines = Number.parseInt(value, 10);
  return Number.isFinite(maxLines) && maxLines > 0 ? maxLines : 50;
}

function applyTerminalMessageClamps(root) {
  if (!root) return;
  if (root.closest?.(".shell-output-pane")) return;
  const maxLines = terminalMessageMaxLines(root);
  const bodies = root.matches?.(".terminal-entry-body")
    ? [root]
    : Array.from(root.querySelectorAll(".terminal-entry-body"));
  for (const body of bodies) {
    const entry = body.closest(".terminal-entry");
    if (
      !entry ||
      body.classList.contains("agent-working") ||
      body.closest(".shell-output-pane") ||
      entry.classList.contains("terminal-entry-assistant")
    ) {
      continue;
    }
    const content = terminalMessageContent(body);
    body.querySelectorAll(":scope > .terminal-entry-overflow-marker").forEach((marker) => marker.remove());
    const style = getComputedStyle(body);
    const lineHeight = Number.parseFloat(style.lineHeight);
    if (Number.isFinite(lineHeight) && lineHeight > 0) {
      content.style.setProperty("--terminal-message-max-height", `${lineHeight * maxLines}px`);
    }
    for (const image of content.querySelectorAll("img")) {
      if (!image.complete) image.addEventListener("load", () => applyTerminalMessageClamps(entry), { once: true });
    }
    if (content.scrollHeight <= content.clientHeight + 1) continue;
    const marker = document.createElement("div");
    marker.className = "terminal-entry-overflow-marker";
    marker.textContent = ". . .";
    body.appendChild(marker);
  }
}

function terminalMessageContent(body) {
  const existing = body.querySelector(":scope > .terminal-entry-body-content");
  if (existing) return existing;
  const content = document.createElement(body.tagName === "PRE" ? "span" : "div");
  content.className = "terminal-entry-body-content";
  while (body.firstChild) content.appendChild(body.firstChild);
  body.appendChild(content);
  return content;
}

function terminalGroupRenderKey(group) {
  if (group.source === "agent:trace-group" && group.traceKey) return `trace:${group.traceKey}`;
  return `${group.source}:${group.id}`;
}

function appendTerminalBlock(fragment, group, options = {}) {
  if (group.source === "agent:trace-group") {
    appendTerminalTraceGroup(fragment, group, options);
    return;
  }

  const meta = logMeta(group.source);
  const block = document.createElement("section");
  block.className = `terminal-entry terminal-entry-${meta.tone}`;
  if (options.incoming) block.classList.add("terminal-entry-incoming");

  if (group.source === "agent:tool" || group.source === "agent:tool-result" || group.source === "shell:command") {
    block.classList.add("terminal-entry-command");
    const row = document.createElement("div");
    row.className = "terminal-command-line";

    const marker = document.createElement("span");
    marker.className = "terminal-entry-marker";
    marker.textContent = meta.marker;

    const body = document.createElement("pre");
    body.className = "terminal-entry-body";
    body.innerHTML = renderInlineMarkdown(formatTerminalMessage(group.source, group.message), {
      images: false,
      links: false,
    });
    row.replaceChildren(marker, body);
    block.replaceChildren(row);
    fragment.appendChild(block);
    return;
  }

  const header = document.createElement("div");
  header.className = "terminal-entry-header";

  const marker = document.createElement("span");
  marker.className = "terminal-entry-marker";
  marker.textContent = meta.marker;

  const label = document.createElement("span");
  label.className = "terminal-entry-label";
  label.textContent = meta.label;

  let markdownToggle = null;
  if (!group.liveStreaming && !group.turnPending && usesTerminalMarkdownToggle(group.source)) {
    markdownToggle = document.createElement("button");
    markdownToggle.type = "button";
    markdownToggle.className = "terminal-markdown-toggle";
    markdownToggle.setAttribute("aria-pressed", "false");
    markdownToggle.setAttribute("aria-label", "Toggle raw markdown");
    markdownToggle.title = "Toggle raw markdown";
    markdownToggle.textContent = "raw";
  }

  let time = null;
  if (meta.tone !== "output") {
    time = document.createElement("time");
    time.className = "terminal-entry-time";
    time.dateTime = group.createdAt;
    time.textContent = formatTerminalTimestamp(group.createdAt);
  }

  const body = document.createElement(usesTerminalBlockMarkdown(group.source) ? "div" : "pre");
  body.className = "terminal-entry-body";
  const message = formatTerminalMessage(group.source, group.message, {
    preserveTrailingNewlines: Boolean(group.liveStreaming),
  });
  if (usesTerminalBlockMarkdown(group.source)) {
    body.classList.add("terminal-markdown-output");
    if (group.liveStreaming) {
      body.classList.add("terminal-streaming-output");
      body.innerHTML = renderTerminalStreamingTextOutput(message);
      highlightCodeBlocks(body);
    } else {
      body.innerHTML = renderTerminalMarkdownOutput(message, { copyCode: !group.turnPending });
      highlightCodeBlocks(body);
    }
  } else if (meta.tone === "output" || meta.tone === "error" || group.source === "serve" || group.source === "serve:stderr") {
    renderAnsiText(body, message);
  } else {
    body.innerHTML = renderInlineMarkdown(message, { images: false, links: false });
  }

  header.replaceChildren(marker, label, ...(markdownToggle ? [markdownToggle] : []), ...(time ? [time] : []));
  block.replaceChildren(
    header,
    ...(meta.tone === "output" ? [renderOutputDeleteButton(group)] : []),
    body,
  );
  fragment.appendChild(block);
}

function renderOutputDeleteButton(group) {
  const ids = group.logIds || [group.id];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "terminal-output-delete";
  button.setAttribute("aria-label", "Delete output message");
  button.title = "Delete output message";
  button.disabled = ids.some((id) => state.deletingOutputLogIds.has(id));
  button.innerHTML = `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 4.5l7 7m0-7l-7 7" />
    </svg>
  `;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await deleteOutputLogGroup(group.flowId, ids);
  });
  return button;
}

function removeLogEntries(flowId, ids) {
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

async function deleteOutputLogGroup(flowId, ids) {
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

function appendTerminalTraceGroup(fragment, group, options = {}) {
  const meta = logMeta(group.source);
  const details = document.createElement("details");
  details.className = "terminal-trace-group";
  if (options.incoming) details.classList.add("terminal-entry-incoming");
  details.dataset.traceKey = group.traceKey || "";
  details._traceChildren = group.children || [];

  const summary = document.createElement("summary");
  summary.className = "terminal-entry-header terminal-trace-summary";

  const marker = document.createElement("span");
  marker.className = "terminal-entry-marker";
  marker.textContent = meta.marker;

  const label = document.createElement("span");
  label.className = "terminal-entry-label";
  label.textContent = meta.label;

  const time = document.createElement("time");
  time.className = "terminal-entry-time";
  time.dateTime = group.createdAt;
  time.textContent = formatTerminalTimestamp(group.createdAt);

  summary.addEventListener("click", (event) => {
    event.preventDefault();
    toggleTerminalTraceGroup(details);
  });

  summary.replaceChildren(marker, label, time);
  details.replaceChildren(summary);
  if (isTerminalTraceGroupOpen(group)) {
    details.open = true;
    materializeTerminalTraceGroup(details);
  }
  fragment.appendChild(details);
}

function openTraceGroupKeys(flowId) {
  if (!state.openTraceGroups.has(flowId)) state.openTraceGroups.set(flowId, new Set());
  return state.openTraceGroups.get(flowId);
}

function isTerminalTraceGroupOpen(group) {
  return Boolean(group.defaultOpen || (group.flowId && group.traceKey && state.openTraceGroups.get(group.flowId)?.has(group.traceKey)));
}

function setTerminalTraceGroupOpen(details, open) {
  const flowId = state.selectedFlowId;
  const traceKey = details.dataset.traceKey || "";
  if (!flowId || !traceKey) return;
  const openKeys = openTraceGroupKeys(flowId);
  if (open) openKeys.add(traceKey);
  else openKeys.delete(traceKey);
}

function materializeTerminalTraceGroup(details) {
  if (details._traceBody) {
    if ((details._traceRenderIndex || 0) > 0) scheduleTerminalTraceRender(details);
    return details._traceBody;
  }

  const body = document.createElement("div");
  body.className = "terminal-trace-body";
  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "terminal-trace-collapse-line";
  collapseButton.setAttribute("aria-label", "Collapse trace");
  collapseButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleTerminalTraceGroup(details);
  });
  const content = document.createElement("div");
  content.className = "terminal-trace-body-content";

  details._traceBody = body;
  details._traceBodyContent = content;
  body.replaceChildren(collapseButton, content);
  details.appendChild(body);
  details._traceRenderIndex = (details._traceChildren || []).length;
  if (details.open) {
    renderTerminalTraceChunk(details, { maxItems: TERMINAL_TRACE_INITIAL_RENDER_COUNT, scheduleNext: false });
    scheduleTerminalTraceRender(details, { delay: TERMINAL_TRACE_OPEN_DURATION_MS });
  } else {
    scheduleTerminalTraceRender(details);
  }
  return body;
}

function cancelTerminalTraceRender(details) {
  if (details._traceRenderFrame) cancelAnimationFrame(details._traceRenderFrame);
  if (details._traceRenderTimer) window.clearTimeout(details._traceRenderTimer);
  details._traceRenderFrame = 0;
  details._traceRenderTimer = 0;
}

function scheduleTerminalTraceRender(details, options = {}) {
  cancelTerminalTraceRender(details);
  const children = details._traceChildren || [];
  if (!Number.isFinite(details._traceRenderIndex)) details._traceRenderIndex = children.length;
  if (details._traceRenderIndex <= 0) return;
  const run = () => {
    details._traceRenderTimer = 0;
    details._traceRenderFrame = requestAnimationFrame(() => renderTerminalTraceChunk(details));
  };
  if (options.delay) {
    details._traceRenderTimer = window.setTimeout(run, options.delay);
  } else {
    run();
  }
}

function renderTerminalTraceChunk(details, options = {}) {
  details._traceRenderFrame = 0;
  const body = details._traceBody;
  const content = details._traceBodyContent;
  if (!body || !content || !details.open) return;

  const children = details._traceChildren || [];
  const fragment = document.createDocumentFragment();
  const appended = [];
  const endIndex = Number.isFinite(details._traceRenderIndex) ? details._traceRenderIndex : children.length;
  const maxItems = Math.max(1, options.maxItems || TERMINAL_TRACE_RENDER_BATCH_SIZE);
  const startIndex = Math.max(0, endIndex - maxItems);

  for (let index = endIndex - 1; index >= startIndex; index -= 1) {
    appendTerminalBlock(fragment, children[index]);
    if (fragment.lastElementChild) appended.push(fragment.lastElementChild);
  }

  details._traceRenderIndex = startIndex;
  content.appendChild(fragment);
  for (const entry of appended) applyTerminalMessageClamps(entry);
  if (startIndex > 0 && options.scheduleNext !== false) scheduleTerminalTraceRender(details);
}

function toggleTerminalTraceGroup(details) {
  const isClosing = details.classList.contains("terminal-trace-closing");
  const shouldOpen = isClosing || !details.open;
  const terminal = details.closest(".terminal");
  const shouldFollowLatest = terminal && !state.terminalFollowPaused && terminalAtLatest(terminal);
  if (details._traceToggleTimer) window.clearTimeout(details._traceToggleTimer);
  details.classList.remove("terminal-trace-animating", "terminal-trace-opening", "terminal-trace-closing");
  if (shouldOpen) {
    details.open = true;
    materializeTerminalTraceGroup(details);
  } else {
    cancelTerminalTraceRender(details);
  }
  setTerminalTraceGroupOpen(details, shouldOpen);
  details.open = true;
  void details.offsetHeight;
  details.classList.add("terminal-trace-animating", shouldOpen ? "terminal-trace-opening" : "terminal-trace-closing");

  const duration = shouldOpen ? TERMINAL_TRACE_OPEN_DURATION_MS : TERMINAL_TRACE_CLOSE_DURATION_MS;
  if (shouldFollowLatest) followTerminalToLatestDuringLayout(terminal, duration + 40);
  details._traceToggleTimer = window.setTimeout(() => {
    if (!shouldOpen) {
      details.open = false;
      details._traceBody?.remove();
      details._traceBody = null;
      details._traceBodyContent = null;
      details._traceRenderIndex = null;
    }
    details.classList.remove("terminal-trace-animating", "terminal-trace-opening", "terminal-trace-closing");
    if (shouldFollowLatest) scrollTerminalToLatestNow(terminal);
    flushDeferredTerminalLogRender(terminal, {
      fromTraceFlush: true,
      scrollToLatest: Boolean(shouldFollowLatest && terminalAtLatest(terminal)),
    });
    details._traceToggleTimer = 0;
  }, duration);
}

function terminalDistanceFromBottom(terminal) {
  return terminal.scrollHeight - terminal.clientHeight - terminal.scrollTop;
}

function terminalAtLatest(terminal) {
  return terminalDistanceFromBottom(terminal) <= 12;
}

function pauseTerminalFollow() {
  state.terminalFollowPaused = true;
}

function resumeTerminalFollow() {
  state.terminalFollowPaused = false;
}

function scrollTerminalToLatest(terminal) {
  requestAnimationFrame(() => {
    scrollTerminalToLatestNow(terminal);
  });
}

function scrollTerminalToLatestNow(terminal) {
  terminal.scrollTop = terminal.scrollHeight;
}

function terminalBottomRestorer() {
  const terminal = els.flowPane.querySelector(".terminal");
  if (!terminal) return () => {};
  const distanceFromBottom = terminalDistanceFromBottom(terminal);
  if (terminalAtLatest(terminal)) {
    return () => {
      terminal.scrollTop = terminal.scrollHeight;
    };
  }
  const anchor = terminalBottomTextAnchor(terminal);
  return () => {
    const anchorBottom = terminalTextAnchorBottom(anchor);
    if (anchorBottom !== null) {
      terminal.scrollTop += anchorBottom - anchor.bottom;
      return;
    }
    terminal.scrollTop = terminal.scrollHeight - terminal.clientHeight - distanceFromBottom;
  };
}

function terminalBottomTextAnchor(terminal) {
  const terminalRect = terminal.getBoundingClientRect();
  const textNodes = [];
  const walker = document.createTreeWalker(terminal, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (let nodeIndex = textNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    const range = document.createRange();
    range.selectNodeContents(textNodes[nodeIndex]);
    const rects = [...range.getClientRects()];
    range.detach();
    for (let rectIndex = rects.length - 1; rectIndex >= 0; rectIndex -= 1) {
      const rect = rects[rectIndex];
      if (rect.width > 0 && rect.height > 0 && rect.top < terminalRect.bottom && rect.bottom > terminalRect.top) {
        return { node: textNodes[nodeIndex], rectIndex, bottom: rect.bottom };
      }
    }
  }

  return null;
}

function terminalTextAnchorBottom(anchor) {
  if (!anchor?.node?.isConnected) return null;
  const range = document.createRange();
  range.selectNodeContents(anchor.node);
  const rects = [...range.getClientRects()];
  range.detach();
  return rects[anchor.rectIndex]?.bottom ?? null;
}

function followTerminalToLatestDuringLayout(terminal, durationMs) {
  const startedAt = performance.now();
  const follow = (now) => {
    applyFlowSplitSize();
    scrollTerminalToLatestNow(terminal);
    if (now - startedAt < durationMs) requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
}

function agentWorkingForFlow(flow) {
  const agentEnabled = repoUrlConfigured();
  return Boolean(
    agentEnabled &&
      flow &&
      (state.messageSubmittingFlowId === flow.id ||
        flowAgentRunning(flow) ||
        (state.interruptSubmitting && flowRuntimeKind(flow) === "agent")),
  );
}

function syncAgentWorkingPushState(flowId, agentWorking) {
  if (agentWorking && flowId === state.selectedFlowId) requestFlowSnapshot(flowId);
}

function requestFlowSnapshot(flowId) {
  if (!flowId || flowSnapshotRequestingIds.has(flowId)) return;
  flowSnapshotRequestingIds.add(flowId);
  void wsRequest("flow", { flowId }).then((data) => {
    if (data.flow) upsertFlow(data.flow);
  }).catch(() => {}).finally(() => {
    flowSnapshotRequestingIds.delete(flowId);
  });
}

function appendTerminalWorkingBlock(fragment, runtimeKind = "agent") {
  const block = document.createElement("section");
  block.className = `terminal-entry terminal-entry-working terminal-entry-working-${runtimeKind}`;
  block.setAttribute("aria-live", "polite");

  const body = document.createElement("div");
  body.className = "terminal-entry-body agent-working agent-turn-working";

  const dots = document.createElement("span");
  dots.className = "agent-working-dots";
  dots.setAttribute("aria-label", "Agent working");
  dots.innerHTML = "<span>.</span><span>.</span><span>.</span>";

  body.replaceChildren(dots);
  block.replaceChildren(body);
  fragment.appendChild(block);
}

function terminalGroupSignaturePart(group) {
  const logIds = group.logIds || [group.id];
  const firstLogId = logIds[0] ?? group.id;
  const lastLogId = logIds[logIds.length - 1] ?? group.id;
  const children = group.children?.length ? `[${group.children.map((child) => terminalGroupSignaturePart(child)).join(",")}]` : "";
  return [
    group.source,
    firstLogId,
    lastLogId,
    logIds.length,
    group.createdAt,
    group.lastAt,
    String(group.message || "").length,
    children,
  ].join(":");
}

function terminalGroupsSignature(groups) {
  return groups.map((group) => terminalGroupSignaturePart(group)).join("\u001f");
}

function terminalVisibleTurnCount(flowId) {
  return state.terminalVisibleTurnCounts.get(flowId) || AGENT_TRACE_INITIAL_TURN_COUNT;
}

function visibleTerminalGroups(flowId, groups) {
  const startIndex = terminalVisibleTurnStartIndex(flowId, groups);
  return groups.slice(startIndex);
}

function terminalTraceCanLoadMore(flowId, groups) {
  return terminalVisibleTurnStartIndex(flowId, groups) > 0 || !state.logOlderCompleteFlowIds.has(flowId);
}

function terminalVisibleTurnStartIndex(flowId, groups) {
  const visibleTurns = terminalVisibleTurnCount(flowId);
  let seenTurns = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (!isUserLogSource(groups[index].source)) continue;
    seenTurns += 1;
    if (seenTurns >= visibleTurns) return index;
  }
  return 0;
}

function terminalTurnCount(groups) {
  return groups.filter((group) => isUserLogSource(group.source)).length;
}

function scheduleLogRender(id, options = {}) {
  if (!id) return;
  const existing = state.pendingLogRenders.get(id) || {};
  state.pendingLogRenders.set(id, {
    force: Boolean(existing.force || options.force),
    scrollToLatest: Boolean(existing.scrollToLatest || options.scrollToLatest),
  });
  if (state.logRenderFrame) return;
  state.logRenderFrame = requestAnimationFrame(() => {
    state.logRenderFrame = 0;
    const entries = [...state.pendingLogRenders.entries()];
    state.pendingLogRenders.clear();
    for (const [flowId, renderOptions] of entries) renderLogs(flowId, renderOptions);
  });
}

function renderLogs(id, options = {}) {
  if (id !== state.selectedFlowId) return;
  const terminal = els.flowPane.querySelector(".terminal");
  renderShellOutputPane(id);
  const flow = state.flows.find((item) => item.id === id) || null;
  const logs = state.logs.get(id) || [];
  const allGroups = terminalGroups(logs, flow);
  const groups = visibleTerminalGroups(id, allGroups);
  const canLoadMore = terminalTraceCanLoadMore(id, allGroups);
  const loadMoreLoading = state.logOlderLoadingFlowIds.has(id);
  const agentWorking = agentWorkingForFlow(flow);
  const agentWorkingKind = agentWorking ? "agent" : "idle";
  syncAgentWorkingPushState(id, agentWorking);
  const signature = `${terminalGroupsSignature(groups)}\u001fworking:${agentWorking}:${agentWorkingKind}\u001fload-more:${canLoadMore}:${loadMoreLoading}`;
  if (
    terminal._flowLogFlowId === id &&
    terminal._flowLogSignature &&
    !options.force &&
    ((terminalTraceInteractionActive(terminal) && !options.fromTraceFlush) ||
      (!options.scrollToLatest && !agentWorking && (state.terminalFollowPaused || !terminalAtLatest(terminal))))
  ) {
    deferTerminalLogRender(terminal, id, options);
    return;
  }

  if (terminal._flowLogFlowId === id && terminal._flowLogSignature === signature && !options.force) {
    if (options.scrollToLatest) scrollTerminalToLatest(terminal);
    return;
  }

  const atLatest = options.scrollToLatest || terminalAtLatest(terminal);
  const scrollHeightBeforeRender = terminal.scrollHeight;
  const scrollTopBeforeRender = terminal.scrollTop;
  const animateIncoming = !options.suppressIncoming;
  const previousKeys = terminal._flowLogFlowId === id ? terminal._flowLogRenderedKeys : null;
  const nextKeys = new Set(groups.map((group) => terminalGroupRenderKey(group)));
  const fragment = document.createDocumentFragment();
  if (canLoadMore) appendTerminalLoadMoreButton(fragment, { loading: loadMoreLoading });
  for (const group of groups) {
    const renderKey = terminalGroupRenderKey(group);
    appendTerminalBlock(fragment, group, { incoming: Boolean(animateIncoming && previousKeys && !previousKeys.has(renderKey)) });
  }
  if (agentWorking) appendTerminalWorkingBlock(fragment);
  terminal.replaceChildren(fragment);
  applyTerminalMessageClamps(terminal);
  terminal._flowLogFlowId = id;
  terminal._flowLogSignature = signature;
  terminal._flowLogRenderedKeys = nextKeys;
  terminal._flowLogPending = "";
  terminal._flowLogPendingOptions = null;
  if (atLatest) scrollTerminalToLatestNow(terminal);
  else if (options.preserveScrollTop) {
    terminal.scrollTop = scrollTopBeforeRender + (terminal.scrollHeight - scrollHeightBeforeRender);
  }
  renderShellOutputPane(id);
}

function appendTerminalLoadMoreButton(fragment, options = {}) {
  const row = document.createElement("div");
  row.className = "terminal-load-more-row";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "terminal-load-more";
  button.disabled = Boolean(options.loading);
  button.textContent = options.loading ? "loading..." : "load more";

  row.replaceChildren(button);
  fragment.appendChild(row);
}

function terminalTraceInteractionActive(terminal) {
  return Boolean(terminal?.querySelector(".terminal-trace-animating"));
}

function mergeLogRenderOptions(existing = {}, incoming = {}) {
  return {
    force: Boolean(existing.force || incoming.force),
    scrollToLatest: Boolean(existing.scrollToLatest || incoming.scrollToLatest),
    suppressIncoming: Boolean(existing.suppressIncoming || incoming.suppressIncoming),
    fromTraceFlush: Boolean(existing.fromTraceFlush || incoming.fromTraceFlush),
    preserveScrollTop: Boolean(existing.preserveScrollTop || incoming.preserveScrollTop),
  };
}

function deferTerminalLogRender(terminal, flowId, options = {}) {
  terminal._flowLogPending = flowId;
  terminal._flowLogPendingOptions = mergeLogRenderOptions(terminal._flowLogPendingOptions || {}, options);
}

function flushDeferredTerminalLogRender(terminal, options = {}) {
  const pendingFlowId = terminal?._flowLogPending;
  if (!pendingFlowId) return;
  const pendingOptions = mergeLogRenderOptions(terminal._flowLogPendingOptions || {}, options);
  terminal._flowLogPending = "";
  terminal._flowLogPendingOptions = null;
  renderLogs(pendingFlowId, pendingOptions);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rejectPendingWsRequests(error) {
  for (const pending of pendingWsRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  pendingWsRequests.clear();
}

function handleWsResponse(message) {
  const pending = pendingWsRequests.get(message.requestId);
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingWsRequests.delete(message.requestId);
  if (message.error) pending.reject(new Error(message.error));
  else pending.resolve(message.payload || {});
  return true;
}

function ensureWs() {
  if (realtimeWs?.readyState === WebSocket.OPEN) return Promise.resolve(realtimeWs);
  if (realtimeWs?.readyState === WebSocket.CONNECTING && realtimeWsOpenPromise) return realtimeWsOpenPromise;
  return connectWs();
}

function wsRequest(method, params = {}) {
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

function connectWs() {
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
        void loadLogs(flow.id);
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

function resizeFlowSplitFromPointer(clientY) {
  const content = els.flowPane.querySelector(".flow-content");
  const rect = content.getBoundingClientRect();
  if (!rect.height) return;
  setFlowSplitSize(((clientY - rect.top) / rect.height) * 100);
}

function startFlowSplitResize(event) {
  event.preventDefault();
  if (state.linearPaneHidden) setLinearPaneHidden(false);
  document.body.classList.add("flow-resizing");
  resizeFlowSplitFromPointer(event.clientY);

  const onPointerMove = (moveEvent) => resizeFlowSplitFromPointer(moveEvent.clientY);
  const onPointerUp = () => {
    document.body.classList.remove("flow-resizing");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function resizeTicketDrawerFromPointer(clientX) {
  if (state.ticketDrawerHidden) return;
  const rect = els.ticketDrawer.getBoundingClientRect();
  if (!rect.width) return;
  setTicketDrawerSize(clientX - rect.left);
}

function startTicketDrawerResize(event) {
  if (state.ticketDrawerHidden) return;
  event.preventDefault();
  event.stopPropagation();
  document.body.classList.add("ticket-drawer-resizing");
  resizeTicketDrawerFromPointer(event.clientX);

  const onPointerMove = (moveEvent) => resizeTicketDrawerFromPointer(moveEvent.clientX);
  const onPointerUp = () => {
    document.body.classList.remove("ticket-drawer-resizing");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function handleTicketDrawerResizeKeydown(event) {
  if (state.ticketDrawerHidden || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Home") {
    setTicketDrawerSize(TICKET_DRAWER_MIN_SIZE);
    return;
  }
  if (event.key === "End") {
    setTicketDrawerSize(TICKET_DRAWER_MAX_SIZE);
    return;
  }
  setTicketDrawerSize(state.ticketDrawerSize + (event.key === "ArrowRight" ? 10 : -10));
}

function resizeShellOutputSplitFromPointer(clientX) {
  const context = shellOutputSplitResizeContext();
  if (!context) return;
  resizeShellOutputSplitFromPointerWithContext(clientX, context);
}

function setShellOutputSplitSizeKeepingTerminalBottom(value) {
  const restoreTerminalBottom = terminalBottomRestorer();
  setShellOutputSplitSize(value);
  restoreTerminalBottom();
}

function shellOutputSplitResizeContext() {
  const panel = els.flowPane.querySelector(".terminal-panel");
  const rect = panel.getBoundingClientRect();
  if (!rect.width) return null;
  const resizer = panel.querySelector(".shell-output-resizer");
  return {
    panel,
    rect,
    resizer,
    bounds: shellOutputSplitBounds(panel, rect),
  };
}

function shellOutputSplitSizeFromPointer(clientX, context) {
  return ((context.rect.right - clientX) / context.rect.width) * 100;
}

function resizeShellOutputSplitFromPointerWithContext(clientX, context) {
  state.shellOutputSplitSize = constrainedShellOutputSplitSize(shellOutputSplitSizeFromPointer(clientX, context), context.bounds);
  writeShellOutputSplitSize(context.panel, context.resizer, state.shellOutputSplitSize, context.bounds);
}

function startShellOutputSplitResize(event) {
  event.preventDefault();
  if (state.shellPaneHidden) setShellPaneHidden(false);
  const resizeContext = shellOutputSplitResizeContext();
  if (!resizeContext) return;
  const restoreTerminalBottom = terminalBottomRestorer();
  document.body.classList.add("shell-output-resizing");
  resizeShellOutputSplitFromPointerWithContext(event.clientX, resizeContext);

  let pendingClientX = event.clientX;
  let resizeFrame = 0;
  const flushResize = () => {
    resizeFrame = 0;
    resizeShellOutputSplitFromPointerWithContext(pendingClientX, resizeContext);
  };
  const onPointerMove = (moveEvent) => {
    pendingClientX = moveEvent.clientX;
    if (!resizeFrame) resizeFrame = requestAnimationFrame(flushResize);
  };
  const onPointerUp = (upEvent) => {
    pendingClientX = upEvent.clientX;
    if (resizeFrame) {
      cancelAnimationFrame(resizeFrame);
      flushResize();
    }
    document.body.classList.remove("shell-output-resizing");
    localStorage.setItem(SHELL_OUTPUT_SPLIT_SIZE_KEY, String(state.shellOutputSplitSize));
    restoreTerminalBottom();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

els.settingsToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleSettingsCollapsed();
});

els.themeToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleTheme();
});

els.settingsPane.addEventListener("click", () => {
  if (state.settingsCollapsed) setSettingsCollapsed(false);
});

els.settingsPane.addEventListener("keydown", (event) => {
  if (event.target !== els.settingsPane) return;
  if (!state.settingsCollapsed || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  setSettingsCollapsed(false);
});

els.ticketDrawer.addEventListener("click", (event) => {
  if (!state.ticketDrawerHidden || event.target !== els.ticketDrawer) return;
  setTicketDrawerHidden(false);
});

els.ticketDrawer.addEventListener("keydown", (event) => {
  if (event.target !== els.ticketDrawer) return;
  if (!state.ticketDrawerHidden || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  setTicketDrawerHidden(false);
});

els.ticketDrawerResizer.addEventListener("pointerdown", startTicketDrawerResize);
els.ticketDrawerResizer.addEventListener("keydown", handleTicketDrawerResizeKeydown);

els.settingsPane.addEventListener(
  "wheel",
  (event) => {
    if (state.settingsCollapsed || event.target.closest(".settings-content")) return;
    els.settingsContent.scrollTop += event.deltaY;
    event.preventDefault();
  },
  { passive: false },
);

els.settingsContent.addEventListener("click", (event) => {
  const toggle = event.target.closest(".settings-section-toggle");
  if (!toggle) return;
  toggleSettingsSection(toggle.closest(".settings-section"));
});

els.settingsContent.addEventListener("scroll", resetSettingsHorizontalScroll);

els.repoUrl.addEventListener("input", () => {
  scheduleRepoConfigSave();
  renderFlowPane();
});
els.repoUrl.addEventListener("blur", () => void saveRepoConfig().catch(reportAutoSaveError));
els.serveCommand.addEventListener("input", scheduleRepoConfigSave);
els.serveCommand.addEventListener("blur", () => void saveRepoConfig().catch(reportAutoSaveError));
els.agentDeveloperInstructions.addEventListener("input", scheduleAgentConfigSave);
els.agentDeveloperInstructions.addEventListener("blur", () => void saveAgentConfig().catch(reportAutoSaveError));
els.resetAgentDeveloperInstructions.addEventListener("click", () => {
  els.agentDeveloperInstructions.value = state.defaultAgentDeveloperInstructions;
  void saveAgentConfig().catch(reportAutoSaveError);
});
els.envEditor.addEventListener("input", handleEnvEditorInput);
els.envEditor.addEventListener("change", handleEnvEditorChange);
els.envEditor.addEventListener("click", handleEnvEditorClick);
els.envEditor.addEventListener("focusin", handleEnvEditorFocusIn);
els.envEditor.addEventListener("paste", handleEnvEditorPaste);
els.envEditor.addEventListener("focusout", handleEnvEditorFocusOut);
window.addEventListener("pagehide", flushEnvSaveOnPageHide);

els.linearKeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = els.linearApiKey.value.trim();
  if (!apiKey) return;
  try {
    const data = await api("/api/linear/config", {
      method: "PUT",
      body: JSON.stringify({ apiKey }),
    });
    els.linearApiKey.value = "";
    updateLinearState({ signedIn: true, viewerName: data.viewer.name });
    await loadLinearTickets();
  } catch (error) {
    alert(error.message);
    els.ticketState.textContent = error.message;
  }
});

els.refreshLinearTickets.addEventListener("click", () => void loadLinearTickets({ refreshDetails: true }));
els.createLinearTicket.addEventListener("click", () => void createPinnedLinearTicket());
els.searchLinearTickets.addEventListener("click", openTicketSearch);
els.closeTicketSearch.addEventListener("click", closeTicketSearch);
els.ticketSearchInput.addEventListener("input", () => {
  state.ticketSearchQuery = els.ticketSearchInput.value;
  renderTickets();
});
els.ticketSearchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeTicketSearch();
});
els.ticketGrid.addEventListener("dragover", handleTicketGridDragOver);

els.flowPane.querySelector(".flow-resizer").addEventListener("pointerdown", startFlowSplitResize);
els.flowPane.querySelector(".flow-resizer").addEventListener("dblclick", toggleLinearPaneHidden);
els.flowPane.querySelector(".flow-resizer").addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  if (state.linearPaneHidden) setLinearPaneHidden(false);
  setFlowSplitSize(state.flowSplitSize + (event.key === "ArrowDown" ? 5 : -5));
});

els.flowPane.querySelector(".shell-output-resizer").addEventListener("pointerdown", startShellOutputSplitResize);
els.flowPane.querySelector(".shell-output-resizer").addEventListener("dblclick", toggleShellPaneHidden);
els.flowPane.querySelector(".shell-output-resizer").addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  if (state.shellPaneHidden) setShellPaneHidden(false);
  setShellOutputSplitSizeKeepingTerminalBottom(state.shellOutputSplitSize + (event.key === "ArrowLeft" ? 5 : -5));
});
els.flowPane.querySelector(".linear-pane-rail").addEventListener("click", () => setLinearPaneHidden(false));
els.flowPane.querySelector(".shell-pane-rail").addEventListener("click", () => setShellPaneHidden(false));
els.flowPane.addEventListener("click", handleLinearDetailClick);
els.flowPane.addEventListener("pointerdown", startMarkdownTableColumnResize);
els.flowPane.addEventListener("scroll", () => scheduleMarkdownCodeCopyPositionUpdate(), { capture: true, passive: true });
window.addEventListener("resize", () => scheduleMarkdownCodeCopyPositionUpdate(), { passive: true });

els.flowPane.querySelector(".terminal").addEventListener("scroll", (event) => {
  const terminal = event.currentTarget;
  if (terminalAtLatest(terminal)) resumeTerminalFollow();
  if (!terminal._flowLogPending || !terminalAtLatest(terminal)) return;
  flushDeferredTerminalLogRender(terminal, { scrollToLatest: true });
});

els.flowPane.querySelector(".terminal").addEventListener("click", (event) => {
  const loadMore = event.target.closest(".terminal-load-more");
  if (loadMore) {
    event.preventDefault();
    event.stopPropagation();
    if (!loadMore.disabled) void loadOlderTerminalTraceMessages({ preserveScrollTop: true });
    return;
  }

  const toggle = event.target.closest(".terminal-markdown-toggle");
  if (!toggle) return;
  event.preventDefault();
  event.stopPropagation();
  toggleTerminalMarkdownOutput(toggle);
  if (event.detail > 0) toggle.blur();
});

els.flowPane.querySelector(".terminal").addEventListener(
  "wheel",
  (event) => {
    if (event.deltaY < 0) pauseTerminalFollow();
  },
  { passive: true },
);

els.flowPane.querySelector(".terminal").addEventListener(
  "touchmove",
  () => {
    if (!terminalAtLatest(els.flowPane.querySelector(".terminal"))) pauseTerminalFollow();
  },
  { passive: true },
);

promptInput().addEventListener("input", () => {
  cancelHistorySearch();
  resetInputHistoryNavigation();
  state.slashCommandIndex = 0;
  updateMessageInputMode();
  resizeMessageInput();
  renderSlashMenu();
  saveActiveTicketInputState();
});

promptInput().addEventListener("beforeinput", (event) => {
  handleQueuedPromptBeforeInput(event);
});

promptInput().addEventListener("paste", (event) => {
  const files = pastedImageFiles(event);
  if (!files.length) return;
  event.preventDefault();
  void uploadAgentImages(files);
});

shellInput().addEventListener("input", () => {
  cancelHistorySearch();
  resetInputHistoryNavigation();
  saveActiveTicketInputState();
});

els.flowPane.querySelector(".agent-image-context").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-index]");
  if (!button) return;
  state.pendingAgentImages.splice(Number(button.dataset.index), 1);
  renderFlowPane();
});

document.addEventListener("dragenter", (event) => {
  if (!eventHasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  state.agentImageDragDepth += 1;
  focusPromptInputForImageDrag(event);
  setAgentImageDragActive(true);
}, true);

document.addEventListener("dragover", (event) => {
  if (!eventHasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "copy";
  focusPromptInputForImageDrag(event);
  setAgentImageDragActive(true);
}, true);

document.addEventListener("dragleave", (event) => {
  if (!eventHasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (!document.documentElement.contains(event.relatedTarget)) state.agentImageDragDepth = 0;
  else state.agentImageDragDepth = Math.max(0, state.agentImageDragDepth - 1);
  if (!state.agentImageDragDepth) setAgentImageDragActive(false);
}, true);

document.addEventListener("drop", (event) => {
  if (!eventHasDraggedFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  const files = droppedImageFiles(event);
  state.agentImageDragDepth = 0;
  setAgentImageDragActive(false);
  if (files.length) void uploadAgentImages(files);
}, true);

promptInput().addEventListener("keydown", (event) => {
  const input = event.currentTarget;
  const menu = els.flowPane.querySelector(".slash-menu");
  const matches = slashCommandMatches(input.value);

  if (handleQueuedPromptKeydown(event)) return;
  if (handleHistorySearchKeydown(event)) return;

  if (!menu.hidden && matches.length) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.slashCommandIndex = (state.slashCommandIndex + 1) % matches.length;
      renderSlashMenu();
      return;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.slashCommandIndex = (state.slashCommandIndex - 1 + matches.length) % matches.length;
      renderSlashMenu();
      return;
    } else if (event.key === "Tab") {
      handleInputPaneTabKeydown(event);
      return;
    } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      const command = matches[state.slashCommandIndex];
      if (!command) return;
      if (input.value.trim() !== command.name) {
        input.value = command.name;
        resizeMessageInput();
      }
      if (slashCommandHasExpansions(command.name)) {
        state.slashCommandIndex = 0;
        renderSlashMenu();
        return;
      }
      if (!validSlashCommand(input.value)) return;
      hideSlashMenu();
      input.form?.requestSubmit();
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideSlashMenu();
      return;
    }
  }

  if (handleInputPaneTabKeydown(event)) return;
  if (handleAgentInterruptKeydown(event)) return;
  if (handleInputHistoryNavigationKeydown(event)) return;

  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (input.value.trim().startsWith("/") && !validSlashCommand(input.value)) return;
    hideSlashMenu();
    input.form?.requestSubmit();
  }
});

shellInput().addEventListener("keydown", (event) => {
  const input = event.currentTarget;
  if (handleShellInterruptKeydown(event)) return;
  if (handleHistorySearchKeydown(event)) return;
  if (handleInputPaneTabKeydown(event)) return;
  if (handleInputHistoryNavigationKeydown(event)) return;
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    if (event.shiftKey) return;
    void submitShellCommand(input.value);
  }
});

async function submitShellCommand(value) {
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

els.flowPane.querySelector(".slash-menu").addEventListener("mouseover", (event) => {
  const button = event.target.closest(".slash-command");
  if (!button) return;
  const buttons = [...els.flowPane.querySelectorAll(".slash-command")];
  const index = buttons.indexOf(button);
  if (index < 0 || index === state.slashCommandIndex) return;
  state.slashCommandIndex = index;
  renderSlashMenu();
});

els.flowPane.querySelector(".slash-menu").addEventListener("mousedown", (event) => {
  const command = event.target.closest(".slash-command")?.dataset.command;
  if (!command) return;
  event.preventDefault();
  promptInput().value = command;
  resizeMessageInput();
  saveActiveTicketInputState();
  if (slashCommandHasExpansions(command)) {
    state.slashCommandIndex = 0;
    renderSlashMenu();
  } else {
    hideSlashMenu();
  }
  promptInput().focus();
});

els.flowPane.querySelector(".message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void submitPromptMessage();
});

async function submitPromptMessage() {
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
  const submittedImages = [...state.pendingAgentImages];
  const agentMessage = agentMessageWithImages(message || "Use the attached image context.", submittedImages);
  rememberInputHistory(message, "prompt");
  cancelHistorySearch();
  resetInputHistoryNavigation();
  const initialFlow = selectedFlow();
  state.messageSubmitting = true;
  state.messageSubmittingFlowId = initialFlow?.id || "";
  input.value = "";
  state.pendingAgentImages = [];
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
    state.pendingAgentImages = [...submittedImages, ...state.pendingAgentImages];
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

els.diffModal?.addEventListener("click", (event) => {
  const fileButton = event.target.closest?.(".diff-summary-file");
  if (fileButton) {
    setSelectedDiffFile(fileButton.dataset.diffPath || "", { scroll: true });
    return;
  }
  if (event.target === els.diffModal) closeDiffViewer();
});
els.diffModal?.querySelector(".diff-modal-code")?.addEventListener("scroll", scheduleSelectedDiffFileSync, { passive: true });
els.imagePreviewModal?.addEventListener("click", (event) => {
  if (event.target === els.imagePreviewModal) closeImagePreview();
});
els.flowPane.addEventListener("click", handleImagePreviewClick);

let titleResizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(titleResizeFrame);
  titleResizeFrame = requestAnimationFrame(() => {
    applyShellOutputSplitSize();
    renderFlowPane();
  });
});

document.addEventListener("keydown", handleCommandK, true);
document.addEventListener("keydown", handleCommandE, true);
document.addEventListener("keydown", handlePaneVisibilityShortcuts, true);
document.addEventListener("visibilitychange", acknowledgeSelectedLinearIssueNotification);
window.addEventListener("focus", acknowledgeSelectedLinearIssueNotification);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.imagePreviewModal && !els.imagePreviewModal.hidden) {
    event.preventDefault();
    closeImagePreview();
    return;
  }
  if (event.key === "Escape" && state.diffModalFlowId) {
    event.preventDefault();
    closeDiffViewer();
    return;
  }
  if (handleInputPaneTabKeydown(event)) return;
  if (handleGlobalHistorySearchKeydown(event)) return;
  if (focusMessageInputForKey(event)) return;
  if (event.key === "Escape") event.preventDefault();
});

bootstrap().catch((error) => {
  console.error(error);
  alert(error.message);
});
