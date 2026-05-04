import { renderInlineMarkdown, renderLinearMarkdown } from "./linear-markdown.js";

const COLLAPSED_LINEAR_STATUSES_KEY = "flow.collapsedLinearStatuses";
const FLOW_SPLIT_SIZE_KEY = "flow.topPaneSize";
const THEME_KEY = "flow.theme";
const DEFAULT_COLLAPSED_LINEAR_STATUSES = ["backlog", "canceled"];
const LINEAR_STATUS_ORDER = ["in-review", "in-eng", "triage", "ready-for-eng", "backlog", "canceled"];
const AGENT_WORKING_POLL_INTERVAL_MS = 2500;
const SLASH_COMMANDS = [
  { name: "/clear", description: "Start a fresh Codex thread for this flow" },
  { name: "/compact", description: "Compact the current Codex thread context" },
  { name: "/fast", description: "Toggle fast mode for this flow" },
];

function initialCollapsedLinearStatuses() {
  const raw = localStorage.getItem(COLLAPSED_LINEAR_STATUSES_KEY);
  if (raw === null) return new Set(DEFAULT_COLLAPSED_LINEAR_STATUSES);
  try {
    return new Set(JSON.parse(raw));
  } catch {
    return new Set(DEFAULT_COLLAPSED_LINEAR_STATUSES);
  }
}

function initialFlowSplitSize() {
  const value = Number(localStorage.getItem(FLOW_SPLIT_SIZE_KEY) || 50);
  return clampFlowSplitSize(Number.isFinite(value) ? value : 50);
}

function initialTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function clampFlowSplitSize(value) {
  return Math.min(100, Math.max(0, value));
}

const state = {
  stages: [],
  flows: [],
  linearTickets: [],
  linearTicketsLoaded: false,
  linearViewer: null,
  linearViewerName: "",
  linearSignedIn: false,
  selectedLinearIssueId: localStorage.getItem("flow.selectedLinearIssueId") || "",
  selectedFlowId: localStorage.getItem("flow.selectedFlowId") || "",
  linearDetails: new Map(),
  logs: new Map(),
  lastLogId: new Map(),
  settingsCollapsed: true,
  theme: initialTheme(),
  collapsedLinearStatuses: initialCollapsedLinearStatuses(),
  flowSplitSize: initialFlowSplitSize(),
  slashCommandIndex: 0,
  messageSubmitting: false,
  interruptSubmitting: false,
  agentWorkingPollFlowId: "",
  agentWorkingPollTimer: 0,
  agentWorkingPollInFlight: false,
  draggingLinearIssueId: "",
  suppressTicketClick: false,
  defaultAgentDeveloperInstructions: "",
};

const els = {
  settingsPane: document.querySelector("#settingsPane"),
  settingsToggle: document.querySelector("#settingsToggle"),
  themeToggle: document.querySelector("#themeToggle"),
  repoUrl: document.querySelector("#repoUrl"),
  serveCommand: document.querySelector("#serveCommand"),
  agentDeveloperInstructions: document.querySelector("#agentDeveloperInstructions"),
  resetAgentDeveloperInstructions: document.querySelector("#resetAgentDeveloperInstructions"),
  linearKeyForm: document.querySelector("#linearKeyForm"),
  linearApiKey: document.querySelector("#linearApiKey"),
  refreshLinearTickets: document.querySelector("#refreshLinearTickets"),
  linearState: document.querySelector("#linearState"),
  envEditor: document.querySelector("#envEditor"),
  ticketState: document.querySelector("#ticketState"),
  ticketGrid: document.querySelector("#ticketGrid"),
  flowPane: document.querySelector("#flowPane"),
};

let repoConfigSaveTimer = 0;
let agentConfigSaveTimer = 0;
let envSaveTimer = 0;
let lastSavedRepoConfig = "";
let lastSavedAgentConfig = "";
let lastSavedEnv = "";

function linearStatusName(ticket) {
  return ticket.state?.name || "No status";
}

function linearStatusId(ticket) {
  return ticket.state?.id || "";
}

function linearPriorityLabel(priority) {
  const value = Number(priority);
  if (value === 1) return "Urgent priority";
  if (value === 2) return "High priority";
  if (value === 3) return "Medium priority";
  if (value === 4) return "Low priority";
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

function renderLinearPriorityIcon(priority) {
  const barCount = linearPriorityBarCount(priority);
  const label = linearPriorityLabel(priority);
  if (!barCount || !label) return "";
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body;
}

function toast(message) {
  console.log(message);
}

function slashCommandMatches(value) {
  const query = value.trimStart();
  if (!query.startsWith("/") || /\s/.test(query.slice(1))) return [];
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(query));
}

