import { describe, expect, test } from "bun:test";

const html = await Bun.file("public/index.html").text();
const app = await Bun.file("public/app.js").text();
const css = await Bun.file("public/styles.css").text();
const server = await Bun.file("src/server.ts").text();
const packageJson = await Bun.file("package.json").json();
const markdown = await Bun.file("public/linear-markdown.js").text();
const readyStatusIcon = await Bun.file("public/status-icons/ready.svg").text();
const completedStatusIcon = await Bun.file("public/status-icons/completed.svg").text();
const { renderLinearMarkdown } = await import("../public/linear-markdown.js");
const legacyFlowName = new RegExp(`${"water"}${"flow"}`, "i");

describe("Turbopump pane markup", () => {
  test("uses Turbopump for product copy and flow for the workflow noun", () => {
    expect(html).toContain("<title>Turbopump</title>");
    expect(html).toContain('href="/favicon.svg"');
    expect(app).toContain("/api/flows");
    expect(server).toContain("FLOW_RUN_ID");
    expect(app).not.toMatch(legacyFlowName);
    expect(css).not.toMatch(legacyFlowName);
    expect(html).not.toMatch(legacyFlowName);
    expect(server).not.toMatch(legacyFlowName);
  });

  test("uses a simple chevron for the settings collapse button", () => {
    expect(html).toContain('<path d="m15 6-6 6 6 6" />');
    expect(html).not.toContain('<rect x="3" y="4" width="18" height="16" rx="2" />');
    expect(html).not.toContain('<path d="M9 4v16" />');
  });

  test("shows a cogwheel icon for collapsed settings", () => {
    expect(html).toContain('<body class="settings-collapsed app-booting">');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="settings-collapsed-icon"');
    expect(css).toContain(".settings-collapsed-icon");
    expect(css).toContain("body.settings-collapsed .settings-collapsed-icon");
    expect(css).toContain("body.settings-collapsed .settings-toggle");
    expect(css).toContain("padding: 14px 0;");
    expect(css).toContain("body.settings-collapsed .settings-header {\n  display: grid;");
    expect(css).toContain("gap: 0;");
    expect(css).toContain("justify-self: center;");
    expect(css).toContain("--settings-pane-size: 26px;");
    expect(css).toContain("width: 26px;");
  });

  test("hides the Linear tickets pane on narrow screens", () => {
    expect(css).toContain("@media (max-width: 980px)");
    expect(css).toContain("  .ticket-drawer {\n    display: none;\n  }");
    expect(css).not.toContain("max-height: 360px;");
  });

  test("can hide the Linear tickets pane from the keyboard", () => {
    expect(app).not.toContain("flow.ticketDrawerHidden");
    expect(app).toContain("ticketDrawerHidden: false");
    expect(html).toContain("app-booting");
    expect(app).toContain("function setTicketDrawerHidden(hidden)");
    expect(app).toContain('document.body.classList.toggle("tickets-collapsed", hidden);');
    expect(app).not.toContain("localStorage.setItem(TICKET_DRAWER_HIDDEN_KEY");
    expect(app).toContain('requestAnimationFrame(() => document.body.classList.remove("app-booting"));');
    expect(app).toContain("function toggleTicketDrawerHidden()");
    expect(app).toContain('event.code === "Backquote" || key === "`"');
    expect(css).toContain("--ticket-drawer-size: 320px;");
    expect(css).toContain("--settings-pane-size var(--motion-pane),\n    --ticket-drawer-size var(--motion-pane);");
    expect(css).toContain("body.tickets-collapsed main {\n  --ticket-drawer-size: 0px;\n}");
    expect(css).toContain("body.app-booting main,\nbody.app-booting .ticket-drawer {\n  transition: none;\n}");
    expect(css).toContain("body.tickets-collapsed .ticket-drawer");
    expect(css).toContain("visibility 0ms linear 160ms;");
  });

  test("hides the settings pane entirely on narrow screens", () => {
    const narrowRules = css.slice(css.indexOf("@media (max-width: 980px)"), css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(narrowRules).toContain("  .sidebar {\n    display: none;\n  }");
    expect(narrowRules).not.toContain("body.settings-collapsed .sidebar");
    expect(narrowRules).not.toContain("body.settings-collapsed .settings-header");
  });

  test("keeps the flow split height stable on narrow screens", () => {
    const narrowRules = css.slice(css.indexOf("@media (max-width: 980px)"), css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(narrowRules).toContain("  main {\n    grid-template-columns: 1fr;\n  }");
    expect(narrowRules).not.toContain("height: auto;");
    expect(narrowRules).not.toContain(".workspace {\n    min-height: 720px;\n  }");
  });

  test("keeps the Settings heading larger than section toggles", () => {
    expect(css).toContain(".settings-header h2 {\n  margin: 0;\n  color: var(--ink);\n  font-size: 22px;");
    expect(css).toContain(".settings-section-toggle {\n  display: flex;");
    expect(css).toContain("font-size: 14px;");
    expect(css).not.toContain(".sidebar h2 {\n  margin: 0;\n  font-size: 14px;");
  });

  test("defaults settings closed unless Linear is disconnected", () => {
    expect(app).toContain("settingsCollapsed: true");
    expect(app).not.toContain('localStorage.getItem("flow.settingsCollapsed")');
    expect(app).not.toContain('localStorage.setItem("flow.settingsCollapsed"');
    expect(app).toContain("function setDefaultSettingsState(linear)");
    expect(app).toContain("setSettingsCollapsed(Boolean(linear.signedIn));");
    expect(app).toContain("function toggleSettingsCollapsed()");
    expect(app.indexOf("setDefaultSettingsState(data.linear);")).toBeLessThan(
      app.indexOf("updateLinearState(data.linear);"),
    );
  });

  test("toggles settings with Cmd+Comma", () => {
    expect(app).toContain("function handlePaneVisibilityShortcuts(event)");
    expect(app).toContain('const togglesSettings = event.metaKey && !event.ctrlKey && !event.altKey && (event.code === "Comma" || key === ",");');
    expect(app).toContain("if (!togglesSettings && !togglesTickets && !togglesShell) return false;");
    expect(app).toContain("event.preventDefault();");
    expect(app).toContain("event.stopImmediatePropagation();");
    expect(app).toContain("if (togglesSettings) toggleSettingsCollapsed();");
    expect(app).toContain('document.addEventListener("keydown", handlePaneVisibilityShortcuts, true);');
    expect(app).toContain("toggleSettingsCollapsed();\n});");
  });

  test("keeps the theme toggle visible outside settings expansion", () => {
    expect(html).toContain('id="themeToggle"');
    expect(html).toContain('class="icon-button theme-toggle"');
    expect(html).toContain('aria-label="Switch to dark mode"');
    expect(html.indexOf('id="settingsPane"')).toBeLessThan(html.indexOf('id="themeToggle"'));
    expect(html.indexOf("</main>")).toBeLessThan(html.indexOf('id="themeToggle"'));
    expect(app).toContain('const THEME_KEY = "flow.theme";');
    expect(app).toContain("theme: initialTheme()");
    expect(app).toContain("function setTheme(theme)");
    expect(app).toContain('els.themeToggle.addEventListener("click", (event) => {');
    expect(app).toContain("event.stopPropagation();");
    expect(app).toContain('if (event.target !== els.settingsPane) return;');
    expect(css).toContain(".theme-toggle {\n  position: fixed;");
    expect(css).toContain("left: 0;\n  bottom: 0px;");
    expect(css).toContain("width: 26px;\n  min-width: 26px;");
    expect(css).toContain("border: 0;");
    expect(css).toContain("background: transparent;");
    expect(css).toContain("  .theme-toggle {\n    display: none;\n  }");
    expect(css).toContain("body.settings-collapsed .theme-toggle");
    expect(css).toContain("body.theme-dark");
    expect(css).toContain("body.theme-dark .theme-icon-moon");
  });

  test("keeps dark mode headings and user messages readable", () => {
    expect(css).toContain(".ticket-drawer h2 {\n  margin: 0;\n  color: var(--ink);");
    expect(css).toContain("body.theme-dark .ticket-status-separator {\n  color: var(--muted);\n}");
    expect(css).toContain("body.theme-dark .ticket-title {\n  color: var(--terminal-ink);\n}");
    expect(css).toContain("body.theme-dark .terminal-entry-user .terminal-entry-body {\n  color: var(--terminal-ink);");
    expect(css).toContain(".terminal-entry-user .terminal-entry-marker,\n.terminal-entry-user .terminal-entry-label {\n  color: #d97706;\n}");
    expect(css).toContain("body.theme-dark .terminal-entry-user .terminal-entry-marker,\nbody.theme-dark .terminal-entry-user .terminal-entry-label {\n  color: #fbbf24;\n}");
  });

  test("keeps Linear connection state pill from being selected", () => {
    expect(html).toContain('<span id="linearState" class="pill">');
    expect(css).toContain(".pill {");
    expect(css).toContain("user-select: none;");
  });

  test("does not show a Linear disconnect button", () => {
    expect(html).not.toContain("disconnectLinear");
    expect(html).not.toContain("Disconnect Linear");
    expect(app).not.toContain("disconnectLinear");
    expect(css).not.toContain("#disconnectLinear");
  });

  test("hides the Development settings section", () => {
    expect(html).toContain('<section class="settings-section development-settings" hidden>');
    expect(html).toContain("<span>Development</span>");
    expect(css).toContain("[hidden] {\n  display: none !important;");
  });

  test("persists environment settings in a dedicated db table", () => {
    expect(html).toContain('<section class="settings-section environment-settings">');
    expect(html).toContain("<span>Environment</span>");
    expect(html).toContain('<div class="env-editor" id="envEditor" aria-label="Environment variables"></div>');
    expect(html).not.toContain('<textarea id="envEditor"');
    expect(css).toContain(".env-row {\n  display: grid;");
    expect(css).toContain("  padding: 0;");
    const envRowCss = css.slice(css.indexOf(".env-row {"), css.indexOf(".env-row input {"));
    expect(envRowCss).not.toContain("border-bottom");
    expect(css).toContain(".env-row + .env-row {\n  padding-top: 12px;");
    expect(css).not.toContain('grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);');
    expect(app).toContain("function parseEnvEditorRows(contents)");
    expect(app).toContain('keyInput.placeholder = "KEYNAME";');
    expect(app).toContain('valueInput.placeholder = "VALUE";');
    expect(app).toContain("function maskedEnvValue(value)");
    expect(app).toContain('valueInput.dataset.envValue = value;');
    expect(app).toContain("valueInput.value = maskedEnvValue(value);");
    expect(app).toContain("function revealEnvValueInput(input)");
    expect(app).toContain("function maskEnvValueInput(input)");
    expect(app).toContain('els.envEditor.addEventListener("focusin", handleEnvEditorFocusIn);');
    expect(app).toContain("function envEditorContents()");
    expect(app).toContain("function handleEnvEditorPaste(event)");
    expect(app).toContain("if (!row || !envRowIsEmpty(row)) return;");
    expect(app).toContain('event.clipboardData?.getData("text")');
    expect(app).toContain("renderEnvEditor(env.contents || \"\");");
    expect(server).toContain("create table if not exists environment_variables");
    expect(server).toContain("const getEnvironmentVariablesStmt = db.query(\"select contents from environment_variables where id = 1\");");
    expect(server).toContain("const setEnvironmentVariablesStmt = db.query(");
    expect(server).toContain("function readEnvContents()");
    expect(server).toContain("return row?.contents ?? \"\";");
    expect(server).toContain("function writeEnvContents(contents: string)");
    expect(server).toContain("writeEnvContents(body.contents ?? \"\");");
    expect(server).not.toContain("sessionEnvContents");
    expect(server).not.toContain("const envPath");
    expect(server).not.toContain("const legacyEnvPath");
    expect(server).not.toContain("writeFileSync(envPath, body.contents ?? \"\", \"utf8\");");
    expect(server).toContain("...parseEnv(readEnvContents()),");
    expect(server).toContain("env: runtimeEnv(flow),");
    expect(server).toContain("function shellRuntimeEnv(flow: Flow)");
    expect(server).toContain("delete env.NO_COLOR;");
    expect(server).toContain("delete env.NODE_DISABLE_COLORS;");
    expect(server).toContain('FORCE_COLOR: process.env.FORCE_COLOR || "3",');
    expect(server).toContain('CLICOLOR_FORCE: "1",');
    expect(server).toContain("env: shellRuntimeEnv(flow),");
    expect(server).toContain("function stopIdleAgentRuntimesForEnvUpdate()");
    expect(server).toContain("if (runtime.activeTurnId) continue;");
    expect(server).toContain("stopIdleAgentRuntimesForEnvUpdate();");
    expect(app).toContain('window.addEventListener("pagehide", flushEnvSaveOnPageHide);');
    expect(app).toContain("keepalive: true");
  });

  test("makes settings sections collapsible", () => {
    expect(html).toContain('class="settings-section-toggle"');
    expect(html).toContain('class="settings-section-body"');
    expect(app).toContain('const COLLAPSED_SETTINGS_SECTIONS_KEY = "flow.collapsedSettingsSections";');
    expect(app).toContain("function initialCollapsedSettingsSections()");
    expect(app).toContain('if (raw === null) return new Set(["checkouts"]);');
    expect(app).toContain("collapsedSettingsSections: initialCollapsedSettingsSections()");
    expect(app).toContain("function toggleSettingsSection(section)");
    expect(app).toContain('els.settingsContent.addEventListener("click", (event) => {');
    expect(app).toContain('localStorage.setItem(COLLAPSED_SETTINGS_SECTIONS_KEY, JSON.stringify([...state.collapsedSettingsSections]));');
    expect(css).toContain(".settings-section.collapsed .settings-section-body {\n  display: none;");
    expect(css).toContain(".settings-section.collapsed .settings-section-chevron");
  });

  test("exposes agent developer instructions in Settings", () => {
    expect(html).toContain('<section class="settings-section agent-settings">');
    expect(html).toContain("<span>Agents</span>");
    expect(html).toContain('id="agentDeveloperInstructions"');
    expect(html).toContain('id="resetAgentDeveloperInstructions"');
    expect(html).toContain('aria-label="Reset developer instructions"');
    expect(html).not.toContain('id="agentStartPrompt"');
    expect(app).toContain("agentDeveloperInstructions: document.querySelector");
    expect(app).toContain("resetAgentDeveloperInstructions: document.querySelector");
    expect(app).not.toContain("agentStartPrompt");
    expect(app).toContain("function agentConfigSignature()");
    expect(app).toContain("async function saveAgentConfig()");
    expect(app).toContain('await api("/api/agents",');
    expect(app).toContain("els.agentDeveloperInstructions.value = data.agents.developerInstructions || \"\";");
    expect(app).toContain("state.defaultAgentDeveloperInstructions = data.agents.defaultDeveloperInstructions || \"\";");
    expect(app).toContain("els.agentDeveloperInstructions.addEventListener(\"input\", scheduleAgentConfigSave);");
    expect(app).toContain('els.resetAgentDeveloperInstructions.addEventListener("click", () => {');
    expect(app).toContain("els.agentDeveloperInstructions.value = state.defaultAgentDeveloperInstructions;");
    expect(css).toContain(".agent-settings textarea");
    expect(css).toContain(".setting-label-row");
    expect(server).toContain("const defaultAgentDeveloperInstructions");
    expect(server).not.toContain("defaultAgentStartPrompt");
    expect(server).toContain("function renderAgentTemplate");
    expect(server).toContain("function getStoredSetting(key: string)");
    expect(server).toContain('const stored = getStoredSetting("agentDeveloperInstructions");');
    expect(server).toContain("if (stored !== null) return stored;");
    expect(server).not.toContain("legacyAgentDeveloperInstructions");
    expect(server).toContain('setSetting("agentDeveloperInstructions", defaultAgentDeveloperInstructions);');
    expect(server).toContain('agents: {\n        developerInstructions: getAgentDeveloperInstructionsTemplate(),');
    expect(server).toContain("defaultDeveloperInstructions: defaultAgentDeveloperInstructions,");
    expect(server).toContain('url.pathname === "/api/agents"');
    expect(server).toContain('setSetting("agentDeveloperInstructions"');
    expect(server).not.toContain('setSetting("agentStartPrompt"');
    expect(server).not.toContain("buildAgentPrompt");
    expect(server).toContain("flowMetaApiUrl");
    expect(server).toContain('Example body: {"prUrl":"https://github.com/org/repo/pull/123"}');
    expect(server).toContain("Each field in the body is optional.");
    expect(server).not.toContain('"Current stage: {stage}"');
    expect(server).not.toContain("FLOW_STAGE");
    expect(server).not.toContain("stage: flow.stage,");
    expect(server).toContain("prUrl: flow.prUrl,");
  });

  test("shows worktree cleanup cards in Settings and deletes trace data with the workspace", () => {
    expect(html).toContain('<section class="settings-section checkout-settings">');
    expect(html).toContain("<span>Worktrees</span>");
    expect(html).toContain('id="checkoutList"');
    expect(app).toContain("checkouts: []");
    expect(app).toContain("checkoutsLoaded: false");
    expect(app).toContain("checkoutsLoading: false");
    expect(app).toContain("checkoutList: document.querySelector");
    expect(app).toContain("function renderCheckouts()");
    expect(app).toContain("function renderCheckoutCard(checkout)");
    expect(app).toContain("function ensureCheckoutsLoaded()");
    expect(app).toContain("function scheduleCheckoutsLoaded()");
    expect(app).toContain("if (state.settingsCollapsed) return;");
    expect(app).toContain("renderCheckouts();\n    scheduleCheckoutsLoaded();");
    expect(app).toContain("scheduleCheckoutsLoaded();");
    expect(app).toContain("checkoutLoadFrame = requestAnimationFrame");
    expect(app).toContain("state.checkoutsLoading = true;");
    expect(app).toContain("function renderLinearStatusIcon(status)");
    expect(app).toContain('<img src="/status-icons/${kind}.svg" alt="" aria-hidden="true" />');
    expect(app).toContain('["Linear", renderLinearStatusIcon(checkout.linearStatus)]');
    expect(app).not.toContain('["Phase", checkout.flowPhase || "No flow"]');
    expect(app).toContain("function deleteCheckout(name)");
    expect(app).toContain("function clearFlowClientState(flowId)");
    expect(app).toContain("if (data.flows) setFlows(data.flows);");
    expect(app).toContain("if (data.checkouts) setCheckouts(data.checkouts);");
    expect(app).toContain("Date.parse(a.lastPromptAt || a.createdAt || 0)");
    expect(app).toContain("deletingCheckoutNames: new Set()");
    expect(app).toContain('spinner.className = "checkout-spinner";');
    expect(app).toContain('await api(`/api/checkouts/${encodeURIComponent(name)}`, { method: "DELETE" });');
    expect(app).toContain('if (message.event === "checkouts")');
    expect(css).toContain(".checkout-list");
    expect(css).toContain(".linear-status-icon");
    expect(css).toContain(".linear-status-icon img");
    expect(readyStatusIcon).toContain('<circle cx="10" cy="10" r="8" fill="#f2c200" />');
    expect(readyStatusIcon).toContain('<circle cx="10" cy="10" r="5.4" fill="#ffffff" />');
    expect(completedStatusIcon).toContain('<circle cx="10" cy="10" r="8" fill="#2563eb" />');
    expect(completedStatusIcon).toContain('stroke="#ffffff"');
    expect(css).toContain(".checkout-card:hover .checkout-delete");
    expect(css).toContain(".checkout-spinner");
    expect(css).toContain("@keyframes checkout-spinner");
    expect(css).toContain("pointer-events: none;");
    expect(server).toContain("function listWorktrees()");
    expect(server).toContain("Date.parse(a.lastPromptAt || a.createdAt || \"\")");
    expect(server).toContain("async function refreshWorktreeLinearStatuses()");
    expect(server).toContain("await refreshWorktreeLinearStatuses();");
    expect(server).toContain("if (linearBackoffRemainingMs() > 0) return;");
    expect(server).toContain("for (const flow of flows) {");
    expect(server).toContain("if (error instanceof LinearUnavailableError) return;");
    expect(server).toContain("latestPromptTimestamp(flow.id)");
    expect(server).toContain('url.pathname === "/api/checkouts"');
    expect(server).toContain('parts[0] === "api" && parts[1] === "checkouts"');
    expect(server).toContain("function deleteWorktree(name: string)");
    expect(server).toContain("function deleteFlowTraceData(flowId: string)");
    expect(server).toContain("function stopFlowRuntimesForDelete(flowId: string)");
    expect(server).toContain("deleteLogsByFlowIdStmt.run(flowId);");
    expect(server).toContain("deleteShellOutputStateByFlowIdStmt.run(flowId);");
    expect(server).toContain("deleteSettingByKeyStmt.run(codexThreadSettingKey(flowId));");
    expect(server).toContain("deleteFlowByIdStmt.run(flowId);");
    expect(server).toContain('broadcast("flows", listClientFlows());');
    expect(server).toContain("return json({ ok: true, ...result, flows: listClientFlows(), checkouts: listWorktrees() });");
    expect(server).toContain("rmSync(target, { recursive: true, force: true });");
  });

  test("backs off noisy Linear connectivity failures", () => {
    expect(server).toContain("class LinearUnavailableError extends Error");
    expect(server).toContain("const linearUnavailableBackoffMs = 30_000;");
    expect(server).toContain("const linearRequestTimeoutMs = 500_000;");
    expect(server).toContain("signal: AbortSignal.timeout(linearRequestTimeoutMs),");
    expect(server).toContain("function isLinearNetworkError(error: unknown)");
    expect(server).toContain("FailedToOpenSocket|ConnectionRefused|Unable to connect");
    expect(server).toContain("function throwIfLinearUnavailable()");
    expect(server).toContain("markLinearUnavailable();");
    expect(server).toContain('throw new LinearUnavailableError("Linear is unreachable. Check your network connection.");');
    expect(server).toContain("function logLinearUnavailable(error: unknown)");
    expect(server).toContain("if (error instanceof LinearUnavailableError) {\n        logLinearUnavailable(error);");
    expect(server).toContain("{ status: error instanceof LinearUnavailableError ? error.status : 500 }");
  });

  test("keeps refresh buttons visually quiet", () => {
    expect(html).toContain('id="refreshLinearTickets"');
    expect(html).toContain('id="createLinearTicket"');
    expect(html).toContain('id="resetAgentDeveloperInstructions"');
    expect(css).toContain(".ticket-drawer-actions {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  margin-left: auto;\n  margin-right: -5px;\n}");
    expect(css).toContain(".ticket-drawer-header #refreshLinearTickets,\n.ticket-drawer-header #createLinearTicket {\n  width: 28px;\n  min-width: 28px;\n  min-height: 28px;\n  flex: 0 0 28px;\n}");
    expect(css).toContain("#refreshLinearTickets,\n#createLinearTicket,\n#resetAgentDeveloperInstructions {\n  border-color: transparent;\n  background: transparent;\n}");
    expect(css).toContain("#refreshLinearTickets,\n#createLinearTicket {\n  color: var(--muted);\n}");
    expect(css).toContain("#refreshLinearTickets:hover,\n#createLinearTicket:hover,\n#resetAgentDeveloperInstructions:hover");
  });

  test("refreshes cached Linear descriptions and comments from the ticket refresh button", () => {
    expect(app).toContain("async function loadLinearTickets(options = {})");
    expect(app).toContain("if (options.refreshDetails) state.linearDetails.clear();");
    expect(app).toContain(
      'els.refreshLinearTickets.addEventListener("click", () => void loadLinearTickets({ refreshDetails: true }));',
    );
    expect(app).toContain('const data = await api(`/api/linear/issues/${encodeURIComponent(identifier)}`);');
    expect(server).toContain("comments(first: 50)");
    expect(server).toContain("description");
  });

  test("creates new pinned In Eng Linear tickets from the ticket drawer", () => {
    expect(html.indexOf('id="refreshLinearTickets"')).toBeLessThan(html.indexOf('id="createLinearTicket"'));
    expect(app).toContain("createLinearTicket: document.querySelector(\"#createLinearTicket\"),");
    expect(app).toContain("async function createPinnedLinearTicket()");
    expect(app).toContain('const data = await api("/api/linear/issues", { method: "POST" });');
    expect(app).toContain("state.pinnedLinearIssues.add(issue.identifier);");
    expect(app).toContain("state.linearDetails.set(issue.identifier, { loading: false, issue });");
    expect(app).toContain("function focusLinearTicketCard(identifier)");
    expect(app).toContain('const card = [...els.ticketGrid.querySelectorAll(".ticket-card")].find((item) => item.dataset.issue === identifier);');
    expect(app).toContain('card?.focus({ preventScroll: true });');
    expect(app).toContain('card?.scrollIntoView({ block: "nearest" });');
    expect(app).toContain("focusLinearTicketCard(issue.identifier);");
    expect(app).toContain('els.createLinearTicket.addEventListener("click", () => void createPinnedLinearTicket());');
    expect(server).toContain("async function createBlankInEngLinearIssue()");
    expect(server).toContain('linearWorkflowKey(state.name) === "in-eng"');
    expect(server).toContain("issueCreate(input: $input)");
    expect(server).toContain('url.pathname === "/api/linear/issues" && request.method === "POST"');
  });

  test("renders Linear comments oldest to newest", () => {
    expect(app).toContain("const comments = [...(issue.comments?.nodes || [])].sort(");
    expect(app).toContain("new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()");
  });

  test("uses higher contrast border tokens for subtle element outlines", () => {
    expect(css).toContain("--line: #c4ccd7;");
    expect(css).toContain("--line-strong: #9aa6b7;");
    expect(css).toContain("--line: #3d4754;");
    expect(css).toContain("--line-strong: #5a6675;");
    expect(css).toContain(".linear-markdown code,\n.terminal-entry-body code {\n  border: 1px solid var(--line);");
    expect(css).toContain(".linear-markdown .markdown-code-block,\n.terminal-entry-body .markdown-code-block {\n  margin: 6px 0;\n  border: 1px solid var(--line);");
    expect(css).not.toContain("border: 1px solid #d7dce3;");
    expect(css).not.toContain("border-color: #343c47;");
  });

  test("hides scrollbar UI globally", () => {
    expect(css).toContain("scrollbar-width: none;");
    expect(css).toContain("*::-webkit-scrollbar");
    expect(css).toContain("display: none;");
    expect(css).not.toContain("scrollbar-color");
  });

  test("prevents horizontal scrolling in Linear panes", () => {
    expect(css).toContain(".ticket-grid {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  overflow-x: hidden;\n  overflow-y: auto;");
    expect(css).toContain(".linear-detail {\n  display: grid;\n  align-content: start;\n  gap: 12px;\n  padding: 14px;\n  overflow-x: hidden;\n  overflow-y: auto;");
  });

  test("prevents horizontal scrolling in the Settings pane", () => {
    expect(css).toContain(".settings-content {\n  display: grid;\n  align-content: start;\n  box-sizing: border-box;\n  gap: 18px;\n  min-height: 0;\n  min-width: 0;\n  width: 100%;\n  max-width: 100%;\n  overflow-x: hidden;\n  overflow-y: auto;\n  overscroll-behavior-x: none;");
    expect(css).toContain(".sidebar button,\n.sidebar input,\n.sidebar .pill,\n.sidebar textarea {\n  box-sizing: border-box;\n  min-width: 0;\n  max-width: 100%;");
    expect(css).toContain(".settings-section-toggle > span:first-child {\n  min-width: 0;\n  overflow-wrap: anywhere;");
    expect(app).toContain("function resetSettingsHorizontalScroll()");
    expect(app).toContain('els.settingsContent.addEventListener("scroll", resetSettingsHorizontalScroll);');
    expect(app).toContain('els.settingsPane.addEventListener(\n  "wheel"');
    expect(app).toContain('if (state.settingsCollapsed || event.target.closest(".settings-content")) return;');
    expect(app).toContain("els.settingsContent.scrollTop += event.deltaY;");
    expect(app).toContain("{ passive: false }");
  });

  test("avoids layout animations when opening and closing Settings", () => {
    expect(css).not.toContain("transition: grid-template-columns");
    expect(css).not.toContain("grid-template-rows 180ms ease");
    expect(css).not.toContain("padding 180ms ease");
    expect(css).toContain("@property --settings-pane-size {\n  syntax: \"<length>\";");
    expect(css).toContain("--settings-pane-size var(--motion-pane)");
    expect(css).toContain(".sidebar {\n  position: relative;\n  box-sizing: border-box;");
    expect(css).toContain("contain: layout style;");
    expect(css).toContain("contain: layout paint style;");
  });

  test("uses a vertical split flow pane instead of tabs", () => {
    expect(html).not.toContain("flow-titlebar");
    expect(html).not.toContain("window-toolbar");
    expect(html).not.toContain('class="tabs browser-tabs"');
    expect(html).not.toContain('class="tab-panel');
    expect(html).not.toContain('data-tab=');
    expect(html.indexOf('class="linear-panel"')).toBeLessThan(html.indexOf('class="flow-resizer"'));
    expect(html.indexOf('class="flow-resizer"')).toBeLessThan(html.indexOf('class="agent-panel terminal-panel"'));
  });

  test("keeps the Linear and Agent panes flush to the workspace", () => {
    expect(css).toContain(
      ".workspace {\n  min-width: 0;\n  overflow: hidden;\n  border-top: 1px solid var(--line);\n  background: var(--bg);\n  padding: 0;\n}",
    );
    expect(css).toContain(".flow-pane {\n  height: 100%;");
    expect(css).toContain("border-radius: 0;");
    expect(css).toContain("border-top: 0;");
    expect(css).toContain("border-bottom: 0;");
    expect(css).toContain("box-shadow: none;");
  });

  test("keeps controls scoped to their panes", () => {
    expect(html).toContain('class="linear-panel"');
    expect(html).not.toContain("sync-linear");
    expect(html).not.toContain("Codex app-server command");
    expect(html).not.toContain('id="agentCommand"');
    expect(html).toContain('class="agent-panel terminal-panel"');
    expect(html).not.toContain('class="wf-stage"');
    expect(html).not.toContain('class="wf-agent"');
    expect(html).not.toContain('class="agent-actions"');
    expect(html).not.toContain('class="diff-panel"');
    expect(html).not.toContain('class="refresh-diff"');
    expect(html).not.toContain('class="diff-summary"');
  });

  test("keeps input panes editable and blocks submission at submit time", () => {
    expect(html).toContain('<div class="agent-disabled-message">Configure the repo URL to use the agent.</div>');
    expect(app).toContain("function repoUrlConfigured()");
    expect(app).toContain("const agentEnabled = repoUrlConfigured();");
    expect(app).toContain('agentPanel.classList.toggle("disabled", !agentEnabled);');
    expect(app).toContain("function canSubmitPromptMessage()");
    expect(app).toContain("function canSubmitShellCommand()");
    expect(app).toContain("function flashBlockedInput(input)");
    expect(app).toContain("messageInput.disabled = false;");
    expect(app).toContain("commandInput.disabled = false;");
    expect(app).toContain('messageForm.setAttribute("aria-disabled", "false");');
    expect(app).toContain("renderFlowPane();\n});");
    expect(css).toContain(".agent-disabled-message");
    expect(css).toContain(".agent-panel.disabled .agent-disabled-message {\n  display: grid;");
    expect(css).toContain(
      ".agent-panel.disabled .terminal,\n.agent-panel.disabled .shell-output-resizer,\n.agent-panel.disabled .shell-output-pane,\n.agent-panel.disabled .message-form {\n  display: none;",
    );
    expect(css).toContain(".message-input.input-submit-blocked");
    expect(css).toContain("@keyframes input-submit-blocked");
    expect(css).not.toContain(".message-form.input-disabled .message-input");
  });

  test("uses planning as the first flow stage everywhere except migration", () => {
    expect(server).toContain('type Stage = "planning" | "working" | "reviewing" | "done";');
    expect(server).toContain('const stages: Stage[] = ["planning", "working", "reviewing", "done"];');
    expect(server).toContain('tryMigration("update flows set stage = \'planning\' where stage = \'not_started\'");');
    expect(server).not.toContain('stage: message && flow.stage === "planning" ? "working" : flow.stage');
    expect(server).toContain('"planning",');
    expect(server.replace("where stage = 'not_started'", "")).not.toContain("not_started");
    expect(app).not.toContain("not_started");
    expect(app).not.toContain("Not Started");
    expect(app).not.toContain("not started");
  });

  test("uses the Linear ticket id as the default flow branch name", () => {
    expect(server).toContain('let branch = `turbo/${safeSlug(issueId)}`;');
    expect(server).not.toContain('const branch = `flow/${safeSlug(issueId)}`;');
    expect(server).not.toContain('const branch = `flow/${safeSlug(issueId)}-${flowId.slice(0, 8)}`;');
  });

  test("uses git worktrees instead of copied checkouts for flow workspaces", () => {
    expect(server).toContain('const worktreeDir = join(dataDir, "worktrees");');
    expect(server).not.toContain("const checkoutDir = worktreeDir;");
    expect(server).not.toContain('join(dataDir, "checkouts")');
    expect(server).not.toContain('join(dataDir, "threadtrees")');
    expect(server).not.toContain("function checkoutRoots()");
    expect(server).toContain("const warmedRepoPullIntervalMs = 60000;");
    expect(server).toContain("let warmedRepoPulling = false;");
    expect(server).toContain("function pullWarmedRepo()");
    expect(server).toContain("if (warmedRepoPulling) return;");
    expect(server).toContain('runGit(["pull", "--ff-only"], repoCheckoutDir);');
    expect(server).toContain("setInterval(pullWarmedRepo, warmedRepoPullIntervalMs);");
    expect(server).not.toContain("type TimingEntry = {");
    expect(server).not.toContain("function timeStep");
    expect(server).not.toContain("function insertTimingLogs");
    expect(server).toContain("function createWorktree(flowId: string, issueId: string)");
    expect(server).toContain('const repoCheckoutDir = join(dataDir, "repo");');
    expect(server).toContain("function ensureRepoCheckout(repoUrl: string)");
    expect(server).toContain('runGit(["clone", repoUrl, repoCheckoutDir])');
    expect(server).toContain('runGit(["remote", "get-url", "origin"], repoCheckoutDir)');
    expect(server).toContain("rmSync(repoCheckoutDir, { recursive: true, force: true })");
    expect(server).toContain('runGit(["worktree", "prune"], repoCheckoutDir)');
    expect(server).toContain("ensureRepoCheckout(repoUrl)");
    expect(server).toContain('runGit(["rev-parse", "HEAD"], repoCheckoutDir)');
    expect(server).toContain('runGit(["worktree", "add", "-b", branch, target, baseSha], repoCheckoutDir)');
    expect(server).toContain('branch = `${branch}-${flowId.slice(0, 8)}`;');
    expect(server).toContain('runGit(["worktree", "remove", "--force", target], repoCheckoutDir);');
    expect(server).toContain('insertLog(id, "flow", `Created worktree ${branch}\\n`);');
    expect(server).not.toContain("flow:timing");
    expect(server).toContain("const linearIssueCache = new Map<string, LinearIssue>();");
    expect(server).toContain("function cachedLinearIssue(identifier: string)");
    expect(app).toContain("issue: ticket.identifier,");
    expect(app).toContain("url: ticket.url,");
    expect(app).toContain("linearStatus: linearStatusName(ticket),");
    expect(server).toContain("const linearIssue = cachedLinearIssue(parsed.identifier);");
    expect(server).toContain("const { target, branch, baseSha } = createWorktree(id, parsed.identifier);");
    expect(server).not.toContain("cpSync(");
    expect(server).not.toContain('runGit(["clone", repoUrl, target]);');
    expect(server).not.toContain('runGit(["checkout", "-b", branch], target);');
  });

  test("allocates missing worktrees lazily for prompts and shell commands", () => {
    expect(server).toContain("function flowHasWorktree(flow: Flow)");
    expect(server).toContain("function ensureFlowWorktree(flow: Flow)");
    expect(server).toContain("flow = ensureFlowWorktree(flow);");
    const startAgentBody = server.slice(server.indexOf("async function startAgent("), server.indexOf("function startShellCommand("));
    expect(startAgentBody).toContain("flow = ensureFlowWorktree(flow);");
    const shellBody = server.slice(server.indexOf("function startShellCommand("), server.indexOf("function interruptShellCommand"));
    expect(shellBody).toContain("flow = ensureFlowWorktree(flow);");
    expect(server).toContain("updateFlow(flow.id, { checkoutPath: target, branchName: branch, baseSha });");
    expect(server).toContain('throw new Error(`Worktree does not exist: ${flow.checkoutPath}`);');
    expect(server).not.toContain("repaired worktree path");
  });

  test("shows visible error toasts for git clone failures", () => {
    expect(html).toContain('id="toastStack"');
    expect(css).toContain(".toast-stack");
    expect(css).toContain(".toast-error");
    expect(app).toContain("function toast(message, options = {})");
    expect(app).toContain("function isGitCloneError(error)");
    expect(app).toContain('toast(error.message, { kind: "error" });');
    expect(server).toContain("function gitCommandLabel(args: string[])");
    expect(server).toContain('`${gitCommandLabel(args)} failed: ${output}`');
  });

  test("trusts flow worktrees before starting the Codex app server", () => {
    expect(server).toContain("function ensureCodexProjectTrusted(projectPath: string)");
    expect(server).toContain('const codexHome = codexEnv.CODEX_HOME || process.env.CODEX_HOME || join(homedir(), ".codex");');
    expect(server).toContain('const header = `[projects.${tomlBasicString(resolve(projectPath))}]`;');
    expect(server).toContain('appendFileSync(configPath, `${prefix}\\n${header}\\ntrust_level = "trusted"\\n`, "utf8");');
    expect(server).toContain('Bun.spawn(["/bin/zsh", "-lc", command], {');
    expect(server).toContain("function assertFlowWorktree(flow: Flow)");
    expect(server).toContain("const activeFlow = assertFlowWorktree(flow);");
    expect(server).toContain("ensureCodexProjectTrusted(activeFlow.checkoutPath);");
    const codexStartup = server.slice(server.indexOf("async function startCodexAppServer"));
    expect(codexStartup.indexOf("ensureCodexProjectTrusted(activeFlow.checkoutPath);")).toBeLessThan(
      codexStartup.indexOf('Bun.spawn(["/bin/zsh", "-lc", command], {'),
    );
    expect(codexStartup).toContain("env,");
  });

  test("does not render the Linear status inside the Linear pane detail", () => {
    expect(app).not.toContain('class="linear-state"');
    expect(app).not.toContain("context.linearStatus");
    expect(css).not.toContain(".linear-state");
  });

  test("renders Linear pane priority as the same bar icon used in tickets", () => {
    expect(app).toContain("const priorityMeta = renderLinearPriorityIcon(issue.priority);");
    expect(app).toContain('${priorityMeta ? `<span class="linear-meta-priority">${priorityMeta}</span>` : ""}');
    expect(app).not.toContain('issue.priority ? `P${issue.priority}` : ""');
    expect(css).toContain(".linear-meta .linear-meta-priority {\n  display: inline-grid;");
    expect(css).toContain("min-width: 13px;\n  border: 0;\n  background: transparent;\n  padding: 0;");
    expect(css).toContain(".linear-meta > span,\n.linear-comments > header span");
    expect(css).not.toContain(".linear-meta span,\n.linear-comments > header span");
  });

  test("does not render the Linear team key as a redundant metadata pill", () => {
    expect(app).not.toContain("issue.team?.key || issue.team?.name");
  });

  test("labels user agent messages with the Linear viewer name", () => {
    expect(app).toContain('linearViewerName: "",');
    expect(app).toContain('state.linearViewerName = linear.viewerName || state.linearViewer?.name || "";');
    expect(app).toContain("state.linearViewerName = data.viewer?.name || state.linearViewerName;");
    expect(app).toContain('const userLabel = state.linearViewer?.name || state.linearViewerName || "user";');
    expect(app).toContain('user: { label: userLabel, marker: ">", tone: "user" }');
    expect(app).not.toContain('user: { label: "user", marker: ">", tone: "user" }');
  });

  test("lets ticket selection animate without rebuilding unchanged cards", () => {
    expect(app).toContain("dataset.ticketSignature");
    expect(app).toContain('card.classList.toggle("active", card.dataset.issue === state.selectedLinearIssueId)');
    expect(css).toContain(".ticket-card::before");
    expect(css).toContain(".ticket-card:hover");
    expect(css).toContain("transform var(--motion-fast)");
    expect(css).toContain("background-color var(--motion-fast)");
  });

  test("shows ticket id on cards and Linear status at the end of the Flow pane metadata row", () => {
    expect(app).toContain('class="ticket-meta"');
    expect(app).toContain('class="ticket-id"');
    expect(app).toContain('<span class="ticket-id">${escapeHtml(ticket.identifier)}</span>');
    expect(app).toContain("const statusName = issue.state?.name || context.ticket?.state?.name || \"\";");
    expect(app).toContain(
      '${labels.map((label) => `<span>${escapeHtml(label.name)}</span>`).join("")}\n        ${statusName ? `<span class="linear-status-pill">${escapeHtml(statusName)}</span>` : ""}',
    );
    expect(css).not.toContain(".ticket-status {");
    expect(app).not.toContain("ticket-linear-status");
    expect(css).not.toContain("ticket-linear-status");
    expect(css).not.toContain(".linear-status-pill {\n  display: inline-flex;");
    expect(css).toContain(".ticket-id {\n  position: absolute;");
    expect(css).toContain("top: 8px;");
    expect(css).toContain("right: 10px;");
  });

  test("shows Linear ticket priority icon before the project at the bottom left", () => {
    expect(app).toContain("function renderLinearPriorityIcon(priority)");
    expect(app).toContain("function linearPriorityBarCount(priority)");
    expect(app).toContain("if (value === 1) return 3;");
    expect(app).toContain("if (value === 2) return 3;");
    expect(app).toContain("const urgent = Number(priority) === 1;");
    expect(app).toContain('<span class="ticket-priority${urgent ? " urgent" : ""}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}">');
    expect(app).toContain('<svg viewBox="0 0 16 14" aria-hidden="true" focusable="false">');
    expect(app).toContain("${renderLinearPriorityIcon(ticket.priority)}");
    expect(app).not.toContain('const priorityName = ticket.priority ? `P${ticket.priority}` : "";');
    expect(app).not.toContain('<span class="ticket-priority">${escapeHtml(priorityName)}</span>');
    expect(app.indexOf('class="ticket-priority"')).toBeLessThan(app.indexOf('class="ticket-project"'));
    expect(css).toContain(".ticket-meta {\n  display: flex;");
    expect(css).toContain("justify-content: flex-start;");
    expect(css).toContain(".ticket-priority {\n  display: inline-grid;");
    expect(css).toContain(".ticket-priority.urgent {\n  color: var(--danger);\n}");
    expect(css).toContain(".ticket-priority svg");
  });

  test("supports client-side pinned Linear tickets at the top of the drawer", () => {
    expect(app).toContain('const PINNED_LINEAR_ISSUES_KEY = "flow.pinnedLinearIssues";');
    expect(app).toContain("function initialPinnedLinearIssues()");
    expect(app).toContain("pinnedLinearIssues: initialPinnedLinearIssues(),");
    expect(app).toContain("const pinnedTickets = tickets.filter((ticket) => isLinearIssuePinned(ticket.identifier));");
    expect(app).toContain("const nodes = [renderPinnedTicketGroup(pinnedTickets)];");
    expect(app).toContain('section.className = "ticket-status-group pinned-ticket-group";');
    expect(app).toContain("section.addEventListener(\"drop\", handlePinnedTicketDrop);");
    expect(app).toContain("function setLinearIssuePinned(identifier, pinned)");
    expect(app).toContain("function ticketCanMoveToPinned(issueId)");
    expect(app).toContain("if (isLinearIssuePinned(issueId)) {");
    expect(app).not.toContain('class="ticket-pin"');
    expect(css).toContain(".pinned-ticket-separator");
    expect(css).toContain(".pinned-ticket-group .ticket-status-group-items");
    expect(css).toContain(".ticket-card.pinned");
    expect(css).not.toContain(".ticket-pin {");
  });

  test("marks tickets with flows using the favicon instead of a green card tint", () => {
    expect(app).toContain('class="ticket-flow-mark"');
    expect(app).toContain('class="ticket-flow-corner"');
    expect(app).toContain('<div class="ticket-flow-corner"><img class="ticket-flow-mark" src="/favicon.svg" alt="In flow" title="In flow"></div>');
    expect(app).not.toContain("ticket-stage");
    expect(css).toContain(".ticket-flow-mark");
    expect(css).toContain(".ticket-flow-corner");
    expect(css).not.toContain(".ticket-stage");
    expect(css).not.toContain(".ticket-card.in-flow {\n  border-color:");
    expect(css).not.toContain(".ticket-card.in-flow:hover");
  });

  test("grows the ticket favicon smoothly while the agent is in a turn", () => {
    expect(app).toContain("function ticketAgentWorking(ticket)");
    expect(app).toContain("flowRuntimeActive(flow)");
    expect(app).toContain('card.classList.toggle("agent-turn-active", ticketAgentWorking(ticket));');
    expect(app).toContain("function updateTicketCardState(card)");
    expect(app).toContain("renderTickets();\n    renderFlowPane();");
    expect(css).toContain("width 180ms ease");
    expect(css).toContain("height 180ms ease");
    expect(css).toContain(".ticket-card.agent-turn-active .ticket-flow-mark");
    expect(css).toContain("width: 25.2px;");
    expect(css).toContain("height: 25.2px;");
  });

  test("shows last updated copy instead of assigned ticket count", () => {
    expect(app).toContain("formatLastUpdated");
    expect(app).toContain("last updated:");
    expect(app).not.toContain("tickets assigned to");
  });

  test("keeps Linear attachment comments compact", () => {
    expect(css).toContain(".linear-markdown:has(.linear-image)");
    expect(css).toContain("white-space: normal;");
    expect(css).toContain("width: fit-content;");
    expect(css).toContain("width: max-content;");
    expect(css).toContain(".linear-image a");
    expect(css).toContain("display: contents;");
    expect(css).toContain("max-width: min(100%, 760px);");
    expect(css).toContain(".linear-comment header");
    expect(css).toContain("justify-content: flex-start;");
    expect(css).toContain("align-items: baseline;");
    expect(css).not.toContain(".linear-comment {\n  display: grid;\n  justify-items: start;\n  gap: 7px;\n  border-top:");
  });

  test("opens Markdown images in an in-app preview modal", () => {
    expect(html).toContain('class="image-preview-backdrop" id="imagePreviewModal" hidden');
    expect(html).toContain('class="image-preview-modal" role="dialog" aria-modal="true" aria-labelledby="imagePreviewTitle"');
    expect(html).not.toContain("image-preview-close");
    expect(markdown).toContain("data-image-preview");
    expect(markdown).not.toContain('target="_blank" rel="noreferrer"><img src="${escapeAttribute(imageSrc)}"');
    expect(app).toContain("imagePreviewModal: document.querySelector");
    expect(app).toContain("function openImagePreview(src, alt = \"\")");
    expect(app).toContain('const link = event.target.closest?.("a[data-image-preview]");');
    expect(app).toContain('els.flowPane.addEventListener("click", handleImagePreviewClick);');
    expect(app).not.toContain(".image-preview-close");
    expect(app).toContain('if (event.key === "Escape" && els.imagePreviewModal && !els.imagePreviewModal.hidden)');
    expect(css).toContain(".image-preview-backdrop");
    expect(css).toContain(".image-preview-backdrop.is-open");
    expect(css).toContain("padding: 8px 14px;");
    expect(css).toContain(".image-preview-frame img");
    expect(css).toContain("cursor: zoom-in;");
  });

  test("renders Markdown headings, inline formatting, and code blocks in Linear and Agent panes", () => {
    expect(app).toContain('import { renderInlineMarkdown, renderLinearMarkdown } from "./linear-markdown.js";');
    expect(app).toContain("function usesTerminalBlockMarkdown(source)");
    expect(app).toContain('["user", "user:queued", "agent", "agent:message", "agent:thinking", "agent:reasoning"].includes(source)');
    expect(app).toContain('document.createElement(usesTerminalBlockMarkdown(group.source) ? "div" : "pre")');
    expect(app).toContain("function usesTerminalMarkdownToggle(source)");
    expect(app).toContain('["agent", "agent:message"].includes(source)');
    expect(app).toContain("function renderTerminalMarkdownOutput(message, showToggle = false)");
    expect(app).toContain('class="terminal-markdown-toggle"');
    expect(app).toContain('aria-pressed="false" aria-label="Toggle raw markdown" title="Toggle raw markdown">Raw</button>');
    expect(app).toContain('return `${toggle}<div class="terminal-markdown-content" data-raw-markdown="${escapeAttribute(message)}">${renderLinearMarkdown');
    expect(app).toContain("renderTerminalMarkdownOutput(message, usesTerminalMarkdownToggle(group.source))");
    expect(app).toContain("function toggleTerminalMarkdownOutput(button)");
    expect(app).toContain('event.target.closest(".terminal-markdown-toggle")');
    expect(app).toContain("if (event.detail > 0) toggle.blur();");
    expect(app).toContain('button.setAttribute("aria-pressed", String(showingRaw));');
    expect(app).toContain('button.textContent = "Raw";');
    expect(app).not.toContain('button.textContent = showingRaw ? "Rendered" : "Raw";');
    expect(app).toContain("function highlightCodeBlocks(root)");
    expect(app).toContain("window.Prism?.highlightAllUnder?.(root);");
    expect(app).toContain('renderLinearMarkdown(message, "", { images: false, links: true, compactBlankLines: true })');
    expect(app).toContain('renderLinearMarkdown(raw, "", { images: false, links: true, compactBlankLines: true })');
    expect(app).not.toContain("body.textContent = formatTerminalMessage(group.source, group.message);");
    expect(html).toContain('<script src="/vendor/prismjs/prism.js" data-manual></script>');
    expect(html).toContain('<script src="/vendor/prismjs/components/prism-typescript.min.js"></script>');
    expect(server).toContain('path.startsWith("/vendor/prismjs/")');
    expect(packageJson.dependencies.prismjs).toBeDefined();
    expect(css).toContain(".linear-markdown h1,");
    expect(css).toContain("margin: 6px 0 2px;");
    expect(css).toContain(".linear-markdown a,\n.terminal-entry-body a");
    expect(css).toContain("color: #3b82f6;\n  font-weight: 700;\n  overflow-wrap: anywhere;\n  text-decoration: none;");
    expect(css).toContain("body.theme-dark .linear-markdown a,\nbody.theme-dark .terminal-entry-body a {\n  color: #93c5fd;\n}");
    expect(css).toContain(".linear-markdown table,\n.terminal-entry-body table {\n  display: block;");
    expect(css).toContain("  border: 1px solid var(--line);\n  border-collapse: separate;\n  border-spacing: 0;\n  border-radius: 4px;");
    expect(css).toContain(".terminal-entry-body table {\n  margin-bottom: 2px;\n}");
    expect(css).toContain(".terminal-entry-body table + br {\n  display: none;\n}");
    expect(css).toContain(".linear-markdown th,\n.linear-markdown td,\n.terminal-entry-body th,\n.terminal-entry-body td");
    expect(css).toContain("  min-width: 0;\n  border-right: 1px solid var(--line);\n  border-bottom: 1px solid var(--line);\n  padding: 4px 8px;");
    expect(css).toContain("body.theme-dark .linear-markdown th,\nbody.theme-dark .terminal-entry-body th");
    expect(css).toContain(".terminal-entry-body td {\n  font-size: 11px;\n}");
    expect(css).toContain(".linear-markdown ul,\n.linear-markdown ol {\n  margin: 4px 0 4px 18px;");
    expect(css).toContain(".terminal-entry-body ul,\n.terminal-entry-body ol {\n  margin: 4px 0;\n  padding-left: 3ch;");
    expect(css).toContain(".terminal-entry-body ul {\n  padding-left: 2ch;");
    expect(css).toContain(".terminal-entry-body li > ul,\n.terminal-entry-body li > ol {\n  margin: 2px 0;\n  padding-left: 4ch;");
    expect(css).toContain(".linear-markdown li,\n.terminal-entry-body li");
    expect(css).toContain(".linear-markdown code,\n.terminal-entry-body code");
    expect(css).toContain("body.theme-dark .linear-markdown .markdown-code-block code,\nbody.theme-dark .terminal-entry-body .markdown-code-block code");
    expect(css).toContain("background: transparent;");
    expect(css).toContain(".terminal-markdown-output {\n  position: relative;");
    expect(css).toContain(".terminal-markdown-content {\n  display: contents;");
    expect(css).toContain(".terminal-markdown-toggle {\n  position: absolute;");
    expect(css).toContain("  min-height: 18px;\n  padding: 0 6px;");
    expect(css).toContain(".terminal-markdown-output:hover .terminal-markdown-toggle");
    expect(css).toContain('.terminal-markdown-toggle[aria-pressed="true"] {\n  border-color: var(--accent);\n  background: rgba(59, 130, 246, 0.12);\n  color: var(--accent);\n}');
    expect(css).toContain(".terminal-raw-markdown {\n  margin: 0;");
    expect(css).toContain(".terminal-entry-body .markdown-blank-line {\n  display: block;\n  height: 4px;\n}");
    expect(css).toContain(".linear-markdown .token.keyword,");
    expect(css).toContain("body.theme-dark .linear-markdown .token.keyword,");
    expect(markdown).toContain("<strong>");
    expect(renderLinearMarkdown("```ts\nconst value = 1;\n```")).toContain('class="language-typescript"');
    expect(renderLinearMarkdown("[managedAgentFileLoader.ts](/Users/alex/project/file.ts:201)", "", { links: true })).toContain(
      '<a href="/Users/alex/project/file.ts:201" target="_blank" rel="noreferrer">managedAgentFileLoader.ts</a>',
    );
    expect(renderLinearMarkdown("[My File](</Users/alex/My Project/file.ts:201>)", "", { links: true })).toContain(
      '<a href="/Users/alex/My Project/file.ts:201" target="_blank" rel="noreferrer">My File</a>',
    );
    expect(css).toContain(".terminal-entry-body .markdown-code-block");
  });

  test("groups Linear tickets behind collapsible status separators", () => {
    expect(app).toContain("collapsedLinearStatuses");
    expect(app).toContain('DEFAULT_COLLAPSED_LINEAR_STATUSES = ["backlog", "canceled"]');
    expect(app).toContain('LINEAR_STATUS_ORDER = ["in-review", "in-eng", "triage", "ready-for-eng", "backlog", "canceled"]');
    expect(app).toContain("linearStatusRank");
    expect(app).toContain("groupedTicketsByLinearStatus");
    expect(app).toContain("renderTicketStatusGroup");
    expect(app).toContain("renderTicketStatusSeparator");
    expect(app).toContain('separator.setAttribute("aria-expanded"');
    expect(app).toContain("group.dataset.collapsed");
    expect(css).toContain(".ticket-status-separator");
    expect(css).toContain(".ticket-status-separator::after");
    expect(css).toContain(".ticket-status-group-body");
    expect(css).toContain("grid-template-rows var(--motion-fast)");
    expect(css).toContain('[data-collapsed="true"] .ticket-status-group-body');
  });

  test("sorts Linear tickets within each status by agent session and priority", () => {
    expect(app).toContain("function ticketHasAgentSession(ticket)");
    expect(app).toContain("function linearPrioritySortRank(priority)");
    expect(app).toContain("function compareLinearTickets(a, b)");
    expect(app).toContain("Number(ticketHasAgentSession(b)) - Number(ticketHasAgentSession(a))");
    expect(app).toContain("linearPrioritySortRank(a.priority) - linearPrioritySortRank(b.priority)");
    expect(app).toContain("return [...tickets].sort(compareLinearTickets);");
  });

  test("lets ticket cards move between Linear status groups with drag and drop", () => {
    expect(app).toContain("draggingLinearIssueId");
    expect(app).toContain("function linearStatusId(ticket)");
    expect(app).toContain("section.dataset.stateId = group.stateId;");
    expect(app).toContain("handleTicketStatusDrop");
    expect(app).toContain("async function moveTicketToLinearStatus(issueId, group)");
    expect(app).toContain('api(`/api/linear/issues/${encodeURIComponent(issueId)}/status`');
    expect(app).toContain("card.draggable = true;");
    expect(app).toContain('event.dataTransfer.setData("text/plain", ticket.identifier);');
    expect(css).toContain("user-select: none;");
    expect(css).toContain(".ticket-status-group.drag-over .ticket-status-separator");
    expect(server).toContain("async function updateLinearIssueStatus");
    expect(server).toContain("issueUpdate(id: $id, input: { stateId: $stateId })");
    expect(server).toContain('parts[4] === "status"');
    expect(server).toContain("state { id name color type }");
  });

  test("keeps ticket flow status synced when flows update", () => {
    expect(app).toContain("function setFlows(flows)");
    expect(app).toContain("const nextIds = new Set(nextFlows.map((flow) => flow.id));");
    expect(app).toContain("if (!nextIds.has(flow.id)) clearFlowClientState(flow.id);");
    expect(app).toContain('localStorage.removeItem("flow.selectedFlowId");');
    expect(app).toContain("function runtimeOnlyFlowChanges(previousFlows, nextFlows)");
    expect(app).toContain('const ignoredKeys = new Set(["agentStatus", "agentRuntimeKind", "updatedAt"]);');
    expect(app).toContain("if (runtimeOnlyFlowChanges(previousFlows, state.flows)) {\n        renderTickets();\n        const flow = selectedFlow();\n        if (flow) renderLogs(flow.id, { force: true });\n        return;\n      }");
    expect(app).toContain("function syncLinearTicketsWithFlows()");
    expect(app).toContain("function flowUpdatedAtMs(flow)");
    expect(app).toContain("if (index !== -1 && flowUpdatedAtMs(flow) < flowUpdatedAtMs(next[index])) return;");
    expect(app).toContain("const flowsByIssue = new Map");
    expect(app).toContain("return { ...ticket, flowId, flowStage };");
    expect(app).toContain("setFlows(message.payload);");
    expect(app).toContain("upsertFlow(data.flow);");
  });

  test("keeps the selected ticket attached to its flow while Linear tickets load", () => {
    expect(app).toContain("linearTicketsLoaded: false");
    expect(app).toContain("state.linearTicketsLoaded = true;");
    expect(app).toContain("function flowForLinearIssue(identifier)");
    expect(app).toContain("function flowForTicket(ticket)");
    expect(app).toContain("const flow = flowForTicket(ticket);");
    expect(app).toContain("flowForLinearIssue(state.selectedLinearIssueId)");
    expect(app).toContain("state.selectedFlowId = flow.id;");
    expect(app).toContain("!flow && !ticket && state.selectedLinearIssueId && state.linearTicketsLoaded");
    expect(app).toContain("renderTickets();\n    renderFlowPane();");
  });

  test("does not write flow status updates back to Linear comments", () => {
    expect(server).not.toContain("commentCreate");
    expect(server).not.toContain("Turbopump moved this flow");
    expect(server).not.toContain("commentLinearIssue");
  });

  test("shows context availability, model, reasoning effort, fast mode, and branch values on the right side of the Agent input", () => {
    expect(html).toContain('class="agent-context" aria-label="Current flow context" hidden');
    expect(html).toContain('class="agent-context-window"');
    expect(html).toContain('class="agent-context-model"');
    expect(html).toContain('class="agent-context-diff" type="button" hidden');
    expect(html).toContain('<a class="agent-context-branch"></a>');
    expect(html).toContain('class="diff-modal-backdrop" id="diffModal" hidden');
    expect(html).not.toContain('class="agent-context-phase"');
    expect(app).toContain("function agentModelLabel(flow)");
    expect(app).toContain("function agentContextWindowLabel(flow)");
    expect(app).toContain("function loadFlowDiff(flowId, options = {})");
    expect(app).toContain('const diffButton = context.querySelector(".agent-context-diff");');
    expect(app).toContain('diffButton.hidden = !flow || !diffHasChanges(diff);');
    expect(app).toContain('diffButton.onclick = flow ? () => openDiffViewer(flow.id) : null;');
    expect(app).toContain('if (flow?.id && !diff && !state.flowDiffLoadingIds.has(diffLoadingKey(flow.id))) void loadFlowDiff(flow.id);');
    expect(app).toContain('await api(`/api/flows/${encodeURIComponent(flowId)}/diff${options.patch ? "?patch=1" : ""}`)');
    expect(app).toContain("function diffLoadingKey(flowId, options = {})");
    expect(app).toContain('state.diffModalDiff = flowId && state.flowDiffs.get(flowId) ? { ...state.flowDiffs.get(flowId) } : null;');
    expect(app).toContain('if (flowId) void loadFlowDiff(flowId, { patch: true, modal: true });');
    expect(app).toContain("const diff = state.diffModalDiff;");
    expect(app).toContain("const loading = state.diffModalLoadingFlowId === flowId && !diff?.patch;");
    expect(app).toContain("if (Number.isFinite(diff?.count) && diff.count > 0) return diff.count;");
    expect(app).toContain("additions: Number(data?.additions || 0)");
    expect(app).toContain("deletions: Number(data?.deletions || 0)");
    expect(app).toContain("files: Array.isArray(data?.files) ? data.files : []");
    expect(app).toContain('return `<span class="diff-additions">+${additions}</span><span class="diff-deletions">-${deletions}</span>`;');
    expect(app).toContain("diffButton.innerHTML = diffIndicatorLabel(diff);");
    expect(app).toContain("function diffCountLabel(value, prefix)");
    expect(app).toContain("function showDiffModal()");
    expect(app).toContain("function hideDiffModal()");
    expect(app).toContain("function renderDiffCode(code, text)");
    expect(app).toContain("function diffLineClass(line)");
    expect(app).toContain("function shouldHideDiffLine(line)");
    expect(app).toContain("function diffFilePathFromHeader(line)");
    expect(app).toContain("function diffHunkLineState(line)");
    expect(app).toContain("function appendDiffLine(fragment, line, lineState)");
    expect(app).toContain("function renderDiffSummary(summary, diff, loading)");
    expect(app).toContain('row.className = "diff-summary-file";');
    expect(app).toContain('path.className = "diff-summary-path";');
    expect(app).toContain('counts.className = "diff-summary-counts";');
    expect(app).toContain("row.append(counts, path);");
    expect(app).toContain('const lines = String(text).split("\\n");');
    expect(app).toContain('divider.className = `diff-file-divider${fileDividerCount ? "" : " is-first"}`;');
    expect(app).toContain('row.className = "diff-code-line";');
    expect(app).toContain('oldNumber.className = "diff-line-number";');
    expect(app).toContain('newNumber.className = "diff-line-number";');
    expect(app).toContain('text.className = `diff-line-text${className ? ` ${className}` : ""}`;');
    expect(app).toContain("lineState.oldLine += 1;");
    expect(app).toContain("lineState.newLine += 1;");
    expect(app).toContain('els.diffModal.querySelector(".diff-modal")?.setAttribute("aria-label", `${flow?.linearIssueId || "Flow"} diff`);');
    expect(app).toContain("function renderDiffModal()");
    expect(app).toContain('return "--";');
    expect(app).toContain("return `${Math.round((available / total) * 100)}%`;");
    expect(app).not.toContain("ctx ");
    expect(app).toContain("flow.agentReasoningEffort || \"\"");
    expect(app).toContain('flow.agentServiceTier === "fast" ? "fast" : ""');
    expect(app).toContain("function renderAgentContext(flow)");
    expect(app).toContain('context.querySelector(".agent-context-window").textContent = agentContextWindowLabel(flow);');
    expect(app).toContain('context.querySelector(".agent-context-model").textContent = agentModelLabel(flow);');
    expect(app).toContain('const branch = context.querySelector(".agent-context-branch");');
    expect(app).toContain('branch.textContent = flow?.branchName || "";');
    expect(app).toContain("if (flow?.prUrl) {");
    expect(app).toContain("branch.href = flow.prUrl;");
    expect(app).toContain('branch.removeAttribute("href");');
    expect(app).not.toContain('context.querySelector(".agent-context-phase")');
    expect(app).not.toContain("const stageName = ticket.flowStage ? escapeHtml(ticket.flowStage) : \"\";");
    expect(app).not.toContain("titleCase");
    expect(app).toContain("renderAgentContext(flow);");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) var(--shell-resizer-size) var(--shell-pane-size, 28%);");
    expect(css).toContain("padding: 4px 0;");
    expect(css).not.toContain(".agent-context-window::before");
    expect(css).not.toContain('content: "context ";');
    expect(css).not.toContain(".agent-context-model::before");
    expect(css).not.toContain('content: "model ";');
    expect(css).not.toContain(".agent-context-branch::before");
    expect(css).not.toContain('content: "branch ";');
    expect(css).toContain("padding-block: 2px;");
    expect(css).toContain(".agent-context-diff {\n  display: inline-flex;");
    expect(css).toContain("min-height: 0;\n  height: 1.2em;");
    expect(css).toContain(".agent-context-diff:hover,\n.agent-context-diff:focus-visible {\n  text-decoration: none;\n}");
    expect(css).toContain("body.theme-dark .agent-context-diff,\nbody.theme-dark .agent-context-diff:hover");
    expect(css).toContain(".agent-context-diff .diff-additions");
    expect(css).toContain(".agent-context-diff .diff-deletions");
    expect(css).toContain(".diff-modal-backdrop");
    expect(css).toContain(".diff-modal-backdrop.is-open");
    expect(css).toContain(".diff-summary-file");
    expect(css).toContain(".diff-summary-path");
    expect(css).toContain(".diff-summary-counts");
    expect(css).toContain(".diff-modal-summary .diff-additions");
    expect(css).toContain(".diff-modal-summary .diff-deletions");
    expect(css).toContain(".diff-modal-code");
    expect(css).toContain(".diff-modal-code code");
    expect(css).toContain(".diff-modal-close");
    expect(css).toContain(".diff-modal-code .diff-code-line");
    expect(css).toContain(".diff-modal-code .diff-line-number");
    expect(css).toContain(".diff-modal-code .diff-line-text");
    expect(css).toContain(".diff-modal-code .diff-file-divider");
    expect(css).toContain("position: sticky;\n  top: -14px;");
    expect(css).toContain(".diff-modal-code .diff-file-divider.is-first");
    expect(css).toContain(".diff-modal-code .diff-line-inserted");
    expect(css).toContain(".diff-modal-code .diff-line-deleted");
    expect(css).toContain("body.theme-dark .diff-modal-code .diff-line-inserted");
    expect(css).toContain("overscroll-behavior: contain;");
    expect(css).toContain("white-space: pre-wrap;\n  overflow-wrap: anywhere;");
    expect(css).toContain("min-width: 0;\n  white-space: inherit;");
    expect(css).not.toContain(".agent-context-phase");
    expect(css).not.toContain('content: "phase ";');
    expect(css).toContain("--link: #2563eb;");
    expect(css).toContain("--link: #60a5fa;");
    expect(css).toContain(".agent-context a[href] {\n  color: var(--link);\n}");
    expect(css).not.toContain(".agent-context a[href]:hover");
    expect(css).toContain("border-left: 1px solid var(--line-strong);");
    expect(server).toContain('if (parts[3] === "diff" && request.method === "GET")');
    expect(server).toContain('await getDiff(flow, { patch: url.searchParams.get("patch") === "1" })');
    expect(server).toContain('run(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])');
    expect(server).toContain('"origin/main"');
    expect(server).toContain('run(["merge-base", "HEAD", candidate])');
    expect(server).toContain('run(["diff", "--name-only", "-z", baseRef]');
    expect(server).toContain('run(["diff", "--numstat", baseRef]');
    expect(server).toContain("const files: DiffFile[] = [];");
    expect(server).toContain("files.push({");
    expect(server).toContain("additions += addedCount;");
    expect(server).toContain("deletions += deletedCount;");
    expect(server).toContain('count: names.split("\\0").filter(Boolean).length');
    expect(server).toContain('run(["diff", "--find-renames", "--stat", "--patch", baseRef]');
    expect(server).toContain("if (!options.patch) return { ...diff, stat: \"\", patch: \"\" };");
    expect(server).toContain("agentModel text not null default ''");
    expect(server).toContain("agentReasoningEffort text not null default ''");
    expect(server).toContain("agentServiceTier text not null default ''");
    expect(server).toContain("agentContextTokensUsed integer not null default 0");
    expect(server).toContain("agentContextWindow integer not null default 0");
    expect(server).toContain("prUrl text not null default ''");
    expect(server).toContain("tryMigration(\"alter table flows add column agentModel text not null default ''\");");
    expect(server).toContain("tryMigration(\"alter table flows add column agentReasoningEffort text not null default ''\");");
    expect(server).toContain("tryMigration(\"alter table flows add column agentServiceTier text not null default ''\");");
    expect(server).toContain("tryMigration(\"alter table flows add column agentContextTokensUsed integer not null default 0\");");
    expect(server).toContain("tryMigration(\"alter table flows add column agentContextWindow integer not null default 0\");");
    expect(server).toContain("tryMigration(\"alter table flows add column prUrl text not null default ''\");");
    expect(server).toContain("tryMigration(\"update flows set agentContextTokensUsed = 0 where agentContextWindow > 0 and agentContextTokensUsed > agentContextWindow\");");
    expect(server).toContain("function codexThreadMetadata(payload:");
    expect(server).toContain("function codexTokenUsageMetadata(params: Record<string, unknown>): Partial<Flow>");
    expect(server).toContain("agentContextTokensUsed: optionalInteger(last?.inputTokens)");
    expect(server).toContain("agentReasoningEffort: payload.reasoningEffort ?? \"\"");
    expect(server).toContain("agentServiceTier: payload.serviceTier ?? \"\"");
    expect(server).toContain("updateFlow(activeFlow.id, { ...codexThreadMetadata(threadPayload), ...configuredAgentMetadata(activeFlow) });");
    expect(server).toContain("updateFlow(flow.id, { ...codexThreadMetadata(threadResponse), ...configuredAgentMetadata(flow) });");
    expect(server).toContain('if (method === "model/rerouted")');
    expect(server).toContain('if (method === "thread/tokenUsage/updated")');
    expect(server).toContain("updateFlow(runtime.flowId, { agentModel: toModel });");
  });

  test("refreshes the displayed worktree branch after each agent turn", () => {
    expect(server).toContain("function worktreeBranchUpdate(flowId: string): Partial<Flow>");
    expect(server).toContain('runGit(["rev-parse", "--abbrev-ref", "HEAD"], flow.checkoutPath);');
    expect(server).toContain("branchName && branchName !== flow.branchName ? { branchName } : {}");
    expect(server).toContain('insertLog(flowId, "agent:status", `could not read worktree branch: ${String(error)}`);');
    expect(server).toContain("...worktreeBranchUpdate(runtime.flowId),");
    expect(server).toContain('agentStatus: turn?.status === "failed" ? "failed" : "idle",');
    expect(app).toContain('branch.textContent = flow?.branchName || "";');
  });

  test("lets agents update flow metadata including PR URL without changing stage", () => {
    expect(server).toContain('if ((parts[3] === "meta" || parts[3] === "stage") && request.method === "POST")');
    expect(server).toContain("function flowMetaUpdate(body: Record<string, unknown>): Partial<Flow>");
    expect(server).toContain('if ("stage" in body) {');
    expect(server).toContain('if ("prUrl" in body) fields.prUrl = normalizePrUrl(body.prUrl);');
    expect(server).toContain('return json({ error: "No supported flow metadata fields provided." }, { status: 400 });');
    expect(server).toContain('if (fields.stage) insertLog(id, "flow", `Stage changed to ${fields.stage}\\n`);');
    expect(server).toContain('fields.prUrl ? `PR set to ${fields.prUrl}\\n` : "PR cleared\\n"');
  });

  test("interrupts active agent turns instead of killing the app server", () => {
    expect(html).not.toContain('class="send-message"');
    expect(html).not.toContain('class="start-agent"');
    expect(html).not.toContain('class="agent-start icon-button"');
    expect(html).not.toContain('class="agent-interrupt icon-button"');
    expect(html).not.toContain('aria-label="Pause agent"');
    expect(html).toContain('class="agent-image-context" aria-label="Attached image context" hidden');
    expect(html).not.toContain('class="agent-image-drop-overlay"');
    expect(html).toContain('class="history-search-indicator" aria-live="polite" aria-hidden="true"');
    expect(html).toContain('class="slash-menu" role="listbox" hidden');
    expect(html).not.toContain('class="agent-working" aria-live="polite" hidden');
    expect(html).not.toContain("<span>working</span>");
    expect(html).toContain('<div class="prompt-input-pane">');
    expect(html).toContain('<span class="input-pane-prefix prompt-input-prefix" aria-hidden="true">&gt;</span>');
    expect(html).toContain('<textarea class="message-input" rows="1"></textarea>');
    expect(html).toContain('class="shell-output-resizer"');
    expect(html).toContain('aria-label="Resize agent and shell output panes"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('class="shell-output-pane" role="log" aria-live="polite" hidden');
    expect(html).toContain('<div class="shell-input-pane">');
    expect(html).toContain('<span class="input-pane-prefix shell-input-prefix" aria-hidden="true">$</span>');
    expect(html).toContain('<input class="shell-input" autocomplete="off" />');
    expect(html).not.toContain('placeholder="Prompt the agent"');
    expect(html).not.toContain('placeholder="$ shell"');
    expect(html).not.toContain('<path d="M9 6v12" />');
    expect(html).not.toContain('<path d="M15 6v12" />');
    expect(html.indexOf('class="terminal"')).toBeLessThan(html.indexOf('class="message-form"'));
    expect(app).not.toContain("agentStart.addEventListener");
    expect(app).not.toContain("agentInterrupt.disabled");
    expect(app).toContain("function agentWorkingForFlow(flow)");
    expect(app).toContain("const AGENT_WORKING_POLL_INTERVAL_MS = 2500;");
    expect(app).toContain("function syncAgentWorkingPoll(flowId, agentWorking)");
    expect(app).toContain("function pollAgentWorkingFlow()");
    expect(app).toContain('const data = await api(`/api/flows/${flowId}/agent/status`);');
    expect(app).toContain(
      "if (state.messageSubmitting || state.interruptSubmitting) {\n    state.agentWorkingPollInFlight = true;",
    );
    expect(app).toContain("await loadLogs(flowId);");
    expect(app).toContain("terminal-entry-working-${runtimeKind}");
    expect(app).toContain('body.className = "terminal-entry-body agent-working agent-turn-working";');
    expect(app).toContain('dots.setAttribute("aria-label", "Agent working");');
    expect(app).toContain("syncAgentWorkingPoll(id, agentWorking);");
    expect(app).toContain("!agentWorking &&\n    (state.terminalFollowPaused || !terminalAtLatest(terminal))");
    expect(app).not.toContain("const runtimeKind = flowRuntimeKind(flow);");
    expect(app).toContain('const agentWorkingKind = agentWorking ? "agent" : "idle";');
    expect(app).toContain("if (agentWorking) appendTerminalWorkingBlock(fragment);");
    expect(app).toContain("renderLogs(flow.id, { force: true, scrollToLatest: true });");
    expect(app).not.toContain('els.flowPane.querySelector(".agent-working").hidden = !agentWorking;');
    expect(app).toContain("shellOutputClearAfterLogId: new Map()");
    expect(app).toContain("function latestShellGroups(logs, clearAfterLogId = 0)");
    expect(app).toContain("filter((log) => Number(log.id) > clearAfterLogId)");
    expect(app).toContain("function isShellOutputLog(log)");
    expect(app).toContain('if (!isShellOutputLog(log)) continue;');
    expect(app).toContain('return log.source === "shell:output" || log.source === "shell:stderr" || log.source === "shell:status";');
    expect(app).toContain("function isShellOwnedLog(log)");
    expect(app).toContain('String(log.source || "").startsWith("shell:") && log.source !== "shell:command"');
    expect(app).toContain("function isLegacyShellOutputLog(log)");
    expect(app).toContain("function isShellTraceGroupLog(log)");
    expect(app).toContain("function shellOutputPane()");
    expect(app).toContain("function shellOutputGroups(logs, flow)");
    expect(app).toContain("function syncShellOutputClearState(flows)");
    expect(app).toContain("Number(flow.shellOutputClearAfterLogId || 0)");
    expect(app).toContain("const flowId = flow?.id || state.selectedFlowId;");
    expect(app).toContain("state.shellOutputClearAfterLogId.get(flowId) || 0");
    expect(app).toContain("Number(flow?.shellOutputClearAfterLogId || 0)");
    expect(app).toContain("return latestShellGroups(logs, clearAfterLogId);");
    expect(app).toContain("async function clearShellOutputPane()");
    expect(app).toContain("state.shellOutputClearAfterLogId.set(flowId, state.lastLogId.get(flowId) || 0);");
    expect(app).toContain('await api(`/api/flows/${encodeURIComponent(flowId)}/shell-output/clear`, { method: "POST" });');
    expect(app).toContain('if (message.event === "shell-output-cleared")');
    expect(server).toContain("create table if not exists shell_output_state");
    expect(server).toContain("function shellOutputClearAfterLogId(flowId: string)");
    expect(server).toContain("function setShellOutputClearAfterLogId(flowId: string, clearAfterLogId: number)");
    expect(server).toContain('broadcast("shell-output-cleared", { flowId, clearAfterLogId: normalized });');
    expect(server).toContain("function clientFlow(flow: Flow)");
    expect(server).toContain("shellOutputClearAfterLogId: shellOutputClearAfterLogId(flow.id)");
    expect(server).toContain('parts[3] === "shell-output" && parts[4] === "clear" && request.method === "POST"');
    expect(server).toContain("const clearAfterLogId = setShellOutputClearAfterLogId(id, latestLogId(id));");
    expect(app).toContain("function hasVisibleTerminalOutput(message)");
    expect(app).toContain("!hasVisibleTerminalOutput(log.message)");
    expect(app).toContain("if (!isRoutineShellExitLog(log)) appendTerminalGroup(groups, log);");
    expect(app).toContain("const showPane = !state.shellPaneHidden;");
    expect(app).toContain("pane.hidden = !showPane;");
    expect(app).toContain('agentPanel?.classList.toggle("shell-output-visible", showPane);');
    expect(app).toContain("if (showPane) applyShellOutputSplitSize();");
    expect(app).toContain("async function interruptSelectedFlow()");
    expect(app).toContain("function flowRuntimeActive(flow)");
    expect(app).toContain("function flowRuntimeKind(flow)");
    expect(app).toContain("function flowShellLive(flow)");
    expect(app).toContain("shellInterruptingFlowIds: new Set()");
    expect(app).toContain("state.shellSubmitting &&");
    expect(app).toContain('flow.agentStatus !== "running" &&');
    expect(app).toContain('flow.agentStatus !== "interrupting"');
    expect(app).toContain('flow?.agentRuntimeKind === "shell" ? "shell" : "agent"');
    expect(app).toContain("function flowAgentCompacting(flow)");
    expect(app).toContain("return flowAgentRunning(flow) && Boolean(flow?.agentCompacting);");
    expect(app).toContain("function flowAgentQueuedMessage(flow)");
    expect(app).toContain("return flowAgentCompacting(flow) && Boolean(flow?.agentQueuedMessage);");
    expect(app).toContain("if (state.interruptSubmitting) return false;");
    expect(app).toContain('flow?.agentStatus === "running" || flow?.agentStatus === "interrupting"');
    expect(app).toContain("state.interruptSubmitting = true;");
    expect(app).toContain('await api(`/api/flows/${selected.id}/agent/interrupt`, { method: "POST" });');
    expect(app).toContain("async function interruptSelectedShellCommand()");
    expect(app).toContain('const data = await api(`/api/flows/${selected.id}/command/interrupt`, { method: "POST" });');
    expect(app).toContain("state.shellInterruptingFlowIds.add(selected.id);");
    expect(app).toContain("renderShellOutputPane(selected.id);");
    expect(app).toContain('!state.shellInterruptingFlowIds.has(flow.id)');
    expect(app).toContain("state.shellInterruptingFlowIds.delete(flow.id);");
    expect(app).toContain("function handleShellInterruptKeydown(event)");
    expect(app).toContain('if (!event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== "c") return false;');
    expect(app).toContain("if (!flowShellRunning(selectedFlow())) return false;");
    expect(app).toContain("if (handleShellInterruptKeydown(event)) return;");
    const shellInterruptKeydown = app.slice(
      app.indexOf("function handleShellInterruptKeydown(event)"),
      app.indexOf("function handleAgentInterruptKeydown(event)"),
    );
    expect(shellInterruptKeydown).not.toContain("interruptSelectedFlow");
    expect(app).toContain("function handleAgentInterruptKeydown(event)");
    expect(app).toContain('if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey) return false;');
    expect(app).toContain('if (focusedInputPaneKind() !== "prompt") return false;');
    expect(app).toContain("if (!flowAgentRunning(selectedFlow())) return false;");
    expect(app).toContain("if (!event.repeat) void interruptSelectedFlow();");
    expect(app).toContain("if (handleAgentInterruptKeydown(event)) return;");
    expect(app).not.toContain('focusedInputPaneKind() === "shell" &&\n    flowShellRunning(selectedFlow())');
    expect(app).not.toContain('els.flowPane.querySelector(".agent-interrupt").addEventListener("click"');
    expect(app).toContain("function canSubmitPromptMessage()");
    expect(app).toContain("(!flowAgentRunning(flow) || (flowAgentCompacting(flow) && !flowAgentQueuedMessage(flow)))");
    expect(app).toContain("function canSubmitShellCommand()");
    expect(app).toContain("function flashBlockedInput(input)");
    expect(app).toContain("async function uploadAgentImages(files)");
    expect(app).toContain("function eventHasDraggedFiles(event)");
    expect(app).toContain("function setAgentImageDragActive(active)");
    expect(app).toContain('await api(`/api/flows/${encodeURIComponent(flow.id)}/context-images`,');
    expect(app).toContain("function agentMessageWithImages(message)");
    expect(app).toContain('document.addEventListener("drop"');
    expect(css).not.toContain(".agent-image-drop-overlay");
    expect(css).toContain("  display: inline-grid;\n  place-items: center;\n  width: 20px;");
    expect(css).toContain("  margin-left: 2px;\n  padding: 0;\n  border: 0;\n  border-radius: 3px;");
    expect(server).toContain("async function saveFlowContextImages(flow: Flow, formData: FormData)");
    expect(server).toContain('parts[3] === "context-images" && request.method === "POST"');
    expect(app).toContain("if (!canSubmitPromptMessage()) {\n    flashBlockedInput(input);\n    return;\n  }");
    expect(app).toContain("state.messageSubmitting = true;");
    expect(app).toContain('if (command === "clear") {');
    expect(app).toContain("await clearShellOutputPane();");
    expect(app).toContain("state.shellSubmitting = true;");
    expect(app).toContain("const flow = await ensureSelectedFlow();");
    expect(app).toContain("submittedFlowId = flow.id;");
    expect(app).toContain('renderShellOutputPane(selectedFlow()?.id || "");');
    expect(app).toContain("renderShellOutputPane(flow.id);");
    expect(app).toContain("renderShellOutputPane(submittedFlowId);");
    expect(app).toContain("const shellLive = showPane && flowShellLive(flow);");
    expect(app).toContain("if (!hasGroups && !shellLive) {");
    expect(app).toContain("shell-live:${shellLive}");
    expect(app).toContain('if (shellLive) appendTerminalWorkingBlock(fragment, "shell");');
    expect(app).not.toContain('pane.classList.toggle("live", shellLive);');
    expect(app).toContain('const data = await api(`/api/flows/${flow.id}/command`, {');
    expect(app).toContain("if (data.flow) upsertFlow(data.flow);");
    expect(app).toContain("scheduleAgentWorkingPoll(flow.id);");
    expect(app).toContain("if (submittedFlowId) await loadLogs(submittedFlowId, { shellOnly: true });");
    expect(app).toContain('await api(`/api/flows/${flow.id}/message`, {');
    expect(app).toContain("/agent/interrupt");
    expect(server).toContain("const agentHeartbeatSweepIntervalMs = 5000;");
    expect(server).toContain("function reconcileAgentHeartbeat(flow: Flow");
    expect(server).toContain("const shellRuntime = shellProcesses.get(flow.id);");
    expect(server).toContain('const shellStatus = shellRuntime.stopping ? "interrupting" : "running";');
    expect(server).toContain('agentRuntimeKind: "shell"');
    expect(server).toContain("agentRuntime?.activeTurnId || agentRuntime?.compacting");
    expect(server).toContain("agentCompacting: Boolean(agentRuntime.compacting)");
    expect(server).toContain("agentQueuedMessage: Boolean(agentRuntime.queuedAgentMessages?.length)");
    expect(server).toContain('flow.agentStatus !== "running" && flow.agentStatus !== "interrupting"');
    expect(server).toContain("const compactingStartedAt = runtime.compactingStartedAt ?? runtime.lastSeenAt ?? nowMs;");
    expect(server).toContain("context compaction timed out after");
    expect(server).toContain("void startNextQueuedAgentMessage(runtime);");
    expect(server).not.toContain("if (runtime.compacting) return flow;");
    expect(server).toContain('insertLog(flow.id, "agent:error", "agent runtime disappeared while status was running\\n");');
    expect(server).toContain("setInterval(sweepAgentHeartbeats, agentHeartbeatSweepIntervalMs);");
    expect(server).toContain('parts[3] === "agent" && parts[4] === "status" && request.method === "GET"');
    expect(server).toContain("turnRunning: Boolean(agentProcesses.get(id)?.activeTurnId)");
    expect(server).toContain("function runtimeAdjustedFlow(flow: Flow)");
    expect(server).toContain("function listClientFlows()");
    expect(app).not.toContain("agentActionIcon");
    expect(css).toContain("[hidden] {\n  display: none !important;");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) var(--shell-resizer-size) var(--shell-pane-size, 28%);");
    expect(css).toContain("grid-template-rows: minmax(0, 1fr) auto;");
    expect(css).toContain("border-top: 1px solid var(--line);");
    expect(css).toContain(".agent-working");
    expect(css).toContain(".terminal-entry-working-agent .agent-working");
    expect(css).toContain("color: #6d28d9;");
    expect(css).toContain("body.theme-dark .terminal-entry-working-agent .agent-working");
    expect(css).not.toContain(".agent-working.shell-working");
    expect(css).toContain(".terminal-panel.shell-output-visible");
    expect(css).toContain(
      "grid-template-columns: minmax(0, 1fr) var(--shell-resizer-size) var(--shell-pane-size, 28%);",
    );
    expect(css).toContain('grid-template-areas:\n    "terminal shell-resizer shell"\n    "form form form";');
    expect(css).toContain('"input . shell"');
    expect(css).toContain('"context . shell"');
    expect(css).toContain(".shell-output-resizer");
    expect(css).toContain("cursor: col-resize;");
    expect(css).toContain(".shell-output-pane");
    expect(css).not.toContain(".shell-output-pane.live");
    expect(css).toContain(".terminal-entry-working-shell .agent-working");
    expect(css).toContain("color: #16a34a;");
    expect(css).toContain("body.theme-dark .terminal-entry-working-shell .agent-working");
    expect(css).toContain(".shell-output-pane[hidden]");
    expect(css).not.toContain(".shell-output-pane .terminal-entry {\n  justify-items: end;");
    expect(css).not.toContain(".shell-output-pane .terminal-entry-body {\n  max-width: 100%;\n  padding-left: 0;\n  text-align: right;");
    expect(css).toContain(
      ".shell-output-pane .terminal-entry-output .terminal-entry-body,\n.shell-output-pane .terminal-entry-error .terminal-entry-body {\n  overflow-x: visible;\n  overflow-wrap: anywhere;\n  white-space: pre-wrap;\n}",
    );
    expect(css).not.toContain("body.theme-dark .agent-working.shell-working");
    expect(css).not.toContain("padding: 0 14px 6px;");
    expect(css).toContain("@keyframes agent-working-dot");
    expect(css).toContain(".agent-image-context {\n  grid-area: images;");
    expect(css).toContain("  padding-left: 14px;\n  transform: translateY(4px);");
    expect(css).toContain("  border: 1px solid #d97706;");
    expect(css).toContain(".prompt-input-pane {\n  grid-area: input;");
    expect(css).toContain("  padding-left: 14px;\n}\n\nbody.shell-pane-hidden .prompt-input-pane {\n  padding-right: 14px;\n}\n\n.agent-context {\n  grid-area: context;\n  padding-left: 16px;");
    expect(css).toContain(".shell-command-panel {\n  position: relative;\n  grid-area: shell;\n  min-width: 0;\n  align-self: start;\n  padding-right: 14px;");
    expect(css).toContain(".input-pane-prefix");
    expect(css).toContain("pointer-events: none;\n  color: var(--muted);");
    expect(css).toContain("transition: color var(--motion-fast);");
    expect(css).toContain(".prompt-input-prefix {\n  left: 24px;\n  top: 12px;\n}");
    expect(css).toContain(".prompt-input-pane:focus-within .prompt-input-prefix {\n  color: #d97706;\n}");
    expect(css).toContain(".shell-input-prefix {\n  top: 50%;\n  transform: translateY(-50%);");
    expect(css).toContain(".shell-input-pane:focus-within .shell-input-prefix {\n  color: #22c55e;\n}");
    expect(css).toContain(".message-input {\n  min-width: 0;\n  min-height: 36px;");
    expect(css).toContain("padding: 10px 10px 6px 30px;");
    expect(css).toContain(".message-input:focus {\n  border-color: #d97706;");
    expect(css).toContain(".shell-input {\n  width: 100%;\n  min-width: 0;\n  min-height: 36px;\n  padding-left: 30px;\n  border-color: var(--line);");
    expect(css).toContain(".shell-input:focus {\n  border-color: #22c55e;");
    expect(css).toContain("max-height: min(220px, 30vh);");
    expect(css).toContain("resize: none;");
    expect(css).toContain("overflow-y: auto;");
    expect(css).toContain("transition: height 120ms ease;");
    expect(css).toContain(".history-search-indicator");
    expect(css).toContain("  margin-bottom: 0;\n  padding-left: 14px;\n  opacity: 0;");
    expect(css).toContain('.history-search-indicator[data-mode="prompt"] strong {\n  color: #d97706;\n}');
    expect(css).toContain('.history-search-indicator[data-mode="shell"] strong {\n  color: #22c55e;\n}');
    expect(css).toContain(".message-form.history-searching");
    expect(css).toContain("max-height: 22px;\n  margin-bottom: 8px;\n  opacity: 1;\n  transform: translateY(4px);");
    expect(css).toContain("max-height 120ms ease");
    expect(css).toContain(".message-form.history-searching .history-search-indicator");
    expect(css).toContain("bottom: calc(100% - 4px);");
    expect(css).toContain(".slash-menu");
    expect(css).toContain("width: max-content;");
    expect(css).toContain(
      "max-width: min(720px, calc(100% - var(--shell-pane-size, 28%) - 18px), calc(100vw - 40px));",
    );
    expect(css).toContain("grid-template-columns: minmax(210px, max-content) minmax(0, auto);");
    expect(css).toContain(".slash-command-name {\n  min-width: 0;");
    expect(css).toContain(".slash-command-description {\n  min-width: 0;");
    expect(css).toContain("overflow: visible;");
    const slashDescriptionRule = css.slice(css.indexOf(".slash-command-description {"));
    expect(slashDescriptionRule.slice(0, slashDescriptionRule.indexOf("}"))).not.toContain("text-align: right;");
    expect(css).toContain("white-space: nowrap;");
    expect(css).not.toContain(".agent-interrupt");
    expect(css).not.toContain(".agent-start svg");
    expect(server).toContain('"turn/interrupt"');
    expect(server).toContain("async function interruptAgent");
    expect(server).toContain("const shellProcesses = new Map<string, RuntimeProcess>();");
    expect(server).toContain('kind: "agent" | "serve" | "shell";');
    expect(server).toContain('if (shellProcesses.has(flow.id)) throw new Error("A shell command is already running.");');
    expect(server).toContain("type RuntimeSignal = \"SIGINT\" | \"SIGTERM\" | \"SIGKILL\";");
    expect(server).toContain("function signalRuntimeProcess(runtime: RuntimeProcess, signal: RuntimeSignal)");
    expect(server).toContain("process.kill(-runtime.proc.pid, signal);");
    expect(server).toContain("function scheduleShellInterruptEscalation(flowId: string, runtime: RuntimeProcess)");
    expect(server).toContain('insertLog(flowId, "shell:status", "shell interrupt escalated");');
    expect(server).toContain('insertLog(flowId, "shell:status", "shell interrupt forced cleanup");');
    expect(server).toContain('detached: true,');
    expect(server).toContain("function startShellCommand(flow: Flow, userCommand: string)");
    expect(server).not.toContain("async function runShellCommand");
    expect(server).toContain('shellProcesses.set(flow.id, runtime);');
    expect(server).toContain('const commandLogId = insertLog(flow.id, "shell:command", command);');
    expect(server).toContain('streamProcessOutput(flow.id, "shell:output", proc.stdout)');
    expect(server).toContain('streamProcessOutput(flow.id, "shell:stderr", proc.stderr)');
    expect(server).toContain("void (async () => {");
    expect(server).toContain("if (shellProcesses.get(flow.id)?.proc === proc) shellProcesses.delete(flow.id);\n      await Promise.all([stdoutDone, stderrDone]);");
    expect(server).toContain("await Promise.all([stdoutDone, stderrDone]);");
    expect(server).toContain("const resultLogId = insertLog(\n        flow.id,\n        \"shell:result\",");
    expect(server).toContain('createTraceGroupBetweenLogs(flow.id, commandLogId, resultLogId + 1, "shell");');
    expect(server).toContain('runtime.proc.stdin?.write("\\x03");');
    expect(server).toContain('signalRuntimeProcess(runtime, "SIGINT");');
    expect(server).toContain("scheduleShellInterruptEscalation(flowId, runtime);");
    expect(server).toContain("function interruptShellCommand(flowId: string)");
    expect(server).toContain("if (interruptShellCommand(flowId)) return;");
    expect(server).toContain('parts[3] === "command" && parts[4] === "interrupt" && request.method === "POST"');
    expect(server).toContain("interruptShellCommand(id);");
    expect(server).toContain("startShellCommand(flow, body.command);");
    expect(server).toContain("return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });");
    expect(server).toContain('runtime.stopping ? "interrupted" : "failed"');
    expect(server).toContain('agentStatus: code === 0 || runtime.stopping ? "idle" : "failed"');
    expect(server).not.toContain("agent stopped by Turbopump");
  });

  test("cleans up spawned runtimes when server startup or first turn fails", () => {
    expect(server).toContain("function cleanupFailedRuntimeProcess(runtime: RuntimeProcess, reason: string)");
    expect(server).toContain("rejectCodexPending(runtime, new Error(reason));");
    expect(server).toContain("forgetRuntimeProcess(runtime);");
    expect(server).toContain('signalRuntimeProcess(runtime, "SIGTERM");');
    expect(server).toContain('signalRuntimeProcess(runtime, "SIGKILL");');
    const codexStartup = server.slice(server.indexOf("async function startCodexAppServer"));
    expect(codexStartup).toContain("detached: true,");
    expect(codexStartup).toContain('insertLog(activeFlow.id, "agent:status", `cleaning up failed app-server startup: ${String(error)}`);');
    expect(codexStartup).toContain("cleanupFailedRuntimeProcess(runtime, `codex app-server startup failed: ${String(error)}`);");
    const startAgentTurnAfterUserLogBody = server.slice(server.indexOf("async function startAgentTurnAfterUserLog"));
    expect(startAgentTurnAfterUserLogBody).toContain("let createdRuntime = false;");
    expect(startAgentTurnAfterUserLogBody).toContain("createdRuntime = true;");
    expect(startAgentTurnAfterUserLogBody).toContain("if (createdRuntime && runtime) cleanupFailedRuntimeProcess(runtime, `agent turn failed: ${String(error)}`);");
    const startAgentBody = server.slice(server.indexOf("async function startAgent("));
    expect(startAgentBody).toContain("let createdRuntime = false;");
    expect(startAgentBody).toContain("createdRuntime = true;");
    expect(startAgentBody).toContain("if (createdRuntime && runtime) cleanupFailedRuntimeProcess(runtime, `agent turn failed: ${String(error)}`);");
  });

  test("lets the Agent and Linear panes be resized with the separator", () => {
    expect(html).toContain('class="flow-resizer"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(css).toContain('grid-template-rows: var(--top-pane-size, 50%) 8px minmax(0, 1fr);');
    expect(app).toContain("localStorage.getItem(FLOW_SPLIT_SIZE_KEY) || 50");
    expect(css).toContain(".flow-resizer");
    expect(css).toContain("cursor: row-resize;");
    expect(css).toContain("body.flow-resizing");
    expect(css).toContain(".flow-resizer:hover,\n.flow-resizer:focus-visible,\nbody.flow-resizing .flow-resizer {\n  background: #e2e7ee;\n}");
    expect(css).toContain(
      "body.theme-dark .flow-resizer:hover,\nbody.theme-dark .flow-resizer:focus-visible,\nbody.theme-dark.flow-resizing .flow-resizer,",
    );
    expect(app).toContain('const FLOW_SPLIT_SIZE_KEY = "flow.topPaneSize";');
    expect(app).toContain("function flowSplitBounds(content, rect)");
    expect(app).toContain("const minTopPx = 0;");
    expect(app).not.toContain('linearDetail?.querySelector(".linear-meta")');
    expect(app).toContain('content.querySelector(".message-form")');
    expect(app).toContain("function setFlowSplitSize(value)");
    expect(app).toContain('content.style.setProperty("--top-pane-size"');
    expect(css).toContain(".agent-panel {\n  position: relative;\n  overflow: hidden;\n}");
    expect(css).toContain(".terminal {\n  grid-area: terminal;\n  display: grid;\n  align-content: start;\n  gap: 10px;\n  min-height: 0;");
    expect(css).toContain("padding: 14px 14px 6px;");
    expect(css).toContain("background: var(--panel);\n  z-index: 1;");
    expect(app).toContain('els.flowPane.querySelector(".flow-resizer").addEventListener("pointerdown"');
    expect(app).toContain('els.flowPane.querySelector(".flow-resizer").addEventListener("keydown"');
    expect(app).toContain('const SHELL_OUTPUT_SPLIT_SIZE_KEY = "flow.shellOutputPaneSize";');
    expect(app).toContain("function shellOutputSplitBounds(panel, rect)");
    expect(app).toContain("function setShellOutputSplitSize(value)");
    expect(app).toContain("function setShellOutputSplitSizeKeepingTerminalBottom(value)");
    expect(app).toContain("const restoreTerminalBottom = terminalBottomRestorer();");
    expect(app).toContain("setShellOutputSplitSize(value);\n  restoreTerminalBottom();");
    expect(app).toContain("setShellOutputSplitSizeKeepingTerminalBottom(((rect.right - clientX) / rect.width) * 100);");
    expect(app).toContain('panel.style.setProperty("--shell-pane-size"');
    expect(app).toContain("function startShellOutputSplitResize(event)");
    expect(app).toContain('els.flowPane.querySelector(".shell-output-resizer").addEventListener("pointerdown"');
    expect(app).toContain('els.flowPane.querySelector(".shell-output-resizer").addEventListener("keydown"');
    expect(css).toContain(
      ".shell-output-resizer:hover,\n.shell-output-resizer:focus-visible,\nbody.shell-output-resizing .shell-output-resizer {\n  background: #e2e7ee;\n}",
    );
    expect(css).toContain(
      "body.theme-dark .shell-output-resizer:hover,\nbody.theme-dark .shell-output-resizer:focus-visible,\nbody.theme-dark.shell-output-resizing .shell-output-resizer,",
    );
  });

  test("hides routine turn status logs from the terminal", () => {
    expect(app).toContain("function isHiddenTerminalLog(log)");
    expect(app).toContain('log.source === "agent:status"');
    expect(app).toContain("/^turn started\\b/");
    expect(app).toContain("/^turn completed\\b/");
    expect(app).toContain("/^interrupt requested\\b/");
    expect(app).toContain("/^[$]\\s*codex app-server --listen stdio:\\/\\/$/i");
    expect(app).toContain("/^Codex thread \\S+ ready$/i");
    expect(app).toContain('log.source === "flow" && /^stage changed\\b/i.test(message)');
    expect(app).toContain('log.source === "agent:tool-result" && message === "completed exit 0"');
    expect(app).toContain('log.source === "agent:tool-result" && message === "failed exit 7"');
    expect(app).toContain("function isRoutineShellExitLog(log)");
    expect(app).toContain('String(log.message || "").trim() === "completed exit 0"');
    expect(app).toContain("if (isHiddenTerminalLog(log)) continue;");
  });

  test("renders command execution logs as a single shell prompt line", () => {
    expect(app).toContain('group.source === "agent:tool" || group.source === "agent:tool-result" || group.source === "shell:command"');
    expect(app).toContain('block.classList.add("terminal-entry-command");');
    expect(app).toContain('row.className = "terminal-command-line";');
    expect(app).toContain("marker.textContent = meta.marker;");
    expect(app).toContain("row.replaceChildren(marker, body);");
    expect(app).toContain("block.replaceChildren(row);");
    expect(app).toContain("renderInlineMarkdown(formatTerminalMessage(group.source, group.message)");
    expect(app).not.toContain('time.className = "terminal-entry-time";\n    block.classList.add("terminal-entry-command");');
    expect(app).toContain('if (meta.tone !== "output") {');
    expect(app).toContain('...(meta.tone === "output" ? [renderOutputDeleteButton(group)] : []),');
    expect(app).toContain("function renderOutputDeleteButton(group)");
    expect(app).toContain("function deleteOutputLogGroup(flowId, ids)");
    expect(app).toContain('await api(`/api/flows/${encodeURIComponent(flowId)}/logs`, {');
    expect(app).toContain('if (message.event === "logs-deleted")');
    expect(server).toContain('const allowedSources = new Set(["agent:output", "agent:cmd", "shell:output"]);');
    expect(server).toContain('broadcast("logs-deleted", { flowId, ids: uniqueIds });');
    expect(server).toContain('if (parts[3] === "logs" && request.method === "DELETE")');
    expect(app).not.toContain('renderInlineMarkdown(`$ ${formatTerminalMessage(group.source, group.message)}`');
    expect(css).toContain(".terminal-command-line {\n  display: flex;");
    expect(css).toContain(".terminal-output-delete");
    expect(css).toContain("position: sticky;\n  top: 8px;");
    expect(css).toContain("justify-self: end;\n  margin-bottom: -22px;");
    expect(css).toContain(".terminal-entry-output:hover > .terminal-output-delete");
    expect(css).toContain(".terminal-command-line {\n  display: flex;\n  align-items: baseline;\n  gap: 7px;\n  min-width: 0;\n  font-size: 10px;");
    expect(css).toContain(".terminal-entry-command .terminal-entry-body {\n  flex: 1 1 auto;\n  padding-left: 0;");
    expect(css).toContain(".terminal-entry-shell .terminal-entry-marker {\n  color: #22c55e;\n}");
    expect(css).toContain("body.theme-dark .terminal-entry-shell .terminal-entry-marker {\n  color: #22c55e;\n}");
    expect(css).toContain(".terminal-entry-shell.terminal-entry-command .terminal-command-line,\n.terminal-entry-shell.terminal-entry-command .terminal-entry-body {\n  font-size: 12px;\n}");
    expect(css).toContain(".terminal-entry-command .terminal-entry-body {\n  flex: 1 1 auto;\n  padding-left: 0;\n  font-size: 10px;");
    expect(css).toContain(".terminal-trace-body .terminal-entry-assistant,\n.terminal-trace-body .terminal-entry-assistant .terminal-entry-time,\n.terminal-entry-output,\n.terminal-entry-error {\n  font-size: 10px;");
  });

  test("renders terminal output with ANSI styling instead of leaking escape codes", () => {
    expect(app).toContain("function renderAnsiText(root, message)");
    expect(app).toContain("function ansiParams(value)");
    expect(app).toContain('const pattern = /\\x1b\\[([0-?]*)([ -/]*)([@-~])|\\[((?:\\d{1,3}|[;:])+)m/g;');
    expect(app).toContain('span.classList.add("ansi-bold");');
    expect(app).toContain("function ansi256ColorValue(value)");
    expect(app).toContain("function ansiTrueColorValue(red, green, blue)");
    expect(app).toContain("span.style.color = inlineColor;");
    expect(app).toContain("span.style.backgroundColor = backgroundColor;");
    expect(app).toContain('renderAnsiText(body, message);');
    expect(app).toContain('meta.tone === "output" || meta.tone === "error"');
    expect(css).toContain(".terminal-entry-output .terminal-entry-body,\n.terminal-entry-error .terminal-entry-body {\n  overflow-x: auto;\n  overflow-wrap: normal;\n  white-space: pre;\n}");
    expect(css).toContain(".terminal-entry-body .ansi-fg-bright-black");
    expect(css).toContain(".terminal-entry-body .ansi-fg-green");
    expect(css).toContain("body.theme-dark .terminal-entry-body .ansi-fg-cyan");
    expect(css).toContain("body.theme-dark .terminal-entry-body .ansi-fg-yellow");
    expect(css).toContain(".terminal-entry-body .ansi-dim");
    expect(css).toContain(".terminal-entry-body .ansi-underline");
  });

  test("drains paginated logs on selected flow refresh without global log warmup", () => {
    expect(app).toContain("if (flow) {\n    await loadLogs(flow.id);");
    expect(app).not.toContain("loadAllLogs");
    expect(app).toContain("function appendLogEntry(log)");
    expect(app).toContain("logIds: new Map()");
    expect(app).toContain("state.logIds.set(flowId, new Set((state.logs.get(flowId) || []).map((entry) => Number(entry.id))));");
    expect(app).toContain("if (ids.has(id)) return false;");
    expect(app).toContain("ids.add(id);");
    expect(app).toContain("appendLogEntry(log);");
    expect(app).toContain("const appendedLogs = [];");
    expect(app).toContain("if (appendLogEntry(log)) appendedLogs.push(log);");
    expect(app).toContain("function isShellOnlyRenderLog(log)");
    expect(app).toContain("appendedLogs.length && appendedLogs.every(isShellOnlyRenderLog)");
    expect(app).toContain("const log = {\n        id: message.payload.id,");
    expect(app).toContain("if (isShellOnlyRenderLog(log)) {\n        renderShellOutputPane(log.flowId);\n        return;\n      }");
    expect(app).toContain("while (true)");
    expect(app).toContain("if (!data.logs.length) break;");
    expect(app).toContain("if (data.logs.length < 1000) break;");
    expect(app).toContain("state.lastLogId.set(id, highestLogId);");
    expect(app).toContain("if (flow) await loadLogs(flow.id);");
  });

  test("renders logs in chronological order in the Agent pane", () => {
    expect(app).toContain("function scrollTerminalToLatest(terminal)");
    expect(app).toContain("requestAnimationFrame(() =>");
    expect(app).toContain("terminal.scrollTop = terminal.scrollHeight;");
    expect(app).toContain("function formatTerminalTimestamp(value)");
    expect(app).toContain("function terminalDateLabel(date, now = new Date())");
    expect(app).toContain("return `${days}d ago`;");
    expect(app).toContain('return dateLabel ? `${time} (${dateLabel})` : time;');
    expect(app).toContain("time.textContent = formatTerminalTimestamp(group.createdAt);");
    expect(css).toContain(".terminal-entry-time {\n  margin-left: auto;\n  color: #94a3b8;\n  font-size: 11px;");
    expect(app).toContain("function terminalDistanceFromBottom(terminal)");
    expect(app).toContain("return terminal.scrollHeight - terminal.clientHeight - terminal.scrollTop;");
    expect(app).toContain("function terminalAtLatest(terminal)");
    expect(app).toContain("terminalFollowPaused: false");
    expect(app).toContain("function pauseTerminalFollow()");
    expect(app).toContain("function resumeTerminalFollow()");
    expect(app).toContain("state.terminalFollowPaused || !terminalAtLatest(terminal)");
    expect(app).toContain('els.flowPane.querySelector(".terminal").addEventListener(\n  "wheel"');
    expect(app).toContain("terminal._flowLogPending = id;");
    expect(app).toContain("terminal._flowLogPending = \"\";");
    expect(app).toContain('els.flowPane.querySelector(".terminal").addEventListener("scroll"');
    expect(app).toContain("for (const group of groups) appendTerminalBlock(fragment, group);");
    expect(app).not.toContain("[...groups].reverse()");
    expect(app).not.toContain("activeFlowTab");
    expect(app).toContain("terminal._flowLogFlowId === id && terminal._flowLogSignature === signature && !options.force");
  });

  test("collapses completed-turn traces between the prompt and final message", () => {
    expect(server).toContain('kind === "shell" ? "shell:trace-group" : "agent:trace-group"');
    expect(server).toContain("const latestUserLogBeforeStmt = db.query(");
    expect(server).toContain('function createTraceGroupBetweenLogs(flowId: string, afterId: number, beforeId: number, kind = "")');
    expect(server).toContain("if (traceCount <= 1) return;");
    expect(server).toContain('createTraceGroupBetweenLogs(flow.id, commandLogId, resultLogId + 1, "shell");');
    expect(server).toContain("function createTraceGroupAfterPrompt(flowId: string, promptId: number, beforeId: number)");
    expect(server).toContain("function createTurnTraceGroup(flowId: string, beforeId: number)");
    expect(server).toContain("function createCompletedTurnTraceGroup(flowId: string)");
    expect(server).toContain("const prompt = latestUserLogBeforeStmt.get(flowId, beforeId)");
    expect(server).toContain("const beforeId = logs[finalMessageStartIndex].id;");
    expect(server).toContain("createCompletedTurnTraceGroup(runtime.flowId);");
    expect(server).toContain("const isSteerMessage = Boolean(message && existingRuntime?.activeTurnId);");
    expect(server).toContain("if (isSteerMessage) createTurnTraceGroup(flow.id, userLogId);");
    expect(server).toContain('const errorLogId = insertLog(flow.id, "agent:error", "agent runtime disappeared while status was running\\n");');
    expect(server).toContain("createTurnTraceGroup(flow.id, errorLogId);");
    expect(app).toContain('"agent:trace-group": { label: "trace"');
    expect(app).toContain("function parseTraceGroup(log)");
    expect(app).toContain("function syntheticRuntimeDisappearedTraceRanges(logs, existingRanges)");
    expect(app).not.toContain("function syntheticShellTraceRanges(logs, existingRanges)");
    expect(app).not.toContain("function latestInputLogId(logs)");
    expect(app).toContain('if (log.source !== "agent:trace-group" && log.source !== "shell:trace-group") return null;');
    expect(app).toContain("if (count <= 1) return null;");
    expect(app).toContain('defaultOpen: false');
    expect(app).toContain("group.defaultOpen || (group.flowId && group.traceKey");
    expect(app).toContain("function syntheticSteerTraceRanges(logs, existingRanges)");
    expect(app).toContain("function isTurnCompletedLog(log)");
    expect(app).toContain("function isShellExitLog(log)");
    expect(app).toContain("function isRoutineShellExitLog(log)");
    expect(app).toContain('String(log.message || "").trim() === "agent runtime disappeared while status was running"');
    expect(app).toContain("const runtimeDisappearedTraceRanges = syntheticRuntimeDisappearedTraceRanges(normalizedLogs, persistedTraceRanges);");
    expect(app).toContain("if (count <= 1) continue;");
    expect(app).toContain('filter((range) => range && range.kind !== "shell")');
    expect(app).toContain("function isShellTraceGroupLog(log)");
    expect(app).toContain("if (isShellTraceGroupLog(log)) continue;");
    expect(app).toContain('kind: typeof payload.kind === "string" ? payload.kind : ""');
    expect(app).not.toContain('ranges.push({ afterId, beforeId, count, key, kind: "shell" });');
    expect(app).toContain("if (isHiddenTerminalLog(log)) continue;");
    expect(app).toContain("...runtimeDisappearedTraceRanges,");
    expect(app).not.toContain("...shellTraceRanges,");
    expect(app).toContain("...syntheticSteerTraceRanges(normalizedLogs, [...persistedTraceRanges, ...runtimeDisappearedTraceRanges]),");
    expect(app).toContain("function appendTerminalTraceGroup(fragment, group)");
    expect(app).toContain("function flattenSingleChildTraceGroups(groups)");
    expect(app).toContain('if (group.source === "agent:trace-group") {');
    expect(app).toContain("if (children.length <= 1) {");
    expect(app).toContain("return flattenSingleChildTraceGroups(groups);");
    expect(app).toContain("openTraceGroups: new Map()");
    expect(app).toContain("traceKey: traceRange.key,");
    expect(app).toContain("flowId: log.flowId,");
    expect(app).toContain('details.dataset.traceKey = group.traceKey || "";');
    expect(app).toContain("details._traceChildren = group.children || [];");
    expect(app).toContain("if (isTerminalTraceGroupOpen(group)) {");
    expect(app).toContain("function setTerminalTraceGroupOpen(details, open)");
    expect(app).toContain("setTerminalTraceGroupOpen(details, shouldOpen);");
    expect(app).toContain("details.replaceChildren(summary);");
    expect(app).toContain("function materializeTerminalTraceGroup(details)");
    expect(app).toContain("if (shouldOpen) materializeTerminalTraceGroup(details);");
    expect(app).toContain('message: "",');
    expect(app).not.toContain('event${traceRange.count === 1 ? "" : "s"}');
    expect(app).not.toContain('message: `${traceRange.count || 0} trace event');
    expect(app).toContain('details.className = "terminal-trace-group";');
    expect(app).toContain('child.style.setProperty("--trace-open-delay", `${traceFoldDelay(index)}ms`);');
    expect(app).toContain('child.style.setProperty("--trace-close-delay", `${traceFoldDelay(lastIndex - index) / 2}ms`);');
    expect(app).toContain("function traceFoldDelay(index)");
    expect(app).toContain("Math.log1p(Math.max(0, index) * 1.6) * 30");
    expect(app).toContain('event.preventDefault();');
    expect(app).toContain("toggleTerminalTraceGroup(details);");
    expect(app).toContain("function toggleTerminalTraceGroup(details)");
    expect(app).toContain('const terminal = details.closest(".terminal");');
    expect(app).toContain("const shouldFollowLatest = terminal && !state.terminalFollowPaused && terminalAtLatest(terminal);");
    expect(app).toContain("if (shouldFollowLatest) followTerminalToLatestDuringLayout(terminal, duration + 40);");
    expect(app).toContain("details._traceBody?.remove();");
    expect(app).toContain("details._traceBody = null;");
    expect(app).toContain("if (shouldFollowLatest) scrollTerminalToLatestNow(terminal);");
    expect(app).toContain('body.className = "terminal-trace-body";');
    expect(css).toContain(".terminal-trace-group");
    expect(css).toContain(".terminal > .terminal-trace-group:last-child:not([open]) {\n  padding-bottom: 10px;\n}");
    expect(css).toContain("user-select: none;");
    expect(css).toContain(".terminal-trace-group:not([open]) > .terminal-trace-summary .terminal-entry-time");
    expect(css).toContain(".terminal-trace-body");
    expect(css).toContain(".terminal-trace-closing > .terminal-trace-body {\n  padding-top: 0;\n  padding-bottom: 0;\n  overflow: hidden;\n}");
    expect(css).toContain(".terminal-trace-opening > .terminal-trace-body > *");
    expect(css).toContain("animation-delay: var(--trace-open-delay, 0ms);");
    expect(css).toContain(".terminal-trace-closing > .terminal-trace-body > *");
    expect(css).toContain("animation-delay: var(--trace-close-delay, 0ms);");
  });

  test("repaints agent logs after navigating through a ticket without a flow", () => {
    expect(app).toContain('terminal._flowLogFlowId = "";');
    expect(app).toContain('terminal._flowLogSignature = "";');
    expect(app).toContain('terminal.textContent = "No agent session yet.";');
    expect(app).toContain("terminal._flowLogFlowId === id && terminal._flowLogSignature === signature && !options.force");
    expect(app).toContain("terminal._flowLogFlowId = id;");
  });

  test("logs the user prompt before starting a new Codex runtime", () => {
    const promptLog = 'const userLogId = message ? insertLog(flow.id, "user", `${userMessage}\\n`) : 0;';
    const startAgentBody = server.slice(server.indexOf("async function startAgent("));
    expect(startAgentBody).toContain(promptLog);
    expect(startAgentBody.indexOf(promptLog)).toBeLessThan(
      startAgentBody.indexOf("runtime = existingRuntime;"),
    );
  });

  test("supports slash command suggestions and dispatch", () => {
    expect(app).toContain('const SLASH_COMMANDS = [');
    expect(app).toContain('name: "/clear"');
    expect(app).toContain('name: "/compact"');
    expect(app).toContain('name: "/effort"');
    expect(app).toContain('name: "/fast"');
    expect(app).toContain('name: "/model"');
    expect(app).toContain('name: "/review"');
    expect(app).toContain('"/effort": ["xhigh", "high", "medium", "low"].map((effort) => ({');
    expect(app).toContain('"/model": ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"].map((model) => ({');
    expect(app).toContain('"/review": [');
    expect(app).toContain('{ name: "/review base", description: "Review against a base branch (PR style)" }');
    expect(app).toContain('{ name: "/review uncommitted", description: "Review uncommitted changes" }');
    expect(app).toContain('{ name: "/review commit", description: "Review a commit" }');
    expect(app).toContain('{ name: "/review custom", description: "Custom review instructions" }');
    expect(app).toContain('const SLASH_COMMANDS_WITH_ARGUMENTS = ["/review base", "/review commit", "/review custom"];');
    expect(app).toContain('description: "",');
    expect(app).toContain("function slashCommandExpansionMatches(query)");
    expect(app).toContain("function slashCommandHasExpansions(commandName)");
    expect(app).toContain("function slashCommandAllowsArguments(commandName)");
    expect(app).toContain("function validSlashCommand(value)");
    expect(app).toContain("slashCommandAllowsArguments(command.name) && commandName.startsWith(`${command.name} `)");
    expect(app).toContain("if (expansions.length) return expansions;");
    expect(app).toContain("function renderSlashMenu()");
    expect(app).toContain("function selectSlashCommand");
    expect(app).toContain("function resizeMessageInput()");
    expect(app).toContain("const currentHeight = input.getBoundingClientRect().height;");
    expect(app).toContain("const targetHeight = input.scrollHeight;");
    expect(app).toContain('input.style.height = `${currentHeight}px`;');
    expect(app).toContain('input.style.height = `${targetHeight}px`;');
    expect(app).toContain('const terminal = els.flowPane.querySelector(".terminal");');
    expect(app).toContain("const shouldFollowLatest = !state.terminalFollowPaused && terminalAtLatest(terminal);");
    expect(app).toContain('input.style.height = "auto";');
    expect(app).toContain("if (!currentHeight || Math.abs(currentHeight - targetHeight) < 1) {");
    expect(app).toContain("if (shouldFollowLatest) followTerminalToLatestDuringLayout(terminal, 160);");
    expect(app).toContain('if (!query.startsWith("/")) return [];');
    expect(app).toContain(".sort((a, b) => a.name.localeCompare(b.name))");
    expect(app).not.toContain("SLASH_COMMAND_EXPANSIONS[command] = sortSlashCommands(expansions);");
    expect(app).toContain('promptInput().addEventListener("keydown"');
    expect(app).toContain('if (event.key === "Enter" && !event.shiftKey && !event.isComposing)');
    expect(app).toContain("input.form?.requestSubmit();");
    expect(app).toContain("resizeMessageInput();");
    expect(app).toContain("if (input.value.trim() !== command.name) {");
    expect(app).toContain("if (slashCommandHasExpansions(command.name))");
    expect(app).toContain('if (input.value.trim().startsWith("/") && !validSlashCommand(input.value)) return;');
    expect(app).toContain('els.flowPane.querySelector(".slash-menu").addEventListener("mouseover"');
    expect(app).toContain('els.flowPane.querySelector(".slash-menu").addEventListener("mousedown"');
    expect(server).toContain("function parseSlashCommand(message: string)");
    expect(server).toContain('"thread/compact/start"');
    expect(server).toContain('codexThreadParams(flow, "clear")');
    expect(server).toContain('sessionStartSource,');
    expect(server).toContain('insertLog(flow.id, "agent:status", "context cleared")');
    expect(server).toContain('insertLog(flow.id, "agent:status", "compact requested")');
    expect(server).toContain("runtime.compacting = true;");
    expect(server).toContain("runtime.compactingStartedAt = Date.now();");
    expect(server).toContain("runtime.compactionPromptLogId = promptLogId;");
    expect(server).toContain("runtime.compacting = false;");
    expect(server).toContain("runtime.compactingStartedAt = undefined;");
    expect(server).toContain("runtime.compactionPromptLogId = undefined;");
    const turnStartedHandler = server.slice(
      server.indexOf('if (method === "turn/started")'),
      server.indexOf('if (method === "turn/completed")'),
    );
    expect(turnStartedHandler).not.toContain("runtime.compacting = false;");
    const turnCompletedHandler = server.slice(
      server.indexOf('if (method === "turn/completed")'),
      server.indexOf('if (method === "thread/compacted")'),
    );
    expect(server).toContain("function finishCodexCompaction(runtime: RuntimeProcess");
    expect(server).toContain("updateRuntimeThreadFromParams(runtime, params);");
    expect(server).toContain("const compactionPromptLogId = runtime.compactionPromptLogId;");
    expect(server).toContain('const contextCompactedLogId = insertLog(runtime.flowId, "agent:status", "context compacted");');
    expect(server).toContain("deleteQueuedAgentMessagePlaceholders(runtime);");
    expect(server).toContain(
      'if (compactionPromptLogId) createTraceGroupBetweenLogs(runtime.flowId, compactionPromptLogId, contextCompactedLogId + 1, "compact");',
    );
    expect(turnCompletedHandler).toContain('if (runtime.compacting && turn?.status !== "failed") {');
    expect(turnCompletedHandler).toContain("finishCodexCompaction(runtime, params);");
    const threadCompactedHandler = server.slice(
      server.indexOf('if (method === "thread/compacted")'),
      server.indexOf('if (method === "model/rerouted")'),
    );
    expect(threadCompactedHandler).toContain("if (runtime.compacting) finishCodexCompaction(runtime, params);");
    expect(threadCompactedHandler).toContain("else updateRuntimeThreadFromParams(runtime, params);");
    expect(server).toContain('insertLog(flowId, "agent:status", "compact interrupted")');
    expect(server).toContain("runtime.queuedAgentMessages = [];");
    expect(server).toContain("queuedAgentMessages?: Array<{ message: string; queuedLogId: number }>");
    expect(server).toContain("compactionPromptLogId?: number;");
    expect(server).toContain("function startNextQueuedAgentMessage(runtime: RuntimeProcess)");
    expect(server).toContain("function deleteQueuedUserLog(flowId: string, id: number)");
    expect(server).toContain("function deleteQueuedAgentMessagePlaceholders(runtime: RuntimeProcess)");
    expect(server).toContain('log.source !== "user:queued"');
    expect(server).toContain("deleteLogByIdStmt.run(id);");
    expect(server).toContain('broadcast("logs-deleted", { flowId, ids: [id] });');
    expect(server).toContain("deleteQueuedUserLog(flow.id, queued.queuedLogId);");
    expect(server).toContain('const userLogId = insertLog(flow.id, "user", `${queued.message}\\n`);');
    const startAgentBody = server.slice(
      server.indexOf("async function startAgent("),
      server.indexOf("function startShellCommand("),
    );
    expect(startAgentBody.indexOf("existingRuntime?.compacting")).toBeLessThan(
      startAgentBody.indexOf("handleSlashCommand(flow, userMessage)"),
    );
    expect(server).toContain('throw new Error("A message is already queued until context compaction finishes.");');
    expect(server).toContain('insertLog(flow.id, "agent:status", "message queued until context compaction finishes")');
    expect(server).toContain('const queuedLogId = insertLog(flow.id, "user:queued", `${userMessage}\\n`);');
    expect(server).toContain("existingRuntime.queuedAgentMessages.push({ message: userMessage, queuedLogId });");
    expect(server).toContain("await compactCodexThread(runtime, flow, userLogId);");
    expect(server).toContain("void startNextQueuedAgentMessage(runtime);");
    expect(server).toContain('updateFlow(flow.id, { agentStatus: "running" });');
    expect(server).toContain("const reviewFindingInstructions =");
    expect(server).toContain("function reviewPromptForSlashCommand(message: string)");
    expect(server).toContain('if (command === "/review")');
    expect(server).toContain("await startAgentTurnAfterUserLog(flow, userLogId, reviewPromptForSlashCommand(message));");
    expect(server).toContain('"Usage: /review base [branch]|uncommitted|commit [ref]|custom [instructions]"');
    expect(app).toContain("function canSubmitPromptMessage()");
    expect(app).toContain('if (source === "user:queued") return { label: userLabel, marker: "o", tone: "user" };');
    expect(app).toContain('["user", "user:queued", "agent", "agent:message", "agent:thinking", "agent:reasoning"].includes(source)');
    expect(app).toContain("if (data.flow) upsertFlow(data.flow);");
    expect(app).toContain("function canSubmitShellCommand()");
    expect(app).not.toContain("agentInterrupt.disabled");
  });

  test("focuses the message input when typing from non-editable chrome", () => {
    expect(app).toContain("function isEditableKeyTarget(target)");
    expect(app).toContain('target.closest("input, textarea, select")');
    expect(app).toContain("target.closest(\"[contenteditable]:not([contenteditable='false'])\")");
    expect(app).toContain("function shouldFocusMessageInputForKey(event)");
    expect(app).toContain("if (event.defaultPrevented || event.isComposing) return false;");
    expect(app).toContain("if (event.metaKey || event.ctrlKey || event.altKey) return false;");
    expect(app).toContain("if (event.key.length !== 1) return false;");
    expect(app).toContain("if (isEditableKeyTarget(event.target)) return false;");
    expect(app).toContain("return Boolean(input && document.activeElement !== input);");
    expect(app).toContain("function focusMessageInputForKey(event)");
    expect(app).toContain('if (event.key === "$" && focusInputPane("shell")) return true;');
    expect(app).toContain("input.setRangeText(event.key, start, end, \"end\");");
    expect(app).toContain('input.dispatchEvent(new Event("input", { bubbles: true }));');
    expect(app).toContain("if (focusMessageInputForKey(event)) return;");
  });

  test("suppresses Cmd+K and clears the shell when the shell pane is focused", () => {
    expect(app).toContain("function handleCommandK(event)");
    expect(app).toContain('event.key.toLowerCase() !== "k"');
    expect(app).toContain("event.preventDefault();");
    expect(app).toContain("event.stopImmediatePropagation();");
    expect(app).toContain('if (focusedInputPaneKind() === "shell") void submitShellCommand("clear");');
    expect(app).toContain('document.addEventListener("keydown", handleCommandK, true);');
  });

  test("toggles the shell pane with Cmd+Backslash", () => {
    expect(app).toContain('const SHELL_PANE_HIDDEN_KEY = "flow.shellPaneHidden";');
    expect(app).toContain("shellPaneHidden: initialBooleanSetting(SHELL_PANE_HIDDEN_KEY)");
    expect(app).toContain("function setShellPaneHidden(hidden)");
    expect(app).toContain("const restoreTerminalBottom = terminalBottomRestorer();");
    expect(app).toContain('document.body.classList.toggle("shell-pane-hidden", hidden);');
    expect(app).toContain('const shellPanel = els.flowPane.querySelector(".shell-command-panel");');
    expect(app).toContain('if (shellPanel) shellPanel.setAttribute("aria-hidden", String(hidden));');
    expect(app).toContain('if (hidden && focusedInputPaneKind() === "shell") focusInputPane("prompt");');
    expect(app).toContain("renderShellOutputPane(state.selectedFlowId);");
    expect(app).toContain("restoreTerminalBottom();");
    expect(app).toContain("function toggleShellPaneHidden()");
    expect(app).toContain("function revealShellPaneForInputFocus()");
    expect(app).toContain("setShellPaneHidden(false);\n  focusInputPane(\"shell\");");
    expect(app).not.toContain("shell-pane-instant-reveal");
    expect(app).not.toContain("scrollRestoreDurationMs: 0");
    expect(app).toContain("function handlePaneVisibilityShortcuts(event)");
    expect(app).toContain('event.code === "Backslash" || key === "\\\\"');
    expect(app).toContain('document.addEventListener("keydown", handlePaneVisibilityShortcuts, true);');
    expect(app).toContain("const hasGroups = Boolean(groups.length);");
    expect(app).not.toContain("function preserveTerminalScrollTopDuringLayout");
    expect(app).not.toContain("function freezeTerminalLayoutForPaneAnimation");
    expect(app).not.toContain("function terminalScrollTopPreserverForPaneLayout");
    expect(app).toContain("function terminalBottomRestorer()");
    expect(app).toContain("const distanceFromBottom = terminalDistanceFromBottom(terminal);");
    expect(app).toContain("if (terminalAtLatest(terminal))");
    expect(app).toContain("terminal.scrollTop = terminal.scrollHeight;");
    expect(app).toContain("const anchor = terminalBottomTextAnchor(terminal);");
    expect(app).toContain("function terminalBottomTextAnchor(terminal)");
    expect(app).toContain("document.createTreeWalker(terminal, NodeFilter.SHOW_TEXT");
    expect(app).toContain("function terminalTextAnchorBottom(anchor)");
    expect(app).toContain("terminal.scrollTop += anchorBottom - anchor.bottom;");
    expect(app).toContain("terminal.scrollTop = terminal.scrollHeight - terminal.clientHeight - distanceFromBottom;");
    expect(app).not.toContain("[shell-pane-layout]");
    expect(app).toContain('if (kind === "shell" && state.shellPaneHidden) return false;');
    expect(app).toContain("if (state.shellPaneHidden) promptInput()?.focus();\n    else shellInput()?.focus();");
    expect(css).toContain("body.shell-pane-hidden .prompt-input-pane {\n  padding-right: 14px;\n}");
    expect(css).toContain("body.shell-pane-hidden .shell-command-panel {\n  opacity: 0;");
    expect(css).toContain("--shell-pane-size: 0px !important;");
    expect(css).toContain("--shell-resizer-size: 0px;");
    expect(css).toContain("body.shell-pane-hidden .terminal-panel.shell-output-visible");
    expect(css).toContain("body.shell-pane-hidden .terminal-panel.shell-output-visible .shell-output-resizer,\nbody.shell-pane-hidden .shell-output-pane {\n  opacity: 0;");
    expect(css).not.toContain("terminal-layout-frozen");
    expect(css).toContain("overflow-anchor: none;");
    expect(css).not.toContain("shell-pane-instant-reveal");
  });

  test("supports separate reverse search histories for prompts and shell commands", () => {
    expect(app).toContain('const PROMPT_HISTORY_KEY = "flow.promptHistory";');
    expect(app).toContain('const SHELL_HISTORY_KEY = "flow.shellHistory";');
    expect(app).toContain("const MAX_INPUT_HISTORY_ITEMS = 200;");
    expect(app).toContain("function initialInputHistory(key)");
    expect(app).toContain("promptHistory: initialInputHistory(PROMPT_HISTORY_KEY)");
    expect(app).toContain("shellHistory: initialInputHistory(SHELL_HISTORY_KEY)");
    expect(app).toContain("promptHistoryOrder: new Map()");
    expect(app).toContain("shellHistoryOrder: new Map()");
    expect(app).toContain("ticketInputStates: new Map()");
    expect(app).toContain('activeInputIssueId: ""');
    expect(app).toContain("historySearch: null");
    expect(app).toContain("historyNavigation: null");
    expect(app).toContain("function emptyTicketInputState()");
    expect(app).toContain('promptValue: ""');
    expect(app).toContain('shellValue: ""');
    expect(app).toContain("function inputHistoryMode(input = document.activeElement)");
    expect(app).toContain('return input?.classList?.contains("shell-input") ? "shell" : "prompt";');
    expect(app).toContain("function rememberInputHistory(value, mode = inputHistoryMode(), orderValue = Date.now())");
    expect(app).toContain("function shouldRememberInputHistoryItem(item, mode)");
    expect(app).toContain('return !(mode === "prompt" && item.startsWith("/"));');
    expect(app).toContain("if (!shouldRememberInputHistoryItem(item, mode)) return;");
    expect(app).toContain("function rememberLogHistory(log)");
    expect(app).toContain("function inputHistoryOrder(mode = inputHistoryMode())");
    expect(app).toContain("function inputHistoryLogOrder(log)");
    expect(app).toContain('const timestamp = Date.parse(log.createdAt || "");');
    expect(app).toContain("return timestamp + id / 1_000_000;");
    expect(app).toContain("function sortInputHistory(mode = inputHistoryMode())");
    expect(app).toContain("history.sort((a, b) => (order.get(b) ?? 0) - (order.get(a) ?? 0));");
    expect(app).toContain("if ((order.get(item) ?? -Infinity) <= orderValue) order.set(item, orderValue);");
    expect(app).toContain("sortInputHistory(mode);");
    expect(app).toContain("const order = inputHistoryLogOrder(log);");
    expect(app).toContain('if (normalized.source === "user") rememberInputHistory(normalized.message, "prompt", order);');
    expect(app).toContain('if (normalized.source === "shell:command") rememberInputHistory(normalized.message, "shell", order);');
    expect(app).toContain("rememberLogHistory(log);");
    expect(app).toContain("const existingIndex = history.indexOf(item);");
    expect(app).toContain("if (existingIndex < 0) history.push(item);");
    expect(app).toContain("history.splice(MAX_INPUT_HISTORY_ITEMS);");
    expect(app).toContain("function matchingInputHistory(query, mode = inputHistoryMode())");
    expect(app).toContain("item.toLowerCase().includes(needle)");
    expect(app).toContain("function cloneHistorySearch(search)");
    expect(app).toContain("matches: [...(search.matches || [])]");
    expect(app).toContain("function cloneHistoryNavigation(navigation)");
    expect(app).toContain("function ticketInputState(issueId)");
    expect(app).toContain("state.ticketInputStates.set(issueId, emptyTicketInputState())");
    expect(app).toContain("function saveActiveTicketInputState()");
    expect(app).toContain("inputState.promptValue = messageInput.value;");
    expect(app).toContain("inputState.shellValue = commandInput.value;");
    expect(app).toContain("inputState.historySearch = cloneHistorySearch(state.historySearch);");
    expect(app).toContain("inputState.historyNavigation = cloneHistoryNavigation(state.historyNavigation);");
    expect(app).toContain("function restoreTicketInputState(issueId)");
    expect(app).toContain("messageInput.value = inputState.promptValue;");
    expect(app).toContain("commandInput.value = inputState.shellValue;");
    expect(app).toContain("state.historySearch = cloneHistorySearch(inputState.historySearch);");
    expect(app).toContain("state.historyNavigation = cloneHistoryNavigation(inputState.historyNavigation);");
    expect(app).toContain("function syncTicketInputState(issueId)");
    expect(app).toContain("if (state.activeInputIssueId === nextIssueId) return;");
    expect(app).toContain("saveActiveTicketInputState();\n  state.activeInputIssueId = nextIssueId;\n  restoreTicketInputState(nextIssueId);");
    expect(app).toContain("syncTicketInputState(issueId);");
    expect(app).toContain("function renderHistorySearchIndicator()");
    expect(app).toContain('form?.classList.toggle("history-searching", Boolean(search));');
    expect(app).toContain('indicator.setAttribute("aria-hidden", String(!search));');
    expect(app).toContain("const shouldFollowLatest = !state.terminalFollowPaused && terminalAtLatest(terminal);");
    expect(app).toContain("applyFlowSplitSize();");
    expect(app).toContain("if (shouldFollowLatest) followTerminalToLatestDuringLayout(terminal, 160);");
    expect(app).toContain('indicator.dataset.mode = "";');
    expect(app).toContain("indicator.dataset.mode = search.mode;");
    expect(app).toContain('indicator.innerHTML = `<strong>${label}</strong> bck-i-search: ${escapeHtml(search.query)}_${resultText}`;');
    expect(app).toContain("function scrollTerminalToLatestNow(terminal)");
    expect(app).toContain("function followTerminalToLatestDuringLayout(terminal, durationMs)");
    expect(app).toContain("applyFlowSplitSize();");
    expect(app).toContain("if (now - startedAt < durationMs) requestAnimationFrame(follow);");
    expect(app).toContain("function startOrAdvanceHistorySearch(input)");
    expect(app).toContain('query: "",');
    expect(app).toContain("draft: input.value");
    expect(app).toContain("matches: []");
    expect(app).toContain("search.matches = search.query ? matchingInputHistory(search.query, search.mode) : [];");
    expect(app).toContain("state.historySearch.index = Math.min(state.historySearch.index + 1, state.historySearch.matches.length - 1);");
    expect(app).toContain("function moveHistorySearchForward(input)");
    expect(app).toContain("search.index = Math.max(search.index - 1, 0);");
    expect(app).toContain("function resetInputHistoryNavigation()");
    expect(app).toContain("state.historyNavigation = null;");
    expect(app).toContain("function updateInputHistoryNavigation(input, direction)");
    expect(app).toContain("const history = inputHistory(mode);");
    expect(app).toContain("if (direction < 0) return false;");
    expect(app).toContain("draft: input.value");
    expect(app).toContain("const value = nextIndex === -1 ? state.historyNavigation.draft : history[nextIndex];");
    expect(app).toContain("hideSlashMenu();");
    expect(app).toContain("function inputCaretOnFirstLine(input)");
    expect(app).toContain('return !input.value.slice(0, start).includes("\\n");');
    expect(app).toContain("function inputCaretOnLastLine(input)");
    expect(app).toContain('return !input.value.slice(end).includes("\\n");');
    expect(app).toContain("function handleInputHistoryNavigationKeydown(event)");
    expect(app).toContain('if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;');
    expect(app).toContain('const direction = event.key === "ArrowUp" ? 1 : -1;');
    expect(app).toContain("if (direction > 0 && !inputCaretOnFirstLine(input)) return false;");
    expect(app).toContain("if (direction < 0 && !state.historyNavigation && !inputCaretOnLastLine(input)) return false;");
    expect(app).toContain("if (!updateInputHistoryNavigation(input, direction)) return false;");
    expect(app).toContain("function handleHistorySearchKeydown(event)");
    expect(app).toContain("function setInputMode(mode)");
    expect(app).toContain('focusInputPane(mode === "command" || mode === "shell" ? "shell" : "prompt");');
    expect(app).toContain("input.focus({ preventScroll: true });");
    expect(app).toContain("cancelHistorySearch();\n  resetInputHistoryNavigation();\n  saveActiveTicketInputState();\n  input.focus({ preventScroll: true });");
    expect(app).toContain("focusInputPane(\"prompt\");");
    expect(app).toContain("function canSwitchInputPane()");
    expect(app).toContain("const ticket = selectedTicket();");
    expect(app).not.toContain("selectedLinearTicket");
    expect(app).toContain("function handleInputPaneTabKeydown(event)");
    expect(app).toContain("if (event.defaultPrevented) return false;");
    expect(app).toContain('if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;');
    expect(app).toContain("if (!canSwitchInputPane()) return false;");
    expect(app).toContain("event.preventDefault();\n  if (event.repeat) return true;");
    expect(app).toContain('if (focusedInputPaneKind() === "prompt" && state.shellPaneHidden) {');
    expect(app).toContain("revealShellPaneForInputFocus();");
    expect(app).toContain("toggleFocusedInputPane();");
    expect(app).toContain('shellInput().addEventListener("keydown"');
    const messageInputKeydown = app.slice(app.indexOf('promptInput().addEventListener("keydown"'));
    expect(messageInputKeydown).toContain("if (handleInputHistoryNavigationKeydown(event)) return;");
    expect(messageInputKeydown).toContain("if (handleInputPaneTabKeydown(event)) return;");
    expect(messageInputKeydown.indexOf("selectSlashCommand();")).toBeLessThan(
      messageInputKeydown.indexOf("handleInputHistoryNavigationKeydown(event)"),
    );
    expect(messageInputKeydown.indexOf("handleInputPaneTabKeydown(event)")).toBeLessThan(
      messageInputKeydown.indexOf("handleInputHistoryNavigationKeydown(event)"),
    );
    const globalKeydown = app.slice(app.indexOf('document.addEventListener("keydown"'));
    expect(globalKeydown).toContain("if (handleInputPaneTabKeydown(event)) return;");
    expect(app).toContain('event.ctrlKey && event.key.toLowerCase() === "r"');
    expect(app).toContain('event.ctrlKey && event.key.toLowerCase() === "z"');
    expect(app).toContain("if (!state.historySearch) return false;");
    expect(app).toContain('if (event.key === "ArrowLeft" || event.key === "ArrowRight") {\n    cancelHistorySearch();\n    return false;\n  }');
    expect(app).toContain('if (event.key === "Escape") {\n    cancelHistorySearch();\n    return true;\n  }');
    expect(app).toContain('if (event.key === "Tab") {\n    event.preventDefault();\n    cancelHistorySearch();\n    return true;\n  }');
    expect(app).toContain("updateHistorySearchMatches(input, state.historySearch.query + event.key);");
    expect(app).toContain("function handleGlobalHistorySearchKeydown(event)");
    expect(app).toContain("if (isEditableKeyTarget(event.target)) return false;");
    expect(app).toContain("if (handleGlobalHistorySearchKeydown(event)) return;");
    expect(app).toContain("if (handleHistorySearchKeydown(event)) return;");
    expect(app).toContain("renderSlashMenu();\n  saveActiveTicketInputState();");
    expect(app).toContain("resetInputHistoryNavigation();\n  saveActiveTicketInputState();");
    expect(app).toContain('rememberInputHistory(command, "shell");');
    expect(app).toContain('rememberInputHistory(message, "prompt");');
    expect(app).toContain("cancelHistorySearch();");
  });

  test("supports fast slash command as a toggle", () => {
    expect(server).toContain('type ReasoningEffort = "low" | "medium" | "high" | "xhigh";');
    expect(server).toContain('type ServiceTier = "fast" | "flex";');
    expect(server).toContain("const reasoningEfforts = new Set<ReasoningEffort>");
    expect(server).toContain("const serviceTiers = new Set<ServiceTier>");
    expect(server).toContain("function codexThreadOverrides(flow: Flow)");
    expect(server).toContain("function codexTurnOverrides(flow: Flow)");
    expect(server).toContain("function configuredAgentMetadata(flow: Flow): Partial<Flow>");
    expect(server).toContain("...codexThreadOverrides(flow),");
    expect(server).toContain("...codexTurnOverrides(flow),");
    expect(server).toContain("function slashCommandArgs(message: string)");
    expect(server).toContain('if (command === "/effort")');
    expect(server).toContain('if (command === "/model")');
    expect(server).toContain('updateFlow(flow.id, { agentReasoningEffort: reasoningEffort });');
    expect(server).toContain('updateFlow(flow.id, { agentModel: model });');
    expect(server).toContain('if (command === "/fast")');
    expect(server).toContain('const serviceTier = flow.agentServiceTier === "fast" ? "" : "fast";');
    expect(server).toContain("updateFlow(flow.id, { agentServiceTier: serviceTier });");
    expect(server).toContain('insertLog(flow.id, "agent:status", serviceTier ? "fast mode enabled" : "fast mode disabled");');
    expect(server).not.toContain('Unknown fast mode');
    expect(server).not.toContain('mode === "flex"');
    expect(server).not.toContain('mode === "off"');
  });

  test("auto-approves sandboxed agent approvals", () => {
    expect(server).toContain('approvalPolicy: "on-failure"');
    expect(server).toContain('approvalsReviewer: "auto_review"');
    expect(server).toContain('sandbox: "danger-full-access"');
    expect(server).toContain('sandboxPolicy: { type: "dangerFullAccess" }');
    expect(server).toContain('decision: "acceptForSession"');
    expect(server).toContain('decision: "approved_for_session"');
    expect(server).toContain('scope: "session"');
    expect(server).not.toContain('sandbox: "workspace-write"');
    expect(server).not.toContain('approvalPolicy: "never"');
    expect(server).not.toContain("does not expose approval UI yet");
  });
});
