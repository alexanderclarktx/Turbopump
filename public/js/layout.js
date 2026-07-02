import {
  FLOW_SPLIT_SIZE_KEY,
  LINEAR_PANE_HIDDEN_KEY,
  SHELL_OUTPUT_SPLIT_SIZE_KEY,
  SHELL_PANE_HIDDEN_KEY,
  THEME_KEY,
  TICKET_DRAWER_MAX_SIZE,
  TICKET_DRAWER_MIN_SIZE,
  TICKET_DRAWER_SIZE_KEY,
} from "./constants.js";
import { focusInputPane, focusedInputPaneKind } from "./prompt.js";
import { clampFlowSplitSize, clampShellOutputSplitSize, clampTicketDrawerSize, els, state } from "./state.js";
import { renderShellOutputPane, terminalBottomRestorer } from "./terminal-render.js";

export function setTicketDrawerHidden(hidden) {
  state.ticketDrawerHidden = hidden;
  document.body.classList.toggle("tickets-collapsed", hidden);
  els.ticketDrawer.setAttribute("aria-label", hidden ? "Expand tickets" : "Tickets");
  if (hidden) els.ticketDrawer.setAttribute("tabindex", "0");
  else els.ticketDrawer.removeAttribute("tabindex");
  applyTicketDrawerSize();
  applyFlowSplitSize();
}

export function toggleTicketDrawerHidden() {
  setTicketDrawerHidden(!state.ticketDrawerHidden);
}

export function applyTicketDrawerSize() {
  const applied = state.ticketDrawerHidden ? 12 : clampTicketDrawerSize(state.ticketDrawerSize);
  els.main.style.setProperty("--ticket-drawer-size", `${applied}px`);
  els.ticketDrawerResizer.setAttribute("aria-valuenow", String(Math.round(clampTicketDrawerSize(state.ticketDrawerSize))));
  return applied;
}

export function setTicketDrawerSize(value) {
  state.ticketDrawerSize = clampTicketDrawerSize(value);
  applyTicketDrawerSize();
  localStorage.setItem(TICKET_DRAWER_SIZE_KEY, String(state.ticketDrawerSize));
}

export function setLinearPaneHidden(hidden) {
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

export function toggleLinearPaneHidden() {
  setLinearPaneHidden(!state.linearPaneHidden);
}

export function setShellPaneHidden(hidden) {
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

export function toggleShellPaneHidden() {
  setShellPaneHidden(!state.shellPaneHidden);
}

export function revealShellPaneForInputFocus() {
  setShellPaneHidden(false);
  focusInputPane("shell");
}

export function applyTheme(theme) {
  state.theme = theme;
  const dark = theme === "dark";
  document.body.classList.toggle("theme-dark", dark);
  document.body.classList.toggle("theme-light", !dark);
  els.themeToggle.setAttribute("aria-pressed", String(dark));
  els.themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

export function setTheme(theme) {
  applyTheme(theme);
  localStorage.setItem(THEME_KEY, theme);
}

export function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

export function flowSplitBounds(content, rect) {
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

export function appliedFlowSplitSize() {
  const content = els.flowPane.querySelector(".flow-content");
  const rect = content.getBoundingClientRect();
  if (!rect.height) return state.flowSplitSize;
  const bounds = flowSplitBounds(content, rect);
  return Math.min(bounds.max, Math.max(bounds.min, state.flowSplitSize));
}

export function applyFlowSplitSize() {
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

export function setFlowSplitSize(value) {
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

export function shellOutputSplitBounds(panel, rect) {
  const resizer = panel.querySelector(".shell-output-resizer");
  const resizerWidth = resizer?.getBoundingClientRect().width || 0;
  const minShellPx = Math.min(180, Math.max(80, rect.width - resizerWidth - 180));
  const maxShellPx = Math.max(minShellPx, rect.width - resizerWidth - 260);
  return {
    min: (Math.min(rect.width, Math.max(0, minShellPx)) / rect.width) * 100,
    max: (Math.min(rect.width, Math.max(0, maxShellPx)) / rect.width) * 100,
  };
}

export function constrainedShellOutputSplitSize(value, bounds) {
  return Math.min(bounds.max, Math.max(bounds.min, clampShellOutputSplitSize(value)));
}

export function writeShellOutputSplitSize(panel, resizer, applied, bounds) {
  if (bounds) {
    resizer.setAttribute("aria-valuemin", String(Math.round(bounds.min)));
    resizer.setAttribute("aria-valuemax", String(Math.round(bounds.max)));
  }
  resizer.setAttribute("aria-valuenow", String(Math.round(applied)));
  panel.style.setProperty("--shell-pane-size", `${applied}%`);
  return applied;
}

export function appliedShellOutputSplitSize() {
  const panel = els.flowPane.querySelector(".terminal-panel");
  const rect = panel.getBoundingClientRect();
  if (!rect.width) return state.shellOutputSplitSize;
  const bounds = shellOutputSplitBounds(panel, rect);
  return constrainedShellOutputSplitSize(state.shellOutputSplitSize, bounds);
}

export function applyShellOutputSplitSize() {
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

export function setShellOutputSplitSize(value) {
  state.shellOutputSplitSize = clampShellOutputSplitSize(value);
  const applied = applyShellOutputSplitSize();
  state.shellOutputSplitSize = applied;
  localStorage.setItem(SHELL_OUTPUT_SPLIT_SIZE_KEY, String(state.shellOutputSplitSize));
}

export function resizeFlowSplitFromPointer(clientY) {
  const content = els.flowPane.querySelector(".flow-content");
  const rect = content.getBoundingClientRect();
  if (!rect.height) return;
  setFlowSplitSize(((clientY - rect.top) / rect.height) * 100);
}

export function startFlowSplitResize(event) {
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

export function resizeTicketDrawerFromPointer(clientX) {
  if (state.ticketDrawerHidden) return;
  const rect = els.ticketDrawer.getBoundingClientRect();
  if (!rect.width) return;
  setTicketDrawerSize(clientX - rect.left);
}

export function startTicketDrawerResize(event) {
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

export function handleTicketDrawerResizeKeydown(event) {
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

export function resizeShellOutputSplitFromPointer(clientX) {
  const context = shellOutputSplitResizeContext();
  if (!context) return;
  resizeShellOutputSplitFromPointerWithContext(clientX, context);
}

export function setShellOutputSplitSizeKeepingTerminalBottom(value) {
  const restoreTerminalBottom = terminalBottomRestorer();
  setShellOutputSplitSize(value);
  restoreTerminalBottom();
}

export function shellOutputSplitResizeContext() {
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

export function shellOutputSplitSizeFromPointer(clientX, context) {
  return ((context.rect.right - clientX) / context.rect.width) * 100;
}

export function resizeShellOutputSplitFromPointerWithContext(clientX, context) {
  state.shellOutputSplitSize = constrainedShellOutputSplitSize(shellOutputSplitSizeFromPointer(clientX, context), context.bounds);
  writeShellOutputSplitSize(context.panel, context.resizer, state.shellOutputSplitSize, context.bounds);
}

export function startShellOutputSplitResize(event) {
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