function hideSlashMenu() {
  const menu = els.flowPane.querySelector(".slash-menu");
  menu.hidden = true;
  menu.replaceChildren();
}

function renderSlashMenu() {
  const input = els.flowPane.querySelector(".message-input");
  const menu = els.flowPane.querySelector(".slash-menu");
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
  const input = els.flowPane.querySelector(".message-input");
  const matches = slashCommandMatches(input.value);
  const command = matches[index];
  if (!command) return false;
  input.value = command.name;
  hideSlashMenu();
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

async function saveEnv() {
  clearTimeout(envSaveTimer);
  if (els.envEditor.value === lastSavedEnv) return;
  const result = await api("/api/env", {
    method: "PUT",
    body: JSON.stringify({ contents: els.envEditor.value }),
  });
  lastSavedEnv = els.envEditor.value;
  toast(result.restartedServe ? "Env saved and serve restarted" : "Env saved");
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
  }
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
  state.flowSplitSize = clampFlowSplitSize(value);
  const applied = applyFlowSplitSize();
  state.flowSplitSize = applied;
  localStorage.setItem(FLOW_SPLIT_SIZE_KEY, String(state.flowSplitSize));
}

async function bootstrap() {
  applyTheme(state.theme);
  setSettingsCollapsed(state.settingsCollapsed);
  setFlowSplitSize(state.flowSplitSize);
  const data = await api("/api/bootstrap");
  state.stages = data.stages;
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
  const env = await api("/api/env");
  els.envEditor.value = env.contents || "";
  lastSavedEnv = els.envEditor.value;
  render();
  const flow = selectedFlow();
  if (flow) await loadLogs(flow.id);
  void loadAllLogs();
  if (state.linearSignedIn) await loadLinearTickets();
  connectWs();
}

function render() {
  renderTickets();
  renderFlowPane();
}

