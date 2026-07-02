import { DEFAULT_FAVICON_HREF, NOTIFIED_LINEAR_ISSUES_KEY } from "./constants.js";
import { loadFlowDiff } from "./diff.js";
import { linearIssueIdForFlowId } from "./flows.js";
import { state } from "./state.js";
import { renderTickets } from "./tickets.js";

export let faviconSourceSvg = "";

export function faviconLink() {
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.append(link);
  }
  return link;
}

export function notifiedFaviconSvg(source) {
  const dot = `
  <g aria-hidden="true">
    <circle cx="50" cy="54" r="9" fill="#ffff00" />
  </g>`;
  return source.includes("</svg>") ? source.replace("</svg>", `${dot}\n</svg>`) : source;
}

export async function notificationFaviconHref() {
  if (state.notificationFaviconHref) return state.notificationFaviconHref;
  if (!faviconSourceSvg) faviconSourceSvg = await fetch(DEFAULT_FAVICON_HREF).then((response) => response.text());
  state.notificationFaviconHref = `data:image/svg+xml,${encodeURIComponent(notifiedFaviconSvg(faviconSourceSvg))}`;
  return state.notificationFaviconHref;
}

export async function updateBrowserTabNotification() {
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

export function persistLinearIssueNotifications() {
  localStorage.setItem(NOTIFIED_LINEAR_ISSUES_KEY, JSON.stringify([...state.notifiedLinearIssueIds]));
}

export function clearLinearIssueNotification(identifier, options = {}) {
  if (!identifier || !state.notifiedLinearIssueIds.delete(identifier)) return false;
  persistLinearIssueNotifications();
  void updateBrowserTabNotification();
  if (options.render !== false) renderTickets();
  return true;
}

export function canAcknowledgeSelectedNotification() {
  return document.visibilityState === "visible" && (typeof document.hasFocus !== "function" || document.hasFocus());
}

export function acknowledgeSelectedLinearIssueNotification() {
  if (!canAcknowledgeSelectedNotification()) return;
  clearLinearIssueNotification(state.selectedLinearIssueId);
}

export function notifyAgentTurnEnded(flowId) {
  const issueId = linearIssueIdForFlowId(flowId);
  if (!issueId || (issueId === state.selectedLinearIssueId && canAcknowledgeSelectedNotification())) return;
  state.notifiedLinearIssueIds.add(issueId);
  persistLinearIssueNotifications();
  void updateBrowserTabNotification();
  renderTickets();
}

export function refreshFlowDiffAfterAgentTurn(flowId) {
  if (!flowId) return;
  const modalOpen = state.diffModalFlowId === flowId;
  void loadFlowDiff(flowId, { force: true, modal: modalOpen, patch: modalOpen });
}
