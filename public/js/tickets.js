import { renderLinearMarkdown } from "../linear-markdown.js";
import { loadCheckouts } from "./checkouts.js";
import {
  COLLAPSED_LINEAR_STATUSES_KEY,
  DEFAULT_FAVICON_HREF,
  LINEAR_STATUS_ORDER,
  PINNED_LINEAR_ISSUES_KEY,
  TICKET_START_AGENT_FLAME_ANIMATION_VALUES,
  TICKET_START_AGENT_FLAME_PATH,
} from "./constants.js";
import {
  createFlowFromTicket,
  flowAgentRunning,
  flowForLinearIssue,
  flowForTicket,
  flowShellLive,
  openTicketInFlowPane,
  renderFlowPane,
  renderGithubCiPill,
  startTicketAgentSession,
  upsertFlow,
} from "./flows.js";
import { scheduleTicketLogPrefetch } from "./logs.js";
import { api } from "./net.js";
import { clearLinearIssueNotification } from "./notifications.js";
import { repoUrlConfigured } from "./settings.js";
import { els, state } from "./state.js";
import { copyMarkdownCodeBlock, updateMarkdownCodeCopyPositions } from "./terminal-render.js";
import { escapeAttribute, escapeHtml, formatDate, toast } from "./ui.js";

export let ticketDragScrollFrame = 0;

export const TICKET_DRAG_SCROLL_EDGE_PX = 72;

export const TICKET_DRAG_SCROLL_MAX_STEP_PX = 18;

export const LINEAR_PRIORITY_OPTIONS = [
  { priority: 1, name: "Urgent" },
  { priority: 2, name: "High" },
  { priority: 3, name: "Medium" },
  { priority: 4, name: "Low" },
  { priority: 0, name: "No priority" },
];

export function linearStatusName(ticket) {
  return ticket?.state?.name || "No status";
}

export function linearStatusId(ticket) {
  return ticket?.state?.id || "";
}

export function linearStatusType(ticket) {
  return ticket?.state?.type || "";
}

export function linearTeamId(ticket) {
  return ticket?.team?.id || "";
}

export function linearPriorityValue(priority) {
  const value = Number(priority);
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 0;
}

export function linearPriorityName(priority) {
  return LINEAR_PRIORITY_OPTIONS.find((option) => option.priority === linearPriorityValue(priority))?.name || "No priority";
}

export function linearPriorityLabel(priority, options = {}) {
  const value = Number(priority);
  if (value === 1) return "Urgent priority";
  if (value === 2) return "High priority";
  if (value === 3) return "Medium priority";
  if (value === 4) return "Low priority";
  if (options.empty) return "No priority";
  return "";
}

export function linearPriorityBarCount(priority) {
  const value = Number(priority);
  if (value === 1) return 3;
  if (value === 2) return 3;
  if (value === 3) return 2;
  if (value === 4) return 1;
  return 0;
}