function setFlows(flows) {
  state.flows = flows || [];
  syncLinearTicketsWithFlows();
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

function renderAgentContext(flow) {
  const context = els.flowPane.querySelector(".agent-context");
  const branch = context.querySelector(".agent-context-branch");
  context.hidden = !flow;
  context.querySelector(".agent-context-window").textContent = agentContextWindowLabel(flow);
  context.querySelector(".agent-context-model").textContent = agentModelLabel(flow);
  branch.textContent = flow?.branchName || "";
  if (flow?.prUrl) {
    branch.href = flow.prUrl;
    branch.target = "_blank";
    branch.rel = "noreferrer";
    branch.title = flow.prUrl;
  } else {
    branch.removeAttribute("href");
    branch.removeAttribute("target");
    branch.removeAttribute("rel");
    branch.removeAttribute("title");
  }
}

function appendLogEntry(log) {
  const flowId = log.flowId;
  const id = Number(log.id || Date.now());
  if (!state.logs.has(flowId)) state.logs.set(flowId, []);
  const list = state.logs.get(flowId);
  if (list.some((entry) => entry.id === id)) return false;
  list.push({
    id,
    flowId,
    source: log.source,
    message: log.message,
    createdAt: log.createdAt || new Date().toISOString(),
  });
  state.lastLogId.set(flowId, Math.max(state.lastLogId.get(flowId) || 0, id));
  return true;
}

function upsertFlow(flow) {
  if (!flow?.id) return;
  const next = [...state.flows];
  const index = next.findIndex((item) => item.id === flow.id);
  if (index === -1) next.push(flow);
  else next[index] = flow;
  setFlows(next);
}

function syncLinearTicketsWithFlows() {
  if (!state.linearTickets.length) return;
  const flowsByIssue = new Map(state.flows.map((flow) => [flow.linearIssueId, flow]));
  state.linearTickets = state.linearTickets.map((ticket) => {
    const flow = flowsByIssue.get(ticket.identifier);
    const flowId = flow?.id || "";
    const flowStage = flow?.stage || "";
    if (ticket.flowId === flowId && ticket.flowStage === flowStage) return ticket;
    return { ...ticket, flowId, flowStage };
  });
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
  try {
    els.ticketState.textContent = "Loading assigned tickets.";
    const data = await api("/api/linear/issues");
    state.linearViewer = data.viewer;
    state.linearViewerName = data.viewer?.name || state.linearViewerName;
    state.linearTickets = data.issues || [];
    state.linearTicketsLoaded = true;
    if (options.refreshDetails) state.linearDetails.clear();
    syncLinearTicketsWithFlows();
    els.ticketState.textContent = formatLastUpdated();
    els.linearState.textContent = `Linear connected: ${data.viewer.name}`;
    els.linearState.classList.add("live");
    renderTickets();
    renderFlowPane();
  } catch (error) {
    state.linearTickets = [];
    state.linearTicketsLoaded = true;
    renderTickets();
    renderFlowPane();
    els.ticketState.textContent = error.message;
    els.linearState.textContent = "Linear needs attention";
    els.linearState.classList.remove("live");
  }
}

function renderTickets() {
  if (!state.linearTickets.length) {
    els.ticketGrid.replaceChildren();
    els.ticketGrid.dataset.ticketSignature = "";
    return;
  }
  const tickets = sortedLinearTickets(state.linearTickets);
  const groups = groupedTicketsByLinearStatus(tickets);
  const signature = tickets
    .map((ticket) =>
      [
        ticket.identifier,
        ticket.title,
        linearStatusId(ticket),
        linearStatusName(ticket),
        ticket.priority || "",
        ticket.project?.name || "",
        ticket.flowId || "",
        ticket.flowStage || "",
      ].join("\u001f"),
    )
    .join("\u001e")
    .concat("\u001d", [...state.collapsedLinearStatuses].sort().join("\u001f"));

  if (els.ticketGrid.dataset.ticketSignature === signature) {
    for (const card of els.ticketGrid.querySelectorAll(".ticket-card")) {
      updateTicketCardState(card);
    }
    return;
  }

  els.ticketGrid.dataset.ticketSignature = signature;
  const nodes = [];
  for (const group of groups) {
    nodes.push(renderTicketStatusGroup(group));
  }
  els.ticketGrid.replaceChildren(...nodes);
}

function sortedLinearTickets(tickets) {
  return [...tickets].sort((a, b) => Number(Boolean(b.flowId)) - Number(Boolean(a.flowId)));
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
        tickets: [],
        collapsed: state.collapsedLinearStatuses.has(key),
      };
      byKey.set(key, group);
      groups.push(group);
    } else if (!group.stateId) {
      group.stateId = linearStatusId(ticket);
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
  section.addEventListener("dragenter", (event) => handleTicketStatusDragEnter(event, group));
  section.addEventListener("dragover", (event) => handleTicketStatusDragOver(event, group));
  section.addEventListener("dragleave", handleTicketStatusDragLeave);
  section.addEventListener("drop", (event) => handleTicketStatusDrop(event, group));

  const body = document.createElement("div");
  body.className = "ticket-status-group-body";
  const items = document.createElement("div");
  items.className = "ticket-status-group-items";
  items.replaceChildren(...group.tickets.map((ticket) => renderTicketCard(ticket)));
  body.append(items);

  section.append(renderTicketStatusSeparator(group), body);
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

function ticketCanMoveToStatus(issueId, group) {
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  return Boolean(ticket && group.stateId && linearStatusId(ticket) !== group.stateId);
}

function setTicketStatusGroupDragOver(groupElement, active) {
  groupElement.classList.toggle("drag-over", active);
}

function clearTicketDragState() {
  state.draggingLinearIssueId = "";
  for (const element of els.ticketGrid.querySelectorAll(".ticket-status-group.drag-over, .ticket-card.dragging")) {
    element.classList.remove("drag-over", "dragging");
  }
}

function handleTicketStatusDragEnter(event, group) {
  if (!ticketCanMoveToStatus(state.draggingLinearIssueId, group)) return;
  event.preventDefault();
  setTicketStatusGroupDragOver(event.currentTarget, true);
}

function handleTicketStatusDragOver(event, group) {
  if (!ticketCanMoveToStatus(state.draggingLinearIssueId, group)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  setTicketStatusGroupDragOver(event.currentTarget, true);
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
  void moveTicketToLinearStatus(issueId, group);
}

function replaceLinearIssue(issue) {
  state.linearTickets = state.linearTickets.map((ticket) => {
    if (ticket.identifier !== issue.identifier) return ticket;
    return {
      ...ticket,
      ...issue,
      flowId: ticket.flowId || "",
      flowStage: ticket.flowStage || "",
    };
  });

  const cached = state.linearDetails.get(issue.identifier);
  if (cached?.issue) {
    state.linearDetails.set(issue.identifier, { ...cached, issue: { ...cached.issue, ...issue } });
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

function ticketAgentWorking(ticket) {
  const flow = flowForTicket(ticket);
  return Boolean(
    repoUrlConfigured() &&
      flow &&
      (flow.agentStatus === "running" ||
        (flow.id === state.selectedFlowId && (state.messageSubmitting || state.interruptSubmitting))),
  );
}

function updateTicketCardState(card) {
  const ticket = state.linearTickets.find((item) => item.identifier === card.dataset.issue);
  card.classList.toggle("active", card.dataset.issue === state.selectedLinearIssueId);
  card.classList.toggle("agent-turn-active", ticketAgentWorking(ticket));
}

function renderTicketCard(ticket) {
  const card = document.createElement("article");
  card.className = "ticket-card";
  card.classList.toggle("in-flow", Boolean(ticket.flowId));
  card.tabIndex = 0;
  card.role = "button";
  card.draggable = true;
  card.dataset.issue = ticket.identifier;
  updateTicketCardState(card);
  const projectName = ticket.project?.name ? escapeHtml(ticket.project.name) : "";
  const stageName = ticket.flowStage ? escapeHtml(ticket.flowStage) : "";
  card.innerHTML = `
    <span class="ticket-id">${escapeHtml(ticket.identifier)}</span>
    <p class="ticket-title">${escapeHtml(ticket.title)}</p>
    <div class="ticket-meta">
      ${renderLinearPriorityIcon(ticket.priority)}
      ${projectName ? `<span class="ticket-project">${projectName}</span>` : ""}
    </div>
    ${
      ticket.flowId
        ? `<div class="ticket-flow-corner">${stageName ? `<span class="ticket-stage">${stageName}</span>` : ""}<img class="ticket-flow-mark" src="/favicon.svg" alt="In flow" title="In flow"></div>`
        : ""
    }
  `;
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
    openTicketInFlowPane(ticket);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openTicketInFlowPane(ticket);
  });
  return card;
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

async function selectFlow(id) {
  const flow = state.flows.find((item) => item.id === id);
  if (!flow) return;
  state.selectedFlowId = id;
  state.selectedLinearIssueId = flow.linearIssueId;
  localStorage.setItem("flow.selectedFlowId", id);
  localStorage.setItem("flow.selectedLinearIssueId", flow.linearIssueId);
  render();
  await loadLogs(id);
  void loadLinearDetail(flow.linearIssueId);
}

async function openTicketInFlowPane(ticket) {
  const flow = flowForTicket(ticket);
  state.selectedLinearIssueId = ticket.identifier;
  localStorage.setItem("flow.selectedLinearIssueId", ticket.identifier);
  if (flow) {
    state.selectedFlowId = flow.id;
    localStorage.setItem("flow.selectedFlowId", flow.id);
  } else {
    state.selectedFlowId = "";
    localStorage.removeItem("flow.selectedFlowId");
  }
  render();
  if (flow) await loadLogs(flow.id);
  void loadLinearDetail(ticket.identifier);
}

function renderFlowPane() {
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
  const agentRunning = flow?.agentStatus === "running";

  agentPanel.classList.toggle("disabled", !agentEnabled);
  els.flowPane.classList.toggle("empty", !issueId);
  renderAgentContext(flow);
  if (!issueId) {
    stopAgentWorkingPoll();
    return;
  }

  const agentInterrupt = els.flowPane.querySelector(".agent-interrupt");
  agentInterrupt.disabled = state.interruptSubmitting || !agentEnabled || !agentRunning;
  els.flowPane.querySelector(".message-input").disabled = state.messageSubmitting || !agentEnabled || (!flow && !ticket);

  renderLinearDetail({ issueId, title, issueUrl, ticket, flow });
  applyFlowSplitSize();
  if (flow) {
    renderLogs(flow.id);
  } else {
    stopAgentWorkingPoll();
    const terminal = els.flowPane.querySelector(".terminal");
    terminal._flowLogFlowId = "";
    terminal._flowLogSignature = "";
    terminal.textContent = "No agent session yet.";
  }
  void loadLinearDetail(issueId);
}

function renderLinearDetail(context) {
  const container = els.flowPane.querySelector(".linear-detail");
  const cached = state.linearDetails.get(context.issueId);
  const issue = cached?.issue || context.ticket || {
    identifier: context.issueId,
    title: context.title,
    url: context.issueUrl,
  };
  const labels = issue.labels?.nodes || [];
  const comments = [...(issue.comments?.nodes || [])].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  );
  const meta = [
    issue.project?.name,
    issue.assignee?.name ? `Assignee: ${issue.assignee.name}` : "",
    issue.estimate ? `${issue.estimate} pts` : "",
  ].filter(Boolean);
  const priorityMeta = renderLinearPriorityIcon(issue.priority);

  container.innerHTML = `
    <section class="linear-issue">
      <div class="linear-issue-header">
        <div>
          <a href="${escapeAttribute(issue.url || context.issueUrl)}" target="_blank" rel="noreferrer">
            ${escapeHtml(issue.identifier || context.issueId)}
          </a>
          <h3>${escapeHtml(issue.title || context.title)}</h3>
        </div>
      </div>
      <div class="linear-meta">
        ${priorityMeta ? `<span class="linear-meta-priority">${priorityMeta}</span>` : ""}
        ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        ${labels.map((label) => `<span>${escapeHtml(label.name)}</span>`).join("")}
      </div>
      <div class="linear-description linear-markdown">${renderLinearMarkdown(issue.description, "No description.")}</div>
    </section>
    <section class="linear-comments">
      <header>
        <h3>Comments</h3>
        <span>${cached?.loading ? "Loading" : `${comments.length} loaded`}</span>
      </header>
      ${
        cached?.error
          ? `<p class="linear-error">${escapeHtml(cached.error)}</p>`
          : comments.length
            ? comments
                .map(
                  (comment) => `
                    <article class="linear-comment">
                      <header>
                        <strong>${escapeHtml(comment.user?.name || "Unknown")}</strong>
                        <time>${escapeHtml(formatDate(comment.createdAt))}</time>
                      </header>
                      <div class="linear-comment-body linear-markdown">${renderLinearMarkdown(comment.body)}</div>
                    </article>
                  `,
                )
                .join("")
            : `<p class="linear-empty-copy">${cached?.loading ? "Loading comments." : "No comments."}</p>`
      }
    </section>
  `;
}

async function loadLinearDetail(identifier) {
  const cached = state.linearDetails.get(identifier);
  if (cached?.issue || cached?.loading) return;
  state.linearDetails.set(identifier, { loading: true });
  renderFlowPane();
  try {
    const data = await api(`/api/linear/issues/${encodeURIComponent(identifier)}`);
    state.linearDetails.set(identifier, { loading: false, issue: data.issue });
  } catch (error) {
    state.linearDetails.set(identifier, { loading: false, error: error.message });
  }
  renderFlowPane();
}

async function createFlowFromTicket(ticket, options = {}) {
  const data = await api("/api/flows", {
    method: "POST",
    body: JSON.stringify({ issue: ticket.url || ticket.identifier, title: ticket.title }),
  });
  upsertFlow(data.flow);
  render();
  await loadLogs(data.flow.id);
  if (options.select !== false) await selectFlow(data.flow.id);
  return data.flow;
}

async function ensureSelectedFlow() {
  const flow = selectedFlow();
  if (flow) return flow;
  const ticket = selectedTicket();
  if (!ticket) return null;
  return createFlowFromTicket(ticket);
}

async function loadAllLogs() {
  await Promise.all(state.flows.map((flow) => loadLogs(flow.id)));
}

async function loadLogs(id) {
  if (!state.logs.has(id)) state.logs.set(id, []);

  while (true) {
    const after = state.lastLogId.get(id) || 0;
    const data = await api(`/api/flows/${id}/logs?after=${after}`);
    if (!data.logs.length) break;

    let highestLogId = after;
    for (const log of data.logs) {
      highestLogId = Math.max(highestLogId, log.id);
      appendLogEntry(log);
    }

    state.lastLogId.set(id, highestLogId);
    if (data.logs.length < 1000) break;
  }

  renderLogs(id);
}

function logMeta(source) {
  const userLabel = state.linearViewer?.name || state.linearViewerName || "user";
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
    flow: { label: "flow", marker: "*", tone: "status" },
    linear: { label: "linear", marker: "*", tone: "status" },
    serve: { label: "serve", marker: "$", tone: "tool" },
    "serve:stderr": { label: "serve", marker: "!", tone: "error" },
  };
  return map[source] || { label: source || "log", marker: "*", tone: "status" };
}

function normalizeTerminalLog(log) {
  const message = String(log.message || "");
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
    "agent",
    "serve",
    "serve:stderr",
  ].includes(source);
}

