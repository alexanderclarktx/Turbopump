import { MODAL_HIDE_DELAY_MS } from "./constants.js";
import { renderAgentContext, selectedFlow } from "./flows.js";
import { api } from "./net.js";
import { els, state } from "./state.js";
import { showModalElement } from "./ui.js";

export let diffModalTransitionTimer = 0;

export let diffModalScrollFrame = 0;

export function normalizeDiff(data) {
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

export function diffText(diff) {
  return [diff?.status, diff?.stat, diff?.names, diff?.patch].filter(Boolean).join("\n").trim();
}

export function diffHasChanges(diff) {
  return Boolean(diffText(diff));
}

export function diffFileCount(diff) {
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

export function ensureDiffIndicatorCount(button, kind, className, prefix) {
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

export function updateDiffIndicatorCount(button, kind, className, prefix, value) {
  const count = ensureDiffIndicatorCount(button, kind, className, prefix);
  const digits = count.querySelector(".diff-count-digits");
  const numericValue = Number(value || 0);
  const nextValue = Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
  const nextText = String(nextValue);
  count.dataset.value = nextText;
  count.setAttribute("aria-label", `${prefix}${nextText}`);
  digits.textContent = nextText;
}

export function renderDiffIndicator(button, flowId, diff) {
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

export function diffCountLabel(value, prefix) {
  if (value === null || value === undefined || value === "") return "";
  const count = Number(value);
  return Number.isFinite(count) ? `${prefix}${count}` : "";
}

export function diffLoadingKey(flowId, options = {}) {
  return `${flowId}:${options.patch ? "patch" : "summary"}`;
}

export function rememberPendingFlowDiffRefresh(flowId, options = {}) {
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

export async function loadFlowDiff(flowId, options = {}) {
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

export function openDiffViewer(flowId) {
  state.diffModalFlowId = flowId || "";
  state.diffModalDiff = flowId && state.flowDiffs.get(flowId) ? { ...state.flowDiffs.get(flowId) } : null;
  state.diffModalLoadingFlowId = flowId || "";
  state.diffModalSelectedPath = "";
  renderDiffModal();
  if (flowId) void loadFlowDiff(flowId, { patch: true, modal: true, force: true });
}

export function closeDiffViewer() {
  state.diffModalFlowId = "";
  state.diffModalDiff = null;
  state.diffModalLoadingFlowId = "";
  state.diffModalSelectedPath = "";
  renderDiffModal();
}

export function showDiffModal() {
  clearTimeout(diffModalTransitionTimer);
  showModalElement(els.diffModal);
}

export function hideDiffModal() {
  clearTimeout(diffModalTransitionTimer);
  els.diffModal.classList.remove("is-open");
  els.diffModal.classList.add("is-closing");
  diffModalTransitionTimer = setTimeout(() => {
    if (state.diffModalFlowId) return;
    els.diffModal.hidden = true;
    els.diffModal.classList.remove("is-closing");
  }, MODAL_HIDE_DELAY_MS);
}

export function diffLineClass(line) {
  if (/^(diff --git|index |new file mode|deleted file mode|similarity index|rename from|rename to)/.test(line)) return "diff-line-meta";
  if (/^(@@|\+\+\+|---)/.test(line)) return "diff-line-coord";
  if (line.startsWith("+")) return "diff-line-inserted";
  if (line.startsWith("-")) return "diff-line-deleted";
  return "";
}

export function shouldHideDiffLine(line) {
  return /^(diff --git|index |\+\+\+ |--- |new file mode|deleted file mode|similarity index|rename from|rename to)/.test(line);
}

export function diffFilePathFromHeader(line) {
  const pathStart = line.lastIndexOf(" b/");
  return pathStart >= 0 ? line.slice(pathStart + 3).trim() : "";
}

export function diffPatchFilePaths(text) {
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

export function orderedDiffFiles(diff) {
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

export function diffHunkLineState(line) {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return { oldLine: Number(match[1]), newLine: Number(match[2]) };
}

export function appendDiffLine(fragment, line, lineState) {
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

export function renderDiffCode(code, text, selectedPath = "") {
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

export function setSelectedDiffFile(path, options = {}) {
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

export function scrollDiffFileIntoView(path) {
  const scroller = els.diffModal?.querySelector(".diff-modal-code");
  if (!scroller) return;
  const target = [...scroller.querySelectorAll(".diff-file-anchor")].find((anchor) => anchor.dataset.diffPath === path);
  if (!target) return;
  const paddingTop = Number.parseFloat(getComputedStyle(scroller).paddingTop) || 0;
  scroller.scrollTop = Math.max(0, target.offsetTop - paddingTop - 8);
}

export function selectedDiffFileFromScroll() {
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

export function syncSelectedDiffFileFromScroll() {
  diffModalScrollFrame = 0;
  const path = selectedDiffFileFromScroll();
  if (path && path !== state.diffModalSelectedPath) setSelectedDiffFile(path, { revealSummary: true });
}

export function scheduleSelectedDiffFileSync() {
  if (diffModalScrollFrame) return;
  diffModalScrollFrame = requestAnimationFrame(syncSelectedDiffFileFromScroll);
}

export function renderDiffSummary(summary, diff, loading, selectedPath = "") {
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

export function renderDiffModal() {
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