export function renderLinearPriorityIcon(priority, options = {}) {
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
    <span class="ticket-priority${urgent ? " urgent" : ""}">
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

export function linearStatusIconKind(status, type = "") {
  const key = linearStatusKey(status);
  if (key === "triage") return "triage";
  if (key === "done" || key === "completed") return "done";
  if (key === "review" || key === "in-review" || key === "reviewing" || key === "needs-review") return "review";
  if (key === "in-qa" || key === "qa") return "in-qa";
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

export function renderLinearStatusIcon(status) {
  const label = typeof status === "object" ? linearStatusName(status) : status || "No status";
  const kind = linearStatusIconKind(label, typeof status === "object" ? linearStatusType(status) : "");
  return `
    <span class="linear-status-icon linear-status-icon-${kind}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}">
      <span class="linear-status-icon-glyph" aria-hidden="true"></span>
    </span>
  `;
}

export function renderLinearStatusPillContent(status, type = "") {
  const label = status || "No status";
  const kind = linearStatusIconKind(label, type);
  return `<span>${escapeHtml(label)}</span><span class="linear-status-icon linear-status-icon-${kind}" aria-hidden="true">
    <span class="linear-status-icon-glyph" aria-hidden="true"></span>
  </span>`;
}

export function linearStatusKey(status) {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "no-status";
}

export function formatLastUpdated(date = new Date()) {
  return `last updated: ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function setLinearStatusCollapsed(status, collapsed) {
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

export function setTicketSearchOpen(open) {
  state.ticketSearchOpen = Boolean(open);
  els.refreshLinearTickets.hidden = state.ticketSearchOpen;
  els.createLinearTicket.hidden = state.ticketSearchOpen;
  els.searchLinearTickets.hidden = state.ticketSearchOpen;
  els.ticketSearchPane.hidden = !state.ticketSearchOpen;
}

export function updateRefreshLinearTicketsButton() {
  els.refreshLinearTickets.disabled = state.linearTicketsLoading;
  els.refreshLinearTickets.setAttribute("aria-busy", String(state.linearTicketsLoading));
  els.refreshLinearTickets.classList.toggle("is-loading", state.linearTicketsLoading);
}

export function openTicketSearch() {
  setTicketSearchOpen(true);
  els.ticketSearchInput.value = state.ticketSearchQuery;
  renderTickets();
  requestAnimationFrame(() => {
    els.ticketSearchInput.focus({ preventScroll: true });
    els.ticketSearchInput.select();
  });
}

export function closeTicketSearch() {
  state.ticketSearchQuery = "";
  els.ticketSearchInput.value = "";
  setTicketSearchOpen(false);
  renderTickets();
}

export function linearIssueUpdatedAtMs(issue) {
  const timestamp = Date.parse(issue?.updatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function mergeLinearIssue(existing, incoming) {
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

export function syncLinearTicketsWithFlows() {
  const flowsByIssue = new Map(state.flows.filter((flow) => !flow.parentFlowId).map((flow) => [flow.linearIssueId, flow]));
  const baseTickets = state.linearTickets.filter((ticket) => !ticket.turbopumpFlowOnly || flowCanRenderTicket(flowsByIssue.get(ticket.identifier)));
  const ticketIds = new Set(baseTickets.map((ticket) => ticket.identifier));
  const tickets = baseTickets.map((ticket) => {
    const flow = flowsByIssue.get(ticket.identifier);
    const flowId = flow?.id || "";
    if (ticket.flowId === flowId) return ticket;
    return { ...ticket, flowId };
  });
  const canAddFlowOnlyTickets = state.linearTicketsLoaded || state.linearTickets.length > 0;
  if (!canAddFlowOnlyTickets) {
    state.linearTickets = tickets;
    return;
  }
  for (const flow of state.flows) {
    if (flow.parentFlowId || !flowCanRenderTicket(flow) || ticketIds.has(flow.linearIssueId)) continue;
    tickets.push({
      identifier: flow.linearIssueId,
      title: flow.title || flow.linearIssueId,
      url: flow.linearIssueUrl || "",
      state: flow.linearStatus ? { name: flow.linearStatus } : null,
      flowId: flow.id,
      turbopumpFlowOnly: true,
    });
  }
  state.linearTickets = tickets;
}

function flowCanRenderTicket(flow) {
  return Boolean(flow?.linearIssueId && flow.linearIssueUrl && flow.title && flow.title !== "Untitled");
}

export function clearSelectedLinearIssue(identifier) {
  if (state.selectedLinearIssueId !== identifier || flowForLinearIssue(identifier)) return;
  state.selectedLinearIssueId = "";
  localStorage.removeItem("flow.selectedLinearIssueId");
}

export function removeLinearIssueFromTurbopump(identifier) {
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

export function reconcileRemovedLinearTickets(previousTickets, nextTickets) {
  const nextIssueIds = new Set(nextTickets.map((ticket) => ticket.identifier));
  for (const ticket of previousTickets) {
    if (nextIssueIds.has(ticket.identifier)) continue;
    if (flowCanRenderTicket(flowForLinearIssue(ticket.identifier))) continue;
    removeLinearIssueFromTurbopump(ticket.identifier);
  }
}

export function updateLinearState(linear) {
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

export async function loadLinearTickets(options = {}) {
  if (state.linearTicketsLoading) return;
  state.linearTicketsLoading = true;
  updateRefreshLinearTicketsButton();
  try {
    els.ticketState.textContent = "Loading assigned tickets.";
    if (!options.refreshDetails) await loadCachedLinearTickets();
    const data = await api("/api/linear/issues");
    applyLinearTicketsPayload(data, options);
    if (!state.settingsCollapsed && state.checkoutsLoaded) await loadCheckouts();
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

export async function loadCachedLinearTickets() {
  try {
    const data = await api("/api/linear/issues?cached=1");
    if (data.issues?.length) applyLinearTicketsPayload(data, { loaded: false, prefetchLogs: false });
  } catch {
  }
}

export function applyLinearTicketsPayload(data, options = {}) {
  const previousTickets = state.linearTickets;
  const nextTickets = data.issues || [];
  state.linearViewer = data.viewer;
  state.linearViewerName = data.viewer?.name || state.linearViewerName;
  if (Array.isArray(data.workflowStates)) state.linearWorkflowStates = data.workflowStates;
  reconcileRemovedLinearTickets(previousTickets, nextTickets);
  state.linearTickets = nextTickets;
  state.linearTicketsLoaded = options.loaded !== false;
  state.logPrefetchFailedFlowIds.clear();
  state.logPrefetchedFlowCount = 0;
  if (options.refreshDetails) state.linearDetails.clear();
  syncLinearTicketsWithFlows();
  if (state.linearTicketsLoaded) {
    els.ticketState.textContent = data.cached ? "Showing cached tickets." : formatLastUpdated();
    els.linearState.textContent = data.cached ? "Linear unavailable; using cached tickets" : `Linear connected: ${data.viewer.name}`;
    els.linearState.classList.toggle("live", !data.cached);
  }
  renderTickets();
  renderFlowPane();
  if (options.prefetchLogs !== false) scheduleTicketLogPrefetch();
}

export function renderTickets() {
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
    updateTicketStatusGroupShellStates();
    return;
  }

  els.ticketGrid.dataset.ticketSignature = signature;

  const nodes = [renderPinnedTicketGroup(pinnedTickets)];
  for (const group of ticketGroups) {
    nodes.push(renderTicketStatusGroup(group));
  }
  els.ticketGrid.replaceChildren(...nodes);
}

export function normalizedTicketSearchQuery() {
  return state.ticketSearchQuery.trim().toLowerCase();
}

export function ticketMatchesTicketSearch(ticket, query) {
  return String(ticket.title || "").toLowerCase().includes(query);
}

export function ticketHasAgentSession(ticket) {
  return Boolean(ticket.flowId);
}

export function linearPrioritySortRank(priority) {
  const value = Number(priority);
  if (value >= 1 && value <= 4) return value;
  return 5;
}

export function compareLinearTickets(a, b) {
  return (
    Number(ticketHasAgentSession(b)) - Number(ticketHasAgentSession(a)) ||
    linearPrioritySortRank(a.priority) - linearPrioritySortRank(b.priority)
  );
}

export function sortedLinearTickets(tickets) {
  return [...tickets].sort(compareLinearTickets);
}

export function orderedPinnedTickets(tickets) {
  const ticketsByIdentifier = new Map(tickets.map((ticket) => [ticket.identifier, ticket]));
  return [...state.pinnedLinearIssues].map((identifier) => ticketsByIdentifier.get(identifier)).filter(Boolean);
}

export function groupedTicketsByLinearStatus(tickets) {
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

export function linearStatusRank(key) {
  const rank = LINEAR_STATUS_ORDER.indexOf(key);
  if (rank !== -1) return rank;
  return LINEAR_STATUS_ORDER.length - 1;
}

export function renderTicketStatusGroup(group) {
  const section = document.createElement("section");
  section.className = "ticket-status-group";
  section.classList.toggle("shell-command-active", group.tickets.some(ticketShellRunning));
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

export function renderPinnedTicketGroup(tickets) {
  const section = document.createElement("section");
  section.className = "ticket-status-group pinned-ticket-group";
  section.classList.toggle("shell-command-active", tickets.some(ticketShellRunning));
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

export function renderTicketStatusSeparator(group) {
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

export function linearStatusOptions(issue = null, fallbackStatus = null) {
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
  const ticket = issue?.identifier ? state.linearTickets.find((item) => item.identifier === issue.identifier) : null;
  const teamId = linearTeamId(issue) || linearTeamId(ticket);
  state.linearTickets.forEach(addIssueStatus);
  if (issue) addIssueStatus(issue);
  state.linearWorkflowStates
    .filter((status) => linearStatusKey(status.name) === "in-review" && (!teamId || status.team?.id === teamId))
    .forEach((status) => addStatus(status.id, status.name, status.type));
  if (fallbackStatus) addStatus(fallbackStatus.stateId, fallbackStatus.status, fallbackStatus.type);
  return [...byStateId.values()].sort((a, b) => linearStatusRank(a.key) - linearStatusRank(b.key) || a.status.localeCompare(b.status));
}

export function renderLinearStatusControl(issue, statusName) {
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

export function renderLinearPriorityControl(issue) {
  const issueId = issue.identifier || state.selectedLinearIssueId;
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  const currentPriority = linearPriorityValue(issue.priority ?? ticket?.priority);
  if (!issueId) return "";
  const options = LINEAR_PRIORITY_OPTIONS.filter((option) => option.priority !== currentPriority);
  const currentIcon = renderLinearPriorityIcon(currentPriority, { empty: true });
  const optionButtons = options
    .map((option, index) => {
      const icon = renderLinearPriorityIcon(option.priority, { empty: true });
      return `<button class="linear-priority-option" type="button" data-linear-priority-option="true" data-issue="${escapeAttribute(issueId)}" data-priority="${option.priority}" style="--linear-priority-option-index: ${index};">${icon}</button>`;
    })
    .join("");
  return `<span class="linear-priority-control">
    <button class="linear-priority-pill" type="button" data-linear-priority-pill="true" data-issue="${escapeAttribute(issueId)}" aria-haspopup="true">${currentIcon}</button>
    <span class="linear-priority-options" aria-label="Linear priority options">${optionButtons}</span>
  </span>`;
}

export function renderLinearPinButton(issue) {
  const issueId = issue.identifier || state.selectedLinearIssueId;
  if (!issueId) return "";
  const pinned = isLinearIssuePinned(issueId);
  const label = pinned ? "Unpin Linear ticket" : "Pin Linear ticket";
  return `<button class="linear-pin-toggle${pinned ? " active" : ""}" type="button" data-linear-pin-toggle="true" data-issue="${escapeAttribute(issueId)}" aria-label="${label}" aria-pressed="${pinned}">
    <svg class="linear-pin-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m12 2.75 2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.31l-5.7 3 1.09-6.35-4.62-4.5 6.38-.93L12 2.75Z" />
    </svg>
  </button>`;
}

export function updateLinearPinButtons(issueId) {
  const pinned = isLinearIssuePinned(issueId);
  const label = pinned ? "Unpin Linear ticket" : "Pin Linear ticket";
  for (const button of els.flowPane.querySelectorAll("[data-linear-pin-toggle]")) {
    if (button.dataset.issue !== issueId) continue;
    button.classList.toggle("active", pinned);
    button.setAttribute("aria-pressed", String(pinned));
    button.setAttribute("aria-label", label);
  }
}

export let floatingLinearOptions = null;

export let floatingLinearOptionsHideTimer = 0;

export let floatingLinearOptionsKey = "";

export function floatingLinearOptionsTarget(element) {
  return els.flowPane.contains(element) || Boolean(element.closest(".linear-floating-options"));
}

export function hideFloatingLinearOptions() {
  window.clearTimeout(floatingLinearOptionsHideTimer);
  floatingLinearOptionsHideTimer = 0;
  const menu = floatingLinearOptions;
  menu?.classList.remove("is-open");
  floatingLinearOptionsKey = "";
  floatingLinearOptions = null;
  window.setTimeout(() => menu?.remove(), 140);
}

export function scheduleHideFloatingLinearOptions() {
  window.clearTimeout(floatingLinearOptionsHideTimer);
  floatingLinearOptionsHideTimer = window.setTimeout(hideFloatingLinearOptions, 120);
}

export function positionFloatingLinearOptions(control, menu) {
  const trigger = control.querySelector(".linear-status-pill, .linear-priority-pill") || control;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(menu.getBoundingClientRect().width || 240, window.innerWidth - 32);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 4}px`;
}

export function showFloatingLinearOptions(control) {
  const options = control.querySelector(".linear-status-options, .linear-priority-options");
  if (!options) return;
  window.clearTimeout(floatingLinearOptionsHideTimer);
  floatingLinearOptionsHideTimer = 0;
  const key = `${options.className}:${options.innerHTML}`;
  if (floatingLinearOptions && floatingLinearOptionsKey === key) {
    floatingLinearOptions.classList.add("is-open");
    positionFloatingLinearOptions(control, floatingLinearOptions);
    return;
  }
  floatingLinearOptions?.remove();
  floatingLinearOptionsKey = key;
  floatingLinearOptions = document.createElement("div");
  floatingLinearOptions.className = `linear-floating-options ${
    options.classList.contains("linear-status-options") ? "linear-floating-status-options" : "linear-floating-priority-options"
  }`;
  floatingLinearOptions.setAttribute("aria-label", options.getAttribute("aria-label") || "Linear options");
  floatingLinearOptions.innerHTML = options.innerHTML;
  floatingLinearOptions.addEventListener("mouseenter", () => window.clearTimeout(floatingLinearOptionsHideTimer));
  floatingLinearOptions.addEventListener("mouseleave", scheduleHideFloatingLinearOptions);
  floatingLinearOptions.addEventListener("click", handleLinearDetailClick);
  document.body.append(floatingLinearOptions);
  positionFloatingLinearOptions(control, floatingLinearOptions);
  requestAnimationFrame(() => floatingLinearOptions?.classList.add("is-open"));
}

export function handleLinearOptionsOpen(event) {
  if (!(event.target instanceof Element)) return;
  const control = event.target.closest(".linear-status-control, .linear-priority-control");
  if (control && els.flowPane.contains(control)) showFloatingLinearOptions(control);
}

export function handleLinearOptionsClose(event) {
  if (!(event.target instanceof Element)) return;
  const control = event.target.closest(".linear-status-control, .linear-priority-control");
  if (!control || !els.flowPane.contains(control)) return;
  const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
  if (next && (control.contains(next) || floatingLinearOptions?.contains(next))) return;
  scheduleHideFloatingLinearOptions();
}

export function handleLinearDetailClick(event) {
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

  const editTitleButton = event.target.closest("[data-linear-title-edit]");
  if (editTitleButton && els.flowPane.contains(editTitleButton)) {
    event.preventDefault();
    event.stopPropagation();
    state.editingLinearTitleIssueId = editTitleButton.dataset.issue || "";
    renderFlowPane();
    requestAnimationFrame(() => {
      const input = els.flowPane.querySelector(".linear-title-input");
      input?.focus();
      input?.select?.();
    });
    return;
  }

  const priorityButton = event.target.closest("[data-linear-priority-option]");
  if (priorityButton && floatingLinearOptionsTarget(priorityButton)) {
    event.preventDefault();
    hideFloatingLinearOptions();
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
  if (!button || !floatingLinearOptionsTarget(button)) return;
  event.preventDefault();
  hideFloatingLinearOptions();
  const issueId = button.dataset.issue || "";
  const stateId = button.dataset.stateId || "";
  const status = button.dataset.status || button.textContent || "";
  if (!issueId || !stateId || !status) {
    renderFlowPane();
    return;
  }
  void moveTicketToLinearStatus(issueId, { stateId, status });
}

export function handleLinearTitleSubmit(event) {
  const form = event.target instanceof Element ? event.target.closest("[data-linear-title-form]") : null;
  if (!form || !els.flowPane.contains(form)) return;
  event.preventDefault();
  const input = form.querySelector("[name='title']");
  const issueId = form.dataset.issue || "";
  if (!(input instanceof HTMLInputElement) || !issueId) return;
  void updateLinearIssueTitle(issueId, input.value);
}

export function handleLinearTitleKeydown(event) {
  if (event.key !== "Escape") return;
  const input = event.target instanceof Element ? event.target.closest(".linear-title-input") : null;
  if (!input || !els.flowPane.contains(input)) return;
  event.preventDefault();
  event.stopPropagation();
  state.editingLinearTitleIssueId = "";
  renderFlowPane();
}

export function handleLinearTitleOutsidePointerDown(event) {
  if (!state.editingLinearTitleIssueId) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("[data-linear-title-form], [data-linear-title-edit]")) return;
  state.editingLinearTitleIssueId = "";
  renderFlowPane();
}

export function isLinearIssuePinned(identifier) {
  return state.pinnedLinearIssues.has(identifier);
}

export function persistPinnedLinearIssues() {
  localStorage.setItem(PINNED_LINEAR_ISSUES_KEY, JSON.stringify([...state.pinnedLinearIssues]));
}

export function setPinnedLinearIssueOrder(identifiers) {
  const knownIssueIds = new Set(state.linearTickets.map((ticket) => ticket.identifier));
  const nextPinnedIssueIds = identifiers.filter((identifier) => knownIssueIds.has(identifier));
  for (const identifier of state.pinnedLinearIssues) {
    if (knownIssueIds.has(identifier) && !nextPinnedIssueIds.includes(identifier)) nextPinnedIssueIds.push(identifier);
  }
  state.pinnedLinearIssues = new Set(nextPinnedIssueIds);
  persistPinnedLinearIssues();
}

export function moveLinearIssueToPinnedPosition(identifier, index) {
  const pinnedIssueIds = [...state.pinnedLinearIssues].filter((issueId) => issueId !== identifier);
  const insertionIndex = Math.max(0, Math.min(index, pinnedIssueIds.length));
  pinnedIssueIds.splice(insertionIndex, 0, identifier);
  setPinnedLinearIssueOrder(pinnedIssueIds);
  renderTickets();
}

export function setLinearIssuePinned(identifier, pinned, options = {}) {
  if (pinned && options.position === "top") {
    state.pinnedLinearIssues = new Set([identifier, ...[...state.pinnedLinearIssues].filter((issueId) => issueId !== identifier)]);
  } else if (pinned) state.pinnedLinearIssues.add(identifier);
  else state.pinnedLinearIssues.delete(identifier);
  persistPinnedLinearIssues();
  renderTickets();
}

export function showTicketOptionsMenu(event, ticket) {
  event.preventDefault();
  document.querySelector(".ticket-options-menu")?.remove();
  const pinned = isLinearIssuePinned(ticket.identifier);
  const menu = document.createElement("div");
  menu.className = "ticket-options-menu";
  menu.role = "menu";
  menu.innerHTML = `<button type="button" role="menuitem">${pinned ? "Unpin" : "Pin"}</button>`;
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
  const button = menu.querySelector("button");
  button.addEventListener("click", () => {
    menu.remove();
    setLinearIssuePinned(ticket.identifier, !pinned, !pinned ? { position: "top" } : {});
  });
  button.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Escape") menu.remove();
  });
  button.addEventListener("blur", () => window.setTimeout(() => menu.remove(), 0));
  button.focus();
}