function parseTraceGroup(log) {
  if (log.source !== "agent:trace-group") return null;
  try {
    const payload = JSON.parse(String(log.message || "{}"));
    const afterId = Number(payload.afterId);
    const beforeId = Number(payload.beforeId);
    if (!Number.isFinite(afterId) || !Number.isFinite(beforeId) || beforeId <= afterId) return null;
    return {
      afterId,
      beforeId,
      count: Number(payload.count || 0),
      key: `${afterId}:${beforeId}`,
    };
  } catch {
    return null;
  }
}

function traceRangeForLog(log, ranges) {
  return ranges.find((range) => log.id > range.afterId && log.id < range.beforeId) || null;
}

function appendTerminalGroup(groups, log) {
  const previous = groups[groups.length - 1];
  if (previous && previous.source === log.source && isStreamingSource(log.source)) {
    previous.message += log.message;
    previous.lastAt = log.createdAt;
    return previous;
  }
  const group = {
    id: log.id,
    source: log.source,
    message: log.message,
    createdAt: log.createdAt,
    lastAt: log.createdAt,
  };
  groups.push(group);
  return group;
}

function isHiddenTerminalLog(log) {
  const message = String(log.message || "").trim();
  if (log.source === "agent:tool-result" && message === "completed exit 0") return true;
  if (log.source === "agent:tool-result" && message === "failed exit 7") return true;
  if (log.source === "flow" && /^stage changed\b/i.test(message)) return true;
  return (
    log.source === "agent:status" &&
    (/^turn started\b/.test(message) ||
      /^turn completed\b/.test(message) ||
      /^interrupt requested\b/.test(message) ||
      /^[$]\s*codex app-server --listen stdio:\/\/$/i.test(message) ||
      /^Codex thread \S+ ready$/i.test(message))
  );
}

