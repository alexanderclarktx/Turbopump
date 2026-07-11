import { MAX_INPUT_HISTORY_ITEMS, PROMPT_HISTORY_KEY, SHELL_HISTORY_KEY } from "./constants.js";
import { applyFlowSplitSize } from "./layout.js";
import { resizeMessageInput } from "./prompt.js";
import { hideSlashMenu, renderSlashMenu } from "./slash-commands.js";
import { els, state } from "./state.js";
import { normalizeTerminalLog } from "./terminal-groups.js";
import { followTerminalToLatestDuringLayout, terminalAtLatest } from "./terminal-render.js";
import { escapeHtml } from "./ui.js";

export function inputHistoryMode(input = document.activeElement) {
  return input?.classList?.contains("shell-input") ? "shell" : "prompt";
}

export function inputHistoryKey(mode = inputHistoryMode()) {
  return mode === "shell" ? SHELL_HISTORY_KEY : PROMPT_HISTORY_KEY;
}

export function inputHistory(mode = inputHistoryMode()) {
  return mode === "shell" ? state.shellHistory : state.promptHistory;
}

export function inputHistoryOrder(mode = inputHistoryMode()) {
  return mode === "shell" ? state.shellHistoryOrder : state.promptHistoryOrder;
}

export function saveInputHistory(mode = inputHistoryMode()) {
  localStorage.setItem(inputHistoryKey(mode), JSON.stringify(inputHistory(mode)));
}

export function inputHistoryLogOrder(log) {
  const timestamp = Date.parse(log.createdAt || "");
  const id = Number(log.id || 0);
  if (Number.isFinite(timestamp)) return timestamp + id / 1_000_000;
  return Number.isFinite(id) && id > 0 ? id : Date.now();
}

export function sortInputHistory(mode = inputHistoryMode()) {
  const history = inputHistory(mode);
  const order = inputHistoryOrder(mode);
  history.sort((a, b) => (order.get(b) ?? 0) - (order.get(a) ?? 0));
  history.splice(MAX_INPUT_HISTORY_ITEMS);
  saveInputHistory(mode);
}

export function shouldRememberInputHistoryItem(item, mode) {
  return !(mode === "prompt" && item.startsWith("/"));
}

export function rememberInputHistory(value, mode = inputHistoryMode(), orderValue = Date.now()) {
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

export function rememberLogHistory(log) {
  const normalized = normalizeTerminalLog(log);
  const order = inputHistoryLogOrder(log);
  if (normalized.source === "user") rememberInputHistory(normalized.message, "prompt", order);
  if (normalized.source === "shell:command") rememberInputHistory(normalized.message, "shell", order);
}

export function matchingInputHistory(query, mode = inputHistoryMode()) {
  const needle = query.toLowerCase();
  return inputHistory(mode).filter((item) => item.toLowerCase().includes(needle));
}

export function cloneHistorySearch(search) {
  if (!search) return null;
  return {
    ...search,
    matches: [...(search.matches || [])],
  };
}

export function cloneHistoryNavigation(navigation) {
  return navigation ? { ...navigation } : null;
}

export function applyHistorySearchResult(input) {
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

export function resetInputHistoryNavigation() {
  state.historyNavigation = null;
}

export function updateInputHistoryNavigation(input, direction) {
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

export function inputCaretOnFirstLine(input) {
  const start = input.selectionStart ?? 0;
  return !input.value.slice(0, start).includes("\n");
}

export function inputCaretOnLastLine(input) {
  const end = input.selectionEnd ?? input.value.length;
  return !input.value.slice(end).includes("\n");
}

export function handleInputHistoryNavigationKeydown(event) {
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

export function renderHistorySearchIndicator() {
  const indicator = els.flowPane.querySelector(".history-search-indicator");
  if (!indicator) return;
  const form = els.flowPane.querySelector(".terminal-panel > .message-form");
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

export function updateHistorySearchMatches(input, query) {
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

export function cancelHistorySearch() {
  state.historySearch = null;
  renderHistorySearchIndicator();
}

export function startOrAdvanceHistorySearch(input) {
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

export function moveHistorySearchForward(input) {
  const search = state.historySearch;
  if (!search || !search.matches.length) return false;
  search.index = Math.max(search.index - 1, 0);
  return applyHistorySearchResult(input);
}

export function handleHistorySearchKeydown(event) {
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