export function focusLinearTicketCard(identifier) {
  requestAnimationFrame(() => {
    const card = [...els.ticketGrid.querySelectorAll(".ticket-card")].find((item) => item.dataset.issue === identifier);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
  });
}

export function upsertLinearIssue(issue) {
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

export function ticketCanMoveToStatus(issueId, group) {
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  return Boolean(ticket && group.stateId && (isLinearIssuePinned(issueId) || linearStatusId(ticket) !== group.stateId));
}

export function ticketWouldHighlightStatusGroup(issueId, group) {
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  return Boolean(ticket && group.stateId && linearStatusId(ticket) !== group.stateId);
}

export function setTicketStatusGroupDragOver(groupElement, active) {
  groupElement.classList.toggle("drag-over", active);
}

export function ticketDragScrollStep(event) {
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

export function stopTicketDragAutoScroll() {
  if (ticketDragScrollFrame) cancelAnimationFrame(ticketDragScrollFrame);
  ticketDragScrollFrame = 0;
  state.ticketDragScrollStep = 0;
}

export function runTicketDragAutoScroll() {
  ticketDragScrollFrame = 0;
  if (!state.draggingLinearIssueId || !state.ticketDragScrollStep) return;
  els.ticketGrid.scrollTop += state.ticketDragScrollStep;
  ticketDragScrollFrame = requestAnimationFrame(runTicketDragAutoScroll);
}

export function updateTicketDragAutoScroll(event) {
  state.ticketDragScrollStep = ticketDragScrollStep(event);
  if (!state.ticketDragScrollStep) {
    stopTicketDragAutoScroll();
    return;
  }
  if (!ticketDragScrollFrame) ticketDragScrollFrame = requestAnimationFrame(runTicketDragAutoScroll);
}

export function clearTicketDragState() {
  state.draggingLinearIssueId = "";
  stopTicketDragAutoScroll();
  for (const element of els.ticketGrid.querySelectorAll(".ticket-status-group.drag-over, .ticket-card.dragging, .ticket-card.drop-before, .ticket-card.drop-after")) {
    element.classList.remove("drag-over", "dragging", "drop-before", "drop-after");
  }
}

export function handleTicketStatusDragEnter(event, group) {
  if (!ticketCanMoveToStatus(state.draggingLinearIssueId, group)) {
    setTicketStatusGroupDragOver(event.currentTarget, false);
    return;
  }
  event.preventDefault();
  setTicketStatusGroupDragOver(event.currentTarget, ticketWouldHighlightStatusGroup(state.draggingLinearIssueId, group));
}

export function handleTicketStatusDragOver(event, group) {
  updateTicketDragAutoScroll(event);
  if (!ticketCanMoveToStatus(state.draggingLinearIssueId, group)) {
    setTicketStatusGroupDragOver(event.currentTarget, false);
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  setTicketStatusGroupDragOver(event.currentTarget, ticketWouldHighlightStatusGroup(state.draggingLinearIssueId, group));
}

export function handleTicketStatusDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  setTicketStatusGroupDragOver(event.currentTarget, false);
}

export function handleTicketStatusDrop(event, group) {
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

export function ticketCanMoveToPinned(issueId) {
  return Boolean(state.linearTickets.some((ticket) => ticket.identifier === issueId));
}

export function ticketWouldHighlightPinnedGroup(issueId) {
  return ticketCanMoveToPinned(issueId) && !isLinearIssuePinned(issueId);
}

export function clearPinnedTicketDropTarget(section) {
  for (const card of section.querySelectorAll(".ticket-card.drop-before, .ticket-card.drop-after")) {
    card.classList.remove("drop-before", "drop-after");
  }
}

export function pinnedTicketDropIndex(event) {
  const cards = [...event.currentTarget.querySelectorAll(".ticket-card.pinned:not(.dragging)")];
  for (const [index, card] of cards.entries()) {
    const rect = card.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) return index;
  }
  return cards.length;
}

export function updatePinnedTicketDropTarget(event) {
  const section = event.currentTarget;
  clearPinnedTicketDropTarget(section);
  const cards = [...section.querySelectorAll(".ticket-card.pinned:not(.dragging)")];
  if (!cards.length) return;
  const index = pinnedTicketDropIndex(event);
  const target = cards[Math.min(index, cards.length - 1)];
  target.classList.add(index >= cards.length ? "drop-after" : "drop-before");
}

export function handlePinnedTicketDragEnter(event) {
  if (!ticketCanMoveToPinned(state.draggingLinearIssueId)) return;
  event.preventDefault();
  setTicketStatusGroupDragOver(event.currentTarget, ticketWouldHighlightPinnedGroup(state.draggingLinearIssueId));
}

export function handlePinnedTicketDragOver(event) {
  updateTicketDragAutoScroll(event);
  if (!ticketCanMoveToPinned(state.draggingLinearIssueId)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  setTicketStatusGroupDragOver(event.currentTarget, ticketWouldHighlightPinnedGroup(state.draggingLinearIssueId));
  updatePinnedTicketDropTarget(event);
}

export function handleTicketGridDragOver(event) {
  if (!state.draggingLinearIssueId) return;
  updateTicketDragAutoScroll(event);
}

export function handlePinnedTicketDrop(event) {
  const issueId = state.draggingLinearIssueId || event.dataTransfer.getData("text/plain");
  if (!ticketCanMoveToPinned(issueId)) return;
  const index = pinnedTicketDropIndex(event);
  event.preventDefault();
  clearTicketDragState();
  moveLinearIssueToPinnedPosition(issueId, index);
}

export function replaceLinearIssue(issue) {
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

export async function updateLinearIssueTitle(issueId, title) {
  const ticket = state.linearTickets.find((item) => item.identifier === issueId);
  const detailIssue = state.linearDetails.get(issueId)?.issue;
  const flow = flowForLinearIssue(issueId);
  const issue = ticket || detailIssue || (flow ? { id: "", identifier: issueId, title: flow.title, url: flow.linearIssueUrl } : null);
  const nextTitle = title.trim();
  if (!issue || !nextTitle || nextTitle === issue.title) {
    state.editingLinearTitleIssueId = "";
    renderFlowPane();
    return;
  }

  const previousTickets = state.linearTickets;
  const previousDetail = state.linearDetails.get(issueId);
  const previousFlows = state.flows;
  if (ticket || detailIssue) replaceLinearIssue({ ...issue, title: nextTitle });
  if (flow) upsertFlow({ ...flow, title: nextTitle });
  state.editingLinearTitleIssueId = "";
  renderTickets();
  renderFlowPane();
  els.ticketState.textContent = `Renaming ${issueId}.`;

  try {
    const data = await api(`/api/linear/issues/${encodeURIComponent(issueId)}/title`, {
      method: "POST",
      body: JSON.stringify({ issueId: issue.id, title: nextTitle }),
    });
    if (data.issue) replaceLinearIssue(data.issue);
    if (data.flow) upsertFlow(data.flow);
    syncLinearTicketsWithFlows();
    renderTickets();
    renderFlowPane();
    els.ticketState.textContent = formatLastUpdated();
  } catch (error) {
    state.linearTickets = previousTickets;
    state.flows = previousFlows;
    if (previousDetail) state.linearDetails.set(issueId, previousDetail);
    else state.linearDetails.delete(issueId);
    renderTickets();
    renderFlowPane();
    els.ticketState.textContent = error.message;
  }
}

export async function moveTicketToLinearStatus(issueId, group) {
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

export async function moveTicketToLinearPriority(issueId, priority) {
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

export async function createPinnedLinearTicket() {
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
    await createFlowFromTicket(issue);
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

export function ticketAgentWorking(ticket) {
  const flow = flowForTicket(ticket);
  return Boolean(
    repoUrlConfigured() &&
      flow &&
      (flowAgentRunning(flow) || state.messageSubmittingFlowId === flow.id),
  );
}

export function ticketFlowCreating(ticket) {
  return Boolean(ticket?.identifier && state.creatingFlowIssueIds.has(ticket.identifier));
}

export function ticketShellRunning(ticket) {
  return flowShellLive(flowForTicket(ticket));
}

export function updateTicketCardState(card) {
  const ticket = state.linearTickets.find((item) => item.identifier === card.dataset.issue);
  const active = card.dataset.issue === state.selectedLinearIssueId;
  card.classList.toggle("active", active);
  card.classList.toggle("agent-turn-active", ticketAgentWorking(ticket));
  card.classList.toggle("creating-flow", ticketFlowCreating(ticket));
  card.classList.toggle("shell-command-active", ticketShellRunning(ticket));
  card.classList.toggle("agent-turn-notified", !active && state.notifiedLinearIssueIds.has(card.dataset.issue));
  card.classList.toggle("pinned", isLinearIssuePinned(card.dataset.issue));
}

export function updateTicketCardsForIdentifiers(...identifiers) {
  const issueIds = new Set(identifiers.filter(Boolean));
  if (!issueIds.size) return;
  for (const card of els.ticketGrid.querySelectorAll(".ticket-card")) {
    if (issueIds.has(card.dataset.issue)) updateTicketCardState(card);
  }
  updateTicketStatusGroupShellStates();
}

export function updateTicketStatusGroupShellStates() {
  for (const section of els.ticketGrid.querySelectorAll(".ticket-status-group")) {
    const statusKey = section.dataset.status;
    const tickets = section.classList.contains("pinned-ticket-group")
      ? state.linearTickets.filter((ticket) => isLinearIssuePinned(ticket.identifier))
      : state.linearTickets.filter(
          (ticket) => !isLinearIssuePinned(ticket.identifier) && linearStatusKey(linearStatusName(ticket)) === statusKey,
        );
    section.classList.toggle("shell-command-active", tickets.some(ticketShellRunning));
  }
}

export function ticketInCollapsedStatusGroup(identifier) {
  const ticket = state.linearTickets.find((item) => item.identifier === identifier);
  return Boolean(ticket && !isLinearIssuePinned(identifier) && state.collapsedLinearStatuses.has(linearStatusKey(linearStatusName(ticket))));
}

export function updateTicketSelectionCards(previousIssueId, nextIssueId) {
  if (ticketInCollapsedStatusGroup(previousIssueId) || ticketInCollapsedStatusGroup(nextIssueId)) {
    renderTickets();
    return;
  }
  updateTicketCardsForIdentifiers(previousIssueId, nextIssueId);
}

export function animateTicketSwitch() {
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

export function renderTicketCard(ticket) {
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
  card.addEventListener("contextmenu", (event) => showTicketOptionsMenu(event, ticket));
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openTicketInFlowPane(ticket);
  });
  return card;
}

export function renderTicketStartAgentButton(ticket) {
  return `<button class="ticket-flow-corner ticket-flow-start" type="button" data-ticket-start-agent="true" data-issue="${escapeAttribute(ticket.identifier)}" aria-label="Start agent session">
    <svg class="ticket-flow-start-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="${TICKET_START_AGENT_FLAME_PATH}">
        <animate class="ticket-flow-start-shape" attributeName="d" values="${TICKET_START_AGENT_FLAME_ANIMATION_VALUES}" dur="1.8s" repeatCount="indefinite" begin="indefinite" />
      </path>
    </svg>
  </button>`;
}

export function renderTicketCreatingFlowIndicator(ticket) {
  return `<div class="ticket-flow-corner ticket-flow-creating" role="status" aria-label="Creating flow for ${escapeAttribute(ticket.identifier)}">
    <span class="flow-create-spinner" aria-hidden="true"></span>
  </div>`;
}

export function updateTicketStartAgentAnimation(button) {
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

export function linearCommentParentId(comment) {
  return comment.parent?.id || comment.parentId || "";
}

export function linearCommentTree(comments) {
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

export function renderLinearComment(comment, nested = false) {
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

export function renderLinearDetail(context, options = {}) {
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
  const title = issue.title || context.title;
  const issueId = issue.identifier || context.issueId;
  const editingTitle = state.editingLinearTitleIssueId === issueId;
  const titleHtml = editingTitle
    ? `<form class="linear-title-form" data-linear-title-form="true" data-issue="${escapeAttribute(issueId)}">
        <input class="linear-title-input" name="title" value="${escapeAttribute(title)}" autocomplete="off" required>
        <button class="linear-title-edit linear-title-save" type="submit" aria-label="Save Linear title">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </button>
      </form>`
    : `<div class="linear-title-row">
        <h3>${escapeHtml(title)}</h3>
        <button class="linear-title-edit" type="button" data-linear-title-edit="true" data-issue="${escapeAttribute(issueId)}" aria-label="Edit Linear title">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20h4L18.5 9.5l-4-4L4 16v4Z" />
            <path d="m13.5 6.5 4 4" />
          </svg>
        </button>
      </div>`;
  const issueDescription = issue.description || "";
  const descriptionHtml = issueDescription.trim()
    ? `<div class="linear-description linear-markdown">${options.light ? escapeHtml(issueDescription) : renderLinearMarkdown(issueDescription, "")}</div>`
    : "";

  const html = `
    <section class="linear-issue">
      <div class="linear-issue-header">
        <div>
          <div class="linear-issue-kicker">
            <a href="${escapeAttribute(issue.url || context.issueUrl)}" target="_blank" rel="noreferrer">
              ${escapeHtml(issue.identifier || context.issueId)}
            </a>
            ${pinButton}
          </div>
          ${titleHtml}
        </div>
      </div>
      <div class="linear-meta">
        ${githubCiPill}
        ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        ${statusControl}
        ${priorityControl}
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
  if (container._linearDetailHtml === html) {
    updateMarkdownCodeCopyPositions(container);
    return;
  }
  container._linearDetailHtml = html;
  container.innerHTML = html;
  updateMarkdownCodeCopyPositions(container);
}

export async function loadLinearDetail(identifier) {
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

export function shouldHideFloatingLinearOptionsForScroll(event) {
  const target = event.target instanceof Element ? event.target : null;
  return target === els.flowPane || Boolean(target?.closest(".linear-panel, .linear-detail"));
}