function terminalGroups(logs) {
  const groups = [];
  const traceRanges = logs.map((log) => parseTraceGroup(log)).filter(Boolean);
  const traceGroups = new Map();
  for (const rawLog of logs) {
    const log = normalizeTerminalLog(rawLog);
    if (log.source === "agent:trace-group") continue;
    if (isHiddenTerminalLog(log)) continue;
    const traceRange = traceRangeForLog(log, traceRanges);
    if (traceRange) {
      let traceGroup = traceGroups.get(traceRange.key);
      if (!traceGroup) {
        traceGroup = {
          id: log.id,
          source: "agent:trace-group",
          message: "",
          createdAt: log.createdAt,
          lastAt: log.createdAt,
          children: [],
        };
        traceGroups.set(traceRange.key, traceGroup);
        groups.push(traceGroup);
      }
      appendTerminalGroup(traceGroup.children, log);
      traceGroup.lastAt = log.createdAt;
      continue;
    }
    appendTerminalGroup(groups, log);
  }
  return groups;
}

function formatTerminalMessage(source, message) {
  const text = String(message || "");
  if (source === "agent:tool") return text.trim();
  if (source === "agent:tool-result") return text.trim();
  if (source === "agent:status" || source === "flow" || source === "linear") return text.trim();
  return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

function usesTerminalBlockMarkdown(source) {
  return ["user", "agent", "agent:message", "agent:thinking", "agent:reasoning"].includes(source);
}

function appendTerminalBlock(fragment, group) {
  if (group.source === "agent:trace-group") {
    appendTerminalTraceGroup(fragment, group);
    return;
  }

  const meta = logMeta(group.source);
  const block = document.createElement("section");
  block.className = `terminal-entry terminal-entry-${meta.tone}`;

  if (group.source === "agent:tool") {
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

  const time = document.createElement("time");
  time.className = "terminal-entry-time";
  time.dateTime = group.createdAt;
  time.textContent = new Date(group.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  const body = document.createElement(usesTerminalBlockMarkdown(group.source) ? "div" : "pre");
  body.className = "terminal-entry-body";
  const message = formatTerminalMessage(group.source, group.message);
  body.innerHTML = usesTerminalBlockMarkdown(group.source)
    ? renderLinearMarkdown(message, "", { images: false, links: true })
    : renderInlineMarkdown(message, { images: false, links: false });

  header.replaceChildren(marker, label, time);
  block.replaceChildren(header, body);
  fragment.appendChild(block);
}

function appendTerminalTraceGroup(fragment, group) {
  const meta = logMeta(group.source);
  const details = document.createElement("details");
  details.className = "terminal-trace-group";

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
  time.textContent = new Date(group.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  const body = document.createElement("div");
  body.className = "terminal-trace-body";
  for (const child of group.children || []) appendTerminalBlock(body, child);

  summary.replaceChildren(marker, label, time);
  details.replaceChildren(summary, body);
  fragment.appendChild(details);
}

function scrollTerminalToLatest(terminal) {
  requestAnimationFrame(() => {
    terminal.scrollTop = terminal.scrollHeight;
  });
}

function agentWorkingForFlow(flow) {
  const agentEnabled = repoUrlConfigured();
  return Boolean(agentEnabled && flow && (state.messageSubmitting || state.interruptSubmitting || flow.agentStatus === "running"));
}

function stopAgentWorkingPoll(flowId = "") {
  if (flowId && state.agentWorkingPollFlowId !== flowId) return;
  if (state.agentWorkingPollTimer) clearTimeout(state.agentWorkingPollTimer);
  state.agentWorkingPollFlowId = "";
  state.agentWorkingPollTimer = 0;
}

function scheduleAgentWorkingPoll(flowId) {
  if (state.agentWorkingPollTimer || state.agentWorkingPollInFlight) return;
  state.agentWorkingPollFlowId = flowId;
  state.agentWorkingPollTimer = setTimeout(pollAgentWorkingFlow, AGENT_WORKING_POLL_INTERVAL_MS);
}

function syncAgentWorkingPoll(flowId, agentWorking) {
  if (!agentWorking) {
    stopAgentWorkingPoll(flowId);
    return;
  }
  scheduleAgentWorkingPoll(flowId);
}

async function pollAgentWorkingFlow() {
  const flowId = state.agentWorkingPollFlowId;
  state.agentWorkingPollTimer = 0;
  if (!flowId || flowId !== state.selectedFlowId) {
    stopAgentWorkingPoll(flowId);
    return;
  }

  const flow = state.flows.find((item) => item.id === flowId) || null;
  if (!agentWorkingForFlow(flow)) {
    stopAgentWorkingPoll(flowId);
    return;
  }
  if (state.messageSubmitting || state.interruptSubmitting) {
    scheduleAgentWorkingPoll(flowId);
    return;
  }

  state.agentWorkingPollInFlight = true;
  try {
    const data = await api(`/api/flows/${flowId}/agent/status`);
    if (data.flow) upsertFlow(data.flow);
    render();
  } catch {
    // Keep the polling loop alive; transient fetch failures should not freeze the indicator.
  } finally {
    state.agentWorkingPollInFlight = false;
  }

  const updated = state.flows.find((item) => item.id === flowId) || null;
  if (flowId === state.selectedFlowId && agentWorkingForFlow(updated)) {
    scheduleAgentWorkingPoll(flowId);
  } else {
    stopAgentWorkingPoll(flowId);
  }
}

function appendTerminalWorkingBlock(fragment) {
  const block = document.createElement("section");
  block.className = "terminal-entry terminal-entry-working";
  block.setAttribute("aria-live", "polite");

  const body = document.createElement("div");
  body.className = "terminal-entry-body agent-working";

  const dots = document.createElement("span");
  dots.className = "agent-working-dots";
  dots.setAttribute("aria-label", "Agent working");
  dots.innerHTML = "<span>.</span><span>.</span><span>.</span>";

  body.replaceChildren(dots);
  block.replaceChildren(body);
  fragment.appendChild(block);
}

function renderLogs(id, options = {}) {
  if (id !== state.selectedFlowId) return;
  const terminal = els.flowPane.querySelector(".terminal");
  const logs = state.logs.get(id) || [];
  const groups = terminalGroups(logs);
  const flow = state.flows.find((item) => item.id === id) || null;
  const agentWorking = agentWorkingForFlow(flow);
  syncAgentWorkingPoll(id, agentWorking);
  const signature = `${groups.map((group) => `${group.source}:${group.createdAt}:${group.message}`).join("\u001f")}\u001fworking:${agentWorking}`;
  if (terminal._flowLogFlowId === id && terminal._flowLogSignature === signature && !options.force) {
    if (options.scrollToLatest) scrollTerminalToLatest(terminal);
    return;
  }

  const distanceFromBottom = terminal.scrollHeight - terminal.clientHeight - terminal.scrollTop;
  const atLatest = options.scrollToLatest || distanceFromBottom <= 12;
  const fragment = document.createDocumentFragment();
  for (const group of groups) appendTerminalBlock(fragment, group);
  if (agentWorking) appendTerminalWorkingBlock(fragment);
  terminal.replaceChildren(fragment);
  terminal._flowLogFlowId = id;
  terminal._flowLogSignature = signature;
  if (atLatest) scrollTerminalToLatest(terminal);
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

function connectWs() {
  const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
  ws.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.event === "flows") {
      setFlows(message.payload);
      render();
      await loadAllLogs();
    }
    if (message.event === "log") {
      const { id, flowId, source, message: chunk, createdAt } = message.payload;
      appendLogEntry({
        id,
        flowId,
        source,
        message: chunk,
        createdAt,
      });
      renderLogs(flowId);
    }
  });
  ws.addEventListener("close", () => setTimeout(connectWs, 1000));
}

function resizeFlowSplitFromPointer(clientY) {
  const content = els.flowPane.querySelector(".flow-content");
  const rect = content.getBoundingClientRect();
  if (!rect.height) return;
  setFlowSplitSize(((clientY - rect.top) / rect.height) * 100);
}

function startFlowSplitResize(event) {
  event.preventDefault();
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

els.settingsToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  setSettingsCollapsed(!state.settingsCollapsed);
});

els.themeToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  setTheme(state.theme === "dark" ? "light" : "dark");
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
els.envEditor.addEventListener("input", scheduleEnvSave);
els.envEditor.addEventListener("blur", () => void saveEnv().catch(reportAutoSaveError));

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

els.flowPane.querySelector(".flow-resizer").addEventListener("pointerdown", startFlowSplitResize);
els.flowPane.querySelector(".flow-resizer").addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  setFlowSplitSize(state.flowSplitSize + (event.key === "ArrowDown" ? 5 : -5));
});

