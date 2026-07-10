import { renderInlineMarkdown, renderLinearMarkdown } from "../linear-markdown.js";
import { renderAnsiText } from "./ansi.js";
import {
  AGENT_TRACE_INITIAL_TURN_COUNT,
  MARKDOWN_CODE_COPY_OFFSET,
  MARKDOWN_CODE_COPY_SIZE,
  MARKDOWN_TABLE_MIN_COLUMN_WIDTH,
  TERMINAL_TRACE_CLOSE_DURATION_MS,
  TERMINAL_TRACE_INITIAL_RENDER_COUNT,
  TERMINAL_TRACE_OPEN_DURATION_MS,
  TERMINAL_TRACE_RENDER_BATCH_SIZE,
} from "./constants.js";
import { agentWorkingForFlow, flowShellLive, syncAgentWorkingPushState, upsertFlow } from "./flows.js";
import { applyFlowSplitSize, applyShellOutputSplitSize } from "./layout.js";
import { deleteOutputLogGroup } from "./logs.js";
import { api } from "./net.js";
import { renderAgentImageChip } from "./prompt.js";
import { splitAgentPaneFlowId, splitShellOutputPane, splitShellPaneFlowId, splitTerminal } from "./split.js";
import { els, state } from "./state.js";
import { isSubmittedUserLogSource, logMeta, shellOutputGroups, terminalGroups } from "./terminal-groups.js";
import { copyTextToClipboard, escapeAttribute, escapeHtml, toast } from "./ui.js";

export function shellOutputPane() {
  return els.flowPane.querySelector(".shell-output-pane");
}

export function terminalForFlowLogs(flowId) {
  if (flowId && flowId === state.selectedFlowId) return els.flowPane.querySelector(".terminal");
  if (flowId && flowId === splitAgentPaneFlowId()) return splitTerminal();
  return null;
}

