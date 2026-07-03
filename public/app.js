import { closeDiffViewer, loadFlowDiff, scheduleSelectedDiffFileSync, setSelectedDiffFile } from "./js/diff.js";
import { renderFlowPane, selectedFlow, setFlows } from "./js/flows.js";
import {
  closeImagePreview,
  endImagePreviewDrag,
  handleImagePreviewClick,
  handleImagePreviewPointerDown,
  handleImagePreviewPointerMove,
  handleImagePreviewWheel,
  imagePreviewFrame,
} from "./js/image-preview.js";
import {
  cancelHistorySearch,
  handleHistorySearchKeydown,
  handleInputHistoryNavigationKeydown,
  resetInputHistoryNavigation,
} from "./js/input-history.js";
import {
  applyShellOutputSplitSize,
  applyTheme,
  handleTicketDrawerResizeKeydown,
  setFlowSplitSize,
  setLinearPaneHidden,
  setShellOutputSplitSize,
  setShellOutputSplitSizeKeepingTerminalBottom,
  setShellPaneHidden,
  setTicketDrawerHidden,
  setTicketDrawerSize,
  startFlowSplitResize,
  startShellOutputSplitResize,
  startTicketDrawerResize,
  toggleLinearPaneHidden,
  toggleShellPaneHidden,
  toggleTheme,
} from "./js/layout.js";
import { loadLogs, loadOlderTerminalTraceMessages } from "./js/logs.js";
import { api, connectWs } from "./js/net.js";
import { acknowledgeSelectedLinearIssueNotification, updateBrowserTabNotification } from "./js/notifications.js";
import {
  droppedImageFiles,
  eventHasDraggedFiles,
  focusMessageInputForKey,
  focusPromptInputForImageDrag,
  handleAgentInterruptKeydown,
  handleCommandE,
  handleCommandK,
  handleGlobalHistorySearchKeydown,
  handleInputPaneTabKeydown,
  handlePaneVisibilityShortcuts,
  handleQueuedPromptBeforeInput,
  handleQueuedPromptKeydown,
  handleShellInterruptKeydown,
  pastedImageFiles,
  promptInput,
  resizeMessageInput,
  saveActiveTicketInputState,
  setAgentImageDragActive,
  shellInput,
  submitPromptCommand,
  submitPromptMessage,
  submitShellCommand,
  updateMessageInputMode,
  uploadAgentImages,
} from "./js/prompt.js";
import { render } from "./js/render.js";
import {
  agentConfigSignature,
  envEditorContents,
  flushEnvSaveOnPageHide,
  handleEnvEditorChange,
  handleEnvEditorClick,
  handleEnvEditorFocusIn,
  handleEnvEditorFocusOut,
  handleEnvEditorInput,
  handleEnvEditorPaste,
  renderEnvEditor,
  renderSettingsSections,
  repoConfigSignature,
  reportAutoSaveError,
  resetSettingsHorizontalScroll,
  saveAgentConfig,
  saveRepoConfig,
  scheduleAgentConfigSave,
  scheduleRepoConfigSave,
  setDefaultSettingsState,
  setSettingsCollapsed,
  toggleSettingsCollapsed,
  toggleSettingsSection,
} from "./js/settings.js";
import {
  hideSlashMenu,
  renderSlashMenu,
  slashCommandHasExpansions,
  slashCommandMatches,
  validSlashCommand,
} from "./js/slash-commands.js";
import { els, state } from "./js/state.js";
import {
  flushDeferredTerminalLogRender,
  pauseTerminalFollow,
  resumeTerminalFollow,
  renderLogs,
  scheduleMarkdownCodeCopyPositionUpdate,
  startMarkdownTableColumnResize,
  terminalAtLatest,
  toggleTerminalMarkdownOutput,
} from "./js/terminal-render.js";
import {
  closeTicketSearch,
  createPinnedLinearTicket,
  handleLinearDetailClick,
  handleLinearOptionsClose,
  handleLinearOptionsOpen,
  handleLinearTitleKeydown,
  handleLinearTitleOutsidePointerDown,
  handleLinearTitleSubmit,
  handleTicketGridDragOver,
  hideFloatingLinearOptions,
  loadLinearTickets,
  openTicketSearch,
  renderTickets,
  shouldHideFloatingLinearOptionsForScroll,
  updateLinearState,
} from "./js/tickets.js";

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
  state.lastSavedRepoConfig = repoConfigSignature();
  els.agentDeveloperInstructions.value = data.agents.developerInstructions || "";
  state.defaultAgentDeveloperInstructions = data.agents.defaultDeveloperInstructions || "";
  state.defaultAgentProvider = data.agents.defaultProvider === "claude" ? "claude" : "codex";
  state.lastSavedAgentConfig = agentConfigSignature();
  state.linearSignedIn = data.linear.signedIn;
  setDefaultSettingsState(data.linear);
  updateLinearState(data.linear);
  renderEnvEditor(env.contents || "");
  state.lastSavedEnv = envEditorContents();
  render();
  const flow = selectedFlow();
  if (flow) {
    await loadLogs(flow.id);
    void loadFlowDiff(flow.id, { force: true });
  }
  if (state.linearSignedIn) await loadLinearTickets();
  void connectWs().catch(() => {});
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

els.agentTraceToggle.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  state.agentTraceHidden = !state.agentTraceHidden;
  els.agentTraceToggle.setAttribute("aria-pressed", String(state.agentTraceHidden));
  els.agentTraceToggle.setAttribute("aria-label", state.agentTraceHidden ? "Show tool output messages" : "Hide tool output messages");
  renderLogs(state.selectedFlowId, { force: true, preserveScrollTop: true });
});

els.flowPane.addEventListener("click", handleLinearDetailClick);

els.flowPane.addEventListener("submit", handleLinearTitleSubmit);

els.flowPane.addEventListener("keydown", handleLinearTitleKeydown);

els.flowPane.addEventListener("mouseover", handleLinearOptionsOpen);

els.flowPane.addEventListener("mouseout", handleLinearOptionsClose);

els.flowPane.addEventListener("focusin", handleLinearOptionsOpen);

els.flowPane.addEventListener("focusout", handleLinearOptionsClose);

els.flowPane.addEventListener("pointerdown", startMarkdownTableColumnResize);

els.flowPane.addEventListener("scroll", (event) => {
  scheduleMarkdownCodeCopyPositionUpdate();
  if (shouldHideFloatingLinearOptionsForScroll(event)) hideFloatingLinearOptions();
}, { capture: true, passive: true });

document.addEventListener("pointerdown", handleLinearTitleOutsidePointerDown);

window.addEventListener("resize", () => {
  scheduleMarkdownCodeCopyPositionUpdate();
  hideFloatingLinearOptions();
}, { passive: true });

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
  state.slashMenuCommands = null;
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
  if (command.startsWith("/model ")) {
    void submitPromptCommand(command);
    return;
  }
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

imagePreviewFrame?.addEventListener("wheel", handleImagePreviewWheel, { passive: false });

imagePreviewFrame?.addEventListener("pointerdown", handleImagePreviewPointerDown);

imagePreviewFrame?.addEventListener("pointermove", handleImagePreviewPointerMove);

imagePreviewFrame?.addEventListener("pointerup", endImagePreviewDrag);

imagePreviewFrame?.addEventListener("pointercancel", endImagePreviewDrag);

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