els.flowPane.querySelector(".agent-interrupt").addEventListener("click", async () => {
  if (state.interruptSubmitting) return;
  const selected = selectedFlow();
  if (selected?.agentStatus === "running") {
    state.interruptSubmitting = true;
    renderTickets();
    renderFlowPane();
    try {
      await api(`/api/flows/${selected.id}/agent/interrupt`, { method: "POST" });
    } finally {
      state.interruptSubmitting = false;
      renderTickets();
      renderFlowPane();
    }
  }
});

els.flowPane.querySelector(".message-input").addEventListener("input", () => {
  state.slashCommandIndex = 0;
  renderSlashMenu();
});

els.flowPane.querySelector(".message-input").addEventListener("keydown", (event) => {
  const input = event.currentTarget;
  const menu = els.flowPane.querySelector(".slash-menu");
  const matches = slashCommandMatches(input.value);

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
      event.preventDefault();
      selectSlashCommand();
      return;
    } else if (event.key === "Enter" && !event.shiftKey && input.value.trim() !== matches[state.slashCommandIndex]?.name) {
      event.preventDefault();
      selectSlashCommand();
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideSlashMenu();
      return;
    }
  }

  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    hideSlashMenu();
    input.form?.requestSubmit();
  }
});

els.flowPane.querySelector(".slash-menu").addEventListener("mousedown", (event) => {
  const command = event.target.closest(".slash-command")?.dataset.command;
  if (!command) return;
  event.preventDefault();
  els.flowPane.querySelector(".message-input").value = command;
  hideSlashMenu();
  els.flowPane.querySelector(".message-input").focus();
});

els.flowPane.querySelector(".message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.messageSubmitting) return;
  const input = els.flowPane.querySelector(".message-input");
  if (input.disabled) return;
  const message = input.value.trim();
  if (!message) return;
  state.messageSubmitting = true;
  input.value = "";
  hideSlashMenu();
  renderTickets();
  renderFlowPane();
  try {
    const flow = await ensureSelectedFlow();
    if (!flow) return;
    await api(`/api/flows/${flow.id}/message`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  } finally {
    state.messageSubmitting = false;
    renderTickets();
    renderFlowPane();
  }
});

let titleResizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(titleResizeFrame);
  titleResizeFrame = requestAnimationFrame(renderFlowPane);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") event.preventDefault();
});

bootstrap().catch((error) => {
  console.error(error);
  alert(error.message);
});