export function renderSplitShellOutputPane(flowId) {
  const pane = splitShellOutputPane();
  if (!pane || pane.hidden) return;
  const flow = state.flows.find((item) => item.id === flowId) || null;
  const groups = shellOutputGroups(state.logs.get(flowId) || [], flow);
  const shellLive = flowShellLive(flow);
  if (!groups.length && !shellLive) {
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

export function renderShellOutputPane(flowId) {
  if (flowId && flowId === splitShellPaneFlowId() && flowId !== state.selectedFlowId) {
    renderSplitShellOutputPane(flowId);
    return;
  }
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

export function scheduleShellOutputRender(flowId) {
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

export async function clearShellOutputPane() {
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

export function formatTerminalMessage(source, message, options = {}) {
  const text = String(message || "");
  if (source === "agent:tool") return text.trim();
  if (source === "agent:tool-result") return text.trim();
  if (source === "agent:status" || source === "flow" || source === "linear") return text.trim();
  const withoutLeadingNewlines = text.replace(/^\n+/, "");
  return options.preserveTrailingNewlines ? withoutLeadingNewlines : withoutLeadingNewlines.replace(/\n+$/, "");
}

export function localDayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function terminalDateLabel(date, now = new Date()) {
  const days = Math.floor((localDayStart(now) - localDayStart(date)) / 86_400_000);
  if (days <= 0) return "";
  return `${days}d ago`;
}

export function formatTerminalTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  }).replace(/\s+([AP]M)$/i, "$1").toLowerCase();
  const dateLabel = terminalDateLabel(date);
  return dateLabel ? `${time} (${dateLabel})` : time;
}

export function formatTerminalElapsed(startValue, endValue) {
  const start = Date.parse(startValue || "");
  const end = Date.parse(endValue || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  let remaining = Math.round((end - start) / 1000);
  const hours = Math.floor(remaining / 3600);
  remaining -= hours * 3600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining - minutes * 60;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function usesTerminalBlockMarkdown(source) {
  return ["user", "user:queued", "agent", "agent:message", "agent:thinking", "agent:reasoning"].includes(source);
}

export function usesTerminalMarkdownToggle(source) {
  return ["agent", "agent:message"].includes(source);
}

export function splitTerminalAttachedImages(message) {
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

export function renderTerminalAttachedImages(images) {
  if (!images.length) return "";
  return `<div class="terminal-attached-images">${images.map((image) => renderAgentImageChip(image)).join("")}</div>`;
}

export function renderTerminalMarkdownContent(message, options = {}) {
  const parsed = splitTerminalAttachedImages(message);
  return `${renderLinearMarkdown(parsed.message, "", {
    images: false,
    links: true,
    compactBlankLines: true,
    copyCode: options.copyCode !== false,
  })}${renderTerminalAttachedImages(parsed.images)}`;
}

export function renderTerminalMarkdownOutput(message, options = {}) {
  return `<div class="terminal-markdown-content" data-raw-markdown="${escapeAttribute(message)}">${renderTerminalMarkdownContent(message, options)}</div>`;
}

export function renderTerminalStreamingTextOutput(message) {
  return `<div class="terminal-streaming-markdown">${renderLinearMarkdown(message, "", {
    images: false,
    links: true,
    compactBlankLines: true,
    copyCode: false,
  })}</div>`;
}

export function toggleTerminalMarkdownOutput(button) {
  const entry = button.closest(".terminal-entry");
  const body = entry?.querySelector(".terminal-entry-body");
  const content = body?.querySelector(".terminal-markdown-content");
  if (!content) return;

  const raw = content.dataset.rawMarkdown || "";
  const showingRaw = body.classList.toggle("showing-raw-markdown");
  button.setAttribute("aria-pressed", String(showingRaw));
  button.setAttribute("aria-label", "Toggle raw markdown");
  button.textContent = "raw";
  content.innerHTML = showingRaw
    ? `<pre class="terminal-raw-markdown">${escapeHtml(raw)}</pre>`
    : renderTerminalMarkdownContent(raw);
  if (!showingRaw) highlightCodeBlocks(content);
  applyTerminalMessageClamps(body.closest(".terminal-entry") || body);
}

export function highlightCodeBlocks(root) {
  window.Prism?.highlightAllUnder?.(root);
  updateMarkdownCodeCopyPositions(root);
}

export async function copyAgentBranchName(branchName) {
  if (!branchName) return;
  try {
    await copyTextToClipboard(branchName);
    toast("Branch copied");
  } catch {
    toast("Could not copy branch", { kind: "error" });
  }
}

export async function copyMarkdownCodeBlock(button) {
  const code = button.closest(".markdown-code-block")?.querySelector("code")?.textContent || "";
  if (!code) return;
  try {
    await copyTextToClipboard(code);
  } catch {
    toast("Could not copy code", { kind: "error" });
  }
}

export function markdownTableColumnWidths(table) {
  return Array.from(table.querySelectorAll("thead th")).map((header) =>
    Math.max(MARKDOWN_TABLE_MIN_COLUMN_WIDTH, Math.round(header.getBoundingClientRect().width)),
  );
}

export function setMarkdownTableColumnWidths(table, widths) {
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

export function startMarkdownTableColumnResize(event) {
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

export function updateMarkdownCodeCopyPositions(root = els.flowPane) {
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

export function markdownCodeBlockClipTop(block) {
  let clipTop = 0;
  for (let node = block.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!/(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowY}`)) continue;
    clipTop = Math.max(clipTop, node.getBoundingClientRect().top);
  }
  return clipTop;
}

export let markdownCodeCopyPositionFrame = 0;

export function scheduleMarkdownCodeCopyPositionUpdate(root = els.flowPane) {
  if (markdownCodeCopyPositionFrame) return;
  markdownCodeCopyPositionFrame = requestAnimationFrame(() => {
    markdownCodeCopyPositionFrame = 0;
    updateMarkdownCodeCopyPositions(root);
  });
}

export function terminalMessageMaxLines(root) {
  const panel = root.closest?.(".agent-panel") || els.flowPane.querySelector(".agent-panel");
  const value = getComputedStyle(panel || document.documentElement)
    .getPropertyValue("--terminal-message-max-lines")
    .trim();
  const maxLines = Number.parseInt(value, 10);
  return Number.isFinite(maxLines) && maxLines > 0 ? maxLines : 50;
}

export function applyTerminalMessageClamps(root) {
  if (!root) return;
  if (root.closest?.(".shell-output-pane")) return;
  const maxLines = terminalMessageMaxLines(root);
  const bodies = root.matches?.(".terminal-entry-body")
    ? [root]
    : Array.from(root.querySelectorAll(".terminal-entry-body"));
  // Batch DOM writes and reads into phases so clamping N entries costs a
  // constant number of reflows instead of one forced reflow per entry.
  const targets = [];
  for (const body of bodies) {
    const entry = body.closest(".terminal-entry");
    if (
      !entry ||
      ((entry.classList.contains("terminal-entry-assistant") || entry.classList.contains("terminal-entry-output")) &&
        !entry.closest(".terminal-trace-body")) ||
      body.classList.contains("agent-working") ||
      body.closest(".shell-output-pane")
    ) {
      continue;
    }
    const content = terminalMessageContent(body);
    body.querySelectorAll(":scope > .terminal-entry-overflow-marker").forEach((marker) => marker.remove());
    targets.push({ body, entry, content, lineHeight: 0 });
  }
  for (const target of targets) {
    target.lineHeight = Number.parseFloat(getComputedStyle(target.body).lineHeight);
  }
  for (const target of targets) {
    if (Number.isFinite(target.lineHeight) && target.lineHeight > 0) {
      target.content.style.setProperty("--terminal-message-max-height", `${target.lineHeight * maxLines}px`);
    }
    for (const image of target.content.querySelectorAll("img")) {
      if (!image.complete) image.addEventListener("load", () => applyTerminalMessageClamps(target.entry), { once: true });
    }
  }
  const overflowing = targets.filter((target) => target.content.scrollHeight > target.content.clientHeight + 1);
  for (const target of overflowing) {
    const marker = document.createElement("div");
    marker.className = "terminal-entry-overflow-marker";
    marker.textContent = ". . .";
    target.body.appendChild(marker);
  }
}

export function terminalMessageContent(body) {
  const existing = body.querySelector(":scope > .terminal-entry-body-content");
  if (existing) return existing;
  const content = document.createElement(body.tagName === "PRE" ? "span" : "div");
  content.className = "terminal-entry-body-content";
  while (body.firstChild) content.appendChild(body.firstChild);
  body.appendChild(content);
  return content;
}

export function terminalGroupRenderKey(group) {
  if (group.source === "agent:trace-group" && group.traceKey) return `trace:${group.traceKey}`;
  return `${group.source}:${group.id}`;
}

export function appendTerminalBlock(fragment, group, options = {}) {
  if (group.source === "agent:trace-group") {
    appendTerminalTraceGroup(fragment, group, options);
    return;
  }

  const meta = logMeta(group.source);
  const block = document.createElement("section");
  block.className = `terminal-entry terminal-entry-${meta.tone}`;
  if (options.incoming) block.classList.add("terminal-entry-incoming");
  if (group.latestVisibleToolOutput) block.classList.add("terminal-entry-tool-preview");

  if (group.source === "agent:tool" || group.source === "agent:tool-result" || group.source === "shell:command") {
    block.classList.add("terminal-entry-command");
    const row = document.createElement("div");
    row.className = "terminal-command-line";

    const marker = document.createElement("span");
    marker.className = "terminal-entry-marker";
    marker.textContent =
      group.simpleModeToolCallCount !== undefined ? `└─ ${group.simpleModeToolCallCount}` : meta.marker;

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
  marker.textContent =
    group.simpleModeToolCallCount !== undefined ? `└─ ${group.simpleModeToolCallCount}` : meta.marker;

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

export function renderOutputDeleteButton(group) {
  const ids = group.logIds || [group.id];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "terminal-output-delete";
  button.setAttribute("aria-label", "Delete output message");
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

export function appendTerminalTraceGroup(fragment, group, options = {}) {
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
  marker.textContent =
    group.simpleModeToolCallCount !== undefined ? `└─ ${group.simpleModeToolCallCount}` : meta.marker;

  const label = document.createElement("span");
  label.className = "terminal-entry-label";
  const elapsed = formatTerminalElapsed(group.displayCreatedAt || group.createdAt, group.displayLastAt || group.lastAt);
  label.textContent = elapsed ? `${meta.label} (${elapsed})` : meta.label;

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

export function openTraceGroupKeys(flowId) {
  if (!state.openTraceGroups.has(flowId)) state.openTraceGroups.set(flowId, new Set());
  return state.openTraceGroups.get(flowId);
}

export function isTerminalTraceGroupOpen(group) {
  return Boolean(group.defaultOpen || (group.flowId && group.traceKey && state.openTraceGroups.get(group.flowId)?.has(group.traceKey)));
}

export function setTerminalTraceGroupOpen(details, open) {
  const flowId = details.closest(".terminal")?._flowLogFlowId || state.selectedFlowId;
  const traceKey = details.dataset.traceKey || "";
  if (!flowId || !traceKey) return;
  const openKeys = openTraceGroupKeys(flowId);
  if (open) openKeys.add(traceKey);
  else openKeys.delete(traceKey);
}

export function materializeTerminalTraceGroup(details) {
  if (details._traceBody) {
    if ((details._traceRenderIndex || 0) > 0) scheduleTerminalTraceRender(details);
    return details._traceBody;
  }
  const children = details._traceChildren || [];
  if (!children.length) {
    details._traceRenderIndex = 0;
    return null;
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
  details._traceRenderIndex = children.length;
  if (details.open) {
    renderTerminalTraceChunk(details, { maxItems: TERMINAL_TRACE_INITIAL_RENDER_COUNT, scheduleNext: false });
    scheduleTerminalTraceRender(details, { delay: TERMINAL_TRACE_OPEN_DURATION_MS });
  } else {
    scheduleTerminalTraceRender(details);
  }
  return body;
}

export function cancelTerminalTraceRender(details) {
  if (details._traceRenderFrame) cancelAnimationFrame(details._traceRenderFrame);
  if (details._traceRenderTimer) window.clearTimeout(details._traceRenderTimer);
  details._traceRenderFrame = 0;
  details._traceRenderTimer = 0;
}

export function scheduleTerminalTraceRender(details, options = {}) {
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

export function renderTerminalTraceChunk(details, options = {}) {
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

export function toggleTerminalTraceGroup(details) {
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

export function terminalDistanceFromBottom(terminal) {
  return terminal.scrollHeight - terminal.clientHeight - terminal.scrollTop;
}

export function terminalAtLatest(terminal) {
  return terminalDistanceFromBottom(terminal) <= 12;
}

export function pauseTerminalFollow() {
  state.terminalFollowPaused = true;
}

export function resumeTerminalFollow() {
  state.terminalFollowPaused = false;
}

export function scrollTerminalToLatest(terminal) {
  requestAnimationFrame(() => {
    scrollTerminalToLatestNow(terminal);
  });
}

export function scrollTerminalToLatestNow(terminal) {
  terminal.scrollTop = terminal.scrollHeight;
}

export function terminalBottomRestorer() {
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

export function terminalBottomTextAnchor(terminal) {
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

export function terminalTextAnchorBottom(anchor) {
  if (!anchor?.node?.isConnected) return null;
  const range = document.createRange();
  range.selectNodeContents(anchor.node);
  const rects = [...range.getClientRects()];
  range.detach();
  return rects[anchor.rectIndex]?.bottom ?? null;
}

export function followTerminalToLatestDuringLayout(terminal, durationMs) {
  const startedAt = performance.now();
  const follow = (now) => {
    applyFlowSplitSize();
    scrollTerminalToLatestNow(terminal);
    if (now - startedAt < durationMs) requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
}

export function appendTerminalWorkingBlock(fragment, runtimeKind = "agent") {
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

export function terminalGroupSignaturePart(group) {
  if (group.source === "agent:trace-group" && group.traceKey && !isTerminalTraceGroupOpen(group)) {
    return [group.source, group.traceKey, group.createdAt].join(":");
  }
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
    group.latestVisibleToolOutput ? "preview" : "",
    group.simpleModeToolCallCount ?? "",
    children,
  ].join(":");
}

export function terminalGroupsSignature(groups) {
  return groups.map((group) => terminalGroupSignaturePart(group)).join("\u001f");
}

export function terminalGroupNodeSignature(group) {
  const logIds = group.logIds || [group.id];
  const deleting = logIds.some((logId) => state.deletingOutputLogIds.has(logId));
  return [terminalGroupSignaturePart(group), Boolean(group.liveStreaming), Boolean(group.turnPending), deleting].join(":");
}

export function syncClosedTerminalTraceChildren(terminal, groups) {
  const childrenByKey = new Map(
    groups
      .filter((group) => group.source === "agent:trace-group" && group.traceKey && !isTerminalTraceGroupOpen(group))
      .map((group) => [group.traceKey, group.children || []]),
  );
  if (!childrenByKey.size) return;
  for (const details of terminal.querySelectorAll(".terminal-trace-group:not([open])")) {
    const children = childrenByKey.get(details.dataset.traceKey || "");
    if (children) details._traceChildren = children;
  }
}

export function terminalVisibleTurnCount(flowId) {
  return state.terminalVisibleTurnCounts.get(flowId) || AGENT_TRACE_INITIAL_TURN_COUNT;
}

export function visibleTerminalGroups(flowId, groups) {
  const startIndex = terminalVisibleTurnStartIndex(flowId, groups);
  return groups.slice(startIndex);
}

export function isAgentToolOutputGroup(group) {
  return [
    "agent:tool",
    "agent:tool-result",
    "agent:output",
    "agent:cmd",
    "agent:stderr",
    "agent:error",
    "agent:approval",
    "agent:input",
    "agent:protocol",
  ].includes(group.source);
}

export function latestAgentToolOutputGroupIndex(groups) {
  let latestUserIndex = -1;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (isSubmittedUserLogSource(groups[index].source)) {
      latestUserIndex = index;
      break;
    }
  }
  for (let index = groups.length - 1; index > latestUserIndex; index -= 1) {
    if (isAgentToolOutputGroup(groups[index])) return index;
  }
  return -1;
}

export function hasLiveAgentReplyGroup(groups) {
  return groups.some((group) => group.liveStreaming && (group.source === "agent" || group.source === "agent:message"));
}

export function traceThoughtGroups(groups) {
  return (groups || []).filter((group) => !isAgentToolOutputGroup(group));
}

export function agentOutputSimpleMode() {
  return state.agentTraceHidden;
}

export function isAgentThoughtOrMessageGroup(group) {
  return ["agent", "agent:message", "agent:thinking", "agent:reasoning"].includes(group.source);
}

export function toolCallCountSincePreviousThought(groups, index) {
  let count = 0;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const group = groups[cursor];
    if (cursor !== index && isAgentThoughtOrMessageGroup(group)) break;
    if (group.source === "agent:tool") count += group.logIds?.length || 1;
  }
  return count;
}

export function renderableTerminalGroups(groups, options = {}) {
  if (!agentOutputSimpleMode()) return groups;
  const latestToolIndex = options.agentWorking && !hasLiveAgentReplyGroup(groups) ? latestAgentToolOutputGroupIndex(groups) : -1;
  const latestToolCallCount = latestToolIndex === -1 ? 0 : toolCallCountSincePreviousThought(groups, latestToolIndex);
  const result = [];
  for (const [index, group] of groups.entries()) {
    const latestVisibleToolOutput = index === latestToolIndex && isAgentToolOutputGroup(group);
    group.latestVisibleToolOutput = latestVisibleToolOutput;
    if (latestVisibleToolOutput) group.simpleModeToolCallCount = latestToolCallCount;
    if (group.source === "agent:trace-group") {
      result.push({ ...group, children: traceThoughtGroups(group.children), defaultOpen: false });
      continue;
    }
    if (group.traceContent && index !== latestToolIndex) continue;
    if (isAgentToolOutputGroup(group) && index !== latestToolIndex) continue;
    result.push(group);
  }
  return result;
}

export function terminalTraceCanLoadMore(flowId, groups) {
  return terminalVisibleTurnStartIndex(flowId, groups) > 0 || !state.logOlderCompleteFlowIds.has(flowId);
}

export function terminalVisibleTurnStartIndex(flowId, groups) {
  const visibleTurns = terminalVisibleTurnCount(flowId);
  let seenTurns = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (!isSubmittedUserLogSource(groups[index].source)) continue;
    seenTurns += 1;
    if (seenTurns >= visibleTurns) return index;
  }
  return 0;
}

export function terminalTurnCount(groups) {
  return groups.filter((group) => isSubmittedUserLogSource(group.source)).length;
}

export function scheduleLogRender(id, options = {}) {
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

export function renderLogs(id, options = {}) {
  const terminal = terminalForFlowLogs(id);
  if (!terminal || terminal.hidden) return;
  renderShellOutputPane(id);
  const flow = state.flows.find((item) => item.id === id) || null;
  const logs = state.logs.get(id) || [];
  const allGroups = terminalGroups(logs, flow);
  const agentWorking = agentWorkingForFlow(flow);
  const groups = renderableTerminalGroups(visibleTerminalGroups(id, allGroups), { agentWorking });
  syncClosedTerminalTraceChildren(terminal, groups);
  const canLoadMore = terminalTraceCanLoadMore(id, allGroups);
  const loadMoreLoading = state.logOlderLoadingFlowIds.has(id);
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
  const animateIncoming = !options.suppressIncoming && !agentWorking;
  const previousKeys = terminal._flowLogFlowId === id ? terminal._flowLogRenderedKeys : null;
  const nodeCache = terminal._flowLogFlowId === id && terminal._flowLogNodeCache instanceof Map ? terminal._flowLogNodeCache : new Map();
  const nextKeys = new Set(groups.map((group) => terminalGroupRenderKey(group)));
  const nextNodeCache = new Map();
  const fragment = document.createDocumentFragment();
  if (canLoadMore) appendTerminalLoadMoreButton(fragment, { loading: loadMoreLoading });
  for (const group of groups) {
    const renderKey = terminalGroupRenderKey(group);
    const nodeSignature = terminalGroupNodeSignature(group);
    const cached = nodeCache.get(renderKey);
    if (cached && cached.signature === nodeSignature && !nextNodeCache.has(renderKey)) {
      cached.node.classList.remove("terminal-entry-incoming");
      fragment.appendChild(cached.node);
      nextNodeCache.set(renderKey, cached);
      continue;
    }
    appendTerminalBlock(fragment, group, { incoming: Boolean(animateIncoming && previousKeys && !previousKeys.has(renderKey)) });
    const node = fragment.lastElementChild;
    if (node && !nextNodeCache.has(renderKey)) nextNodeCache.set(renderKey, { signature: nodeSignature, node });
  }
  if (agentWorking) appendTerminalWorkingBlock(fragment);
  terminal.replaceChildren(fragment);
  applyTerminalMessageClamps(terminal);
  terminal._flowLogFlowId = id;
  terminal._flowLogSignature = signature;
  terminal._flowLogRenderedKeys = nextKeys;
  terminal._flowLogNodeCache = nextNodeCache;
  terminal._flowLogPending = "";
  terminal._flowLogPendingOptions = null;
  if (atLatest) scrollTerminalToLatestNow(terminal);
  else if (options.preserveScrollTop) {
    terminal.scrollTop = scrollTopBeforeRender + (terminal.scrollHeight - scrollHeightBeforeRender);
  }
  renderShellOutputPane(id);
}

export function appendTerminalLoadMoreButton(fragment, options = {}) {
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

export function terminalTraceInteractionActive(terminal) {
  return Boolean(terminal?.querySelector(".terminal-trace-animating"));
}

export function mergeLogRenderOptions(existing = {}, incoming = {}) {
  return {
    force: Boolean(existing.force || incoming.force),
    scrollToLatest: Boolean(existing.scrollToLatest || incoming.scrollToLatest),
    suppressIncoming: Boolean(existing.suppressIncoming || incoming.suppressIncoming),
    fromTraceFlush: Boolean(existing.fromTraceFlush || incoming.fromTraceFlush),
    preserveScrollTop: Boolean(existing.preserveScrollTop || incoming.preserveScrollTop),
  };
}

export function deferTerminalLogRender(terminal, flowId, options = {}) {
  terminal._flowLogPending = flowId;
  terminal._flowLogPendingOptions = mergeLogRenderOptions(terminal._flowLogPendingOptions || {}, options);
}

export function flushDeferredTerminalLogRender(terminal, options = {}) {
  const pendingFlowId = terminal?._flowLogPending;
  if (!pendingFlowId) return;
  const pendingOptions = mergeLogRenderOptions(terminal._flowLogPendingOptions || {}, options);
  terminal._flowLogPending = "";
  terminal._flowLogPendingOptions = null;
  renderLogs(pendingFlowId, pendingOptions);
}
