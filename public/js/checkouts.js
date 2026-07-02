import { setFlows } from "./flows.js";
import { api } from "./net.js";
import { render } from "./render.js";
import { els, state } from "./state.js";
import { renderLinearStatusIcon } from "./tickets.js";

export let checkoutLoadFrame = 0;

export function setCheckouts(checkouts) {
  state.checkouts = [...(checkouts || [])].sort(compareCheckouts);
}

export function compareCheckouts(a, b) {
  const aTime = Date.parse(a.lastPromptAt || a.createdAt || 0);
  const bTime = Date.parse(b.lastPromptAt || b.createdAt || 0);
  return bTime - aTime || String(a.name || "").localeCompare(String(b.name || ""));
}

export function formatCheckoutTimestamp(value) {
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

export async function loadCheckouts() {
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

export async function ensureCheckoutsLoaded() {
  if (state.settingsCollapsed || state.checkoutsLoaded || state.checkoutsLoading) return;
  await loadCheckouts();
}

export function scheduleCheckoutsLoaded() {
  if (checkoutLoadFrame) return;
  checkoutLoadFrame = requestAnimationFrame(() => {
    checkoutLoadFrame = requestAnimationFrame(() => {
      checkoutLoadFrame = 0;
      void ensureCheckoutsLoaded();
    });
  });
}

export async function deleteCheckout(name) {
  if (!name) return;
  const data = await api(`/api/checkouts/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (data.flows) setFlows(data.flows);
  if (data.checkouts) setCheckouts(data.checkouts);
  else state.checkouts = state.checkouts.filter((checkout) => checkout.name !== name);
  render();
}

export function renderCheckoutCard(checkout) {
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

export function renderCheckouts() {
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
