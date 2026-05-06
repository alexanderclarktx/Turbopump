import { describe, expect, test } from "bun:test";

const html = await Bun.file("public/index.html").text();
const app = await Bun.file("public/app.js").text();
const css = await Bun.file("public/styles.css").text();
const server = await Bun.file("src/server.ts").text();
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
    expect(html).toContain('<body class="settings-collapsed">');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="settings-collapsed-icon"');
    expect(css).toContain(".settings-collapsed-icon");
    expect(css).toContain("body.settings-collapsed .settings-collapsed-icon");
    expect(css).toContain("body.settings-collapsed .settings-toggle");
    expect(css).toContain("padding: 14px 0;");
    expect(css).toContain("body.settings-collapsed .settings-header {\n  display: grid;");
    expect(css).toContain("gap: 0;");
    expect(css).toContain("justify-self: center;");
    expect(css).toContain("grid-template-columns: 26px 320px minmax(0, 1fr);");
    expect(css).toContain("width: 26px;");
  });

  test("hides the Linear tickets pane on narrow screens", () => {
    expect(css).toContain("@media (max-width: 980px)");
    expect(css).toContain("  .ticket-drawer {\n    display: none;\n  }");
    expect(css).not.toContain("max-height: 360px;");
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

  test("keeps the Settings heading larger than section headings", () => {
    expect(css).toContain(".settings-header h2 {\n  margin: 0;\n  color: var(--ink);\n  font-size: 22px;");
    expect(css).toContain(".settings-content h2 {\n  margin: 0;\n  color: var(--ink);\n  font-size: 14px;");
    expect(css).not.toContain(".sidebar h2 {\n  margin: 0;\n  font-size: 14px;");
  });

  test("defaults settings closed unless Linear is disconnected", () => {
    expect(app).toContain("settingsCollapsed: true");
    expect(app).not.toContain('localStorage.getItem("flow.settingsCollapsed")');
    expect(app).not.toContain('localStorage.setItem("flow.settingsCollapsed"');
    expect(app).toContain("function setDefaultSettingsState(linear)");
    expect(app).toContain("setSettingsCollapsed(Boolean(linear.signedIn));");
    expect(app.indexOf("setDefaultSettingsState(data.linear);")).toBeLessThan(
      app.indexOf("updateLinearState(data.linear);"),
    );
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
    expect(css).toContain("body.theme-dark .terminal-entry-user .terminal-entry-marker");
    expect(css).toContain("body.theme-dark .terminal-entry-user .terminal-entry-label");
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
    expect(html).toContain('<section class="development-settings" hidden>');
    expect(html).toContain("<h2>Development</h2>");
    expect(css).toContain("[hidden] {\n  display: none !important;");
  });

  test("exposes agent developer instructions in Settings", () => {
    expect(html).toContain('<section class="agent-settings">');
    expect(html).toContain("<h2>Agents</h2>");
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
    expect(server).toContain("Flow stages are: planning -> working -> reviewing -> done.");
    expect(server).toContain("flowMetaApiUrl");
    expect(server).toContain('Example body: {"stage":"reviewing","prUrl":"https://github.com/org/repo/pull/123"}');
    expect(server).toContain("Each field in the body is optional.");
    expect(server).toContain("stage: flow.stage,");
    expect(server).toContain("prUrl: flow.prUrl,");
  });

  test("shows checkout cleanup cards in Settings without deleting traces", () => {
    expect(html).toContain('<section class="checkout-settings">');
    expect(html).toContain("<h2>Checkouts</h2>");
    expect(html).toContain('id="checkoutList"');
    expect(app).toContain("checkouts: []");
    expect(app).toContain("checkoutsLoaded: false");
    expect(app).toContain("checkoutsLoading: false");
    expect(app).toContain("checkoutList: document.querySelector");
    expect(app).toContain("function renderCheckouts()");
    expect(app).toContain("function renderCheckoutCard(checkout)");
    expect(app).toContain("function ensureCheckoutsLoaded()");
    expect(app).toContain("void ensureCheckoutsLoaded();");
    expect(app).toContain("state.checkoutsLoading = true;");
    expect(app).toContain("function renderLinearStatusIcon(status)");
    expect(app).toContain('<img src="/status-icons/${kind}.svg" alt="" aria-hidden="true" />');
    expect(app).toContain('["Linear", renderLinearStatusIcon(checkout.linearStatus)]');
    expect(app).toContain("function deleteCheckout(name)");
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
    expect(server).toContain("function listCheckouts()");
    expect(server).toContain("Date.parse(a.lastPromptAt || a.createdAt || \"\")");
    expect(server).toContain("async function refreshCheckoutLinearStatuses()");
    expect(server).toContain("await refreshCheckoutLinearStatuses();");
    expect(server).toContain("latestPromptTimestamp(flow.id)");
    expect(server).toContain('url.pathname === "/api/checkouts"');
    expect(server).toContain('parts[0] === "api" && parts[1] === "checkouts"');
    expect(server).toContain("function deleteCheckout(name: string)");
    expect(server).toContain("rmSync(target, { recursive: true, force: true });");
  });

  test("keeps refresh buttons visually quiet", () => {
    expect(html).toContain('id="refreshLinearTickets"');
    expect(html).toContain('id="resetAgentDeveloperInstructions"');
    expect(css).toContain(".ticket-drawer-header #refreshLinearTickets {\n  width: 28px;\n  min-width: 28px;\n  min-height: 28px;\n  flex: 0 0 28px;\n  margin-left: auto;\n  margin-right: -5px;\n}");
    expect(css).toContain("#refreshLinearTickets,\n#resetAgentDeveloperInstructions {\n  border-color: transparent;\n  background: transparent;\n}");
    expect(css).toContain("#refreshLinearTickets {\n  color: var(--muted);\n}");
    expect(css).toContain("#refreshLinearTickets:hover,\n#resetAgentDeveloperInstructions:hover");
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

  test("disables the Agent pane until the repo URL is configured", () => {
    expect(html).toContain('<div class="agent-disabled-message">Configure the repo URL to use the agent.</div>');
    expect(app).toContain("function repoUrlConfigured()");
    expect(app).toContain("const agentEnabled = repoUrlConfigured();");
    expect(app).toContain('agentPanel.classList.toggle("disabled", !agentEnabled);');
    expect(app).toContain("agentInterrupt.disabled = state.interruptSubmitting || !agentEnabled || (!agentRunning && (!flow && !ticket));");
    expect(app).toContain(
      'state.messageSubmitting || state.agentImageUploading || agentRunning || !agentEnabled || (!flow && !ticket);',
    );
    expect(app).toContain("renderFlowPane();\n});");
    expect(css).toContain(".agent-disabled-message");
    expect(css).toContain(".agent-panel.disabled .agent-disabled-message {\n  display: grid;");
    expect(css).toContain(".agent-panel.disabled .terminal,\n.agent-panel.disabled .message-form {\n  display: none;");
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
    expect(server).toContain('const branch = `turbo/${safeSlug(issueId)}`;');
    expect(server).not.toContain('const branch = `flow/${safeSlug(issueId)}`;');
    expect(server).not.toContain('const branch = `flow/${safeSlug(issueId)}-${flowId.slice(0, 8)}`;');
  });

  test("uses a warmed repo checkout when creating flow checkouts", () => {
    expect(server).toContain('const repoCheckoutDir = join(dataDir, "repo");');
    expect(server).toContain("function ensureRepoCheckout(repoUrl: string)");
    expect(server).toContain('runGit(["clone", repoUrl, repoCheckoutDir]);');
    expect(server).toContain('runGit(["remote", "get-url", "origin"], repoCheckoutDir);');
    expect(server).toContain("rmSync(repoCheckoutDir, { recursive: true, force: true });");
    expect(server).toContain('runGit(["pull", "--ff-only"], repoCheckoutDir);');
    expect(server).toContain("ensureRepoCheckout(repoUrl);");
    expect(server).toContain("cpSync(repoCheckoutDir, target, { recursive: true, force: false, errorOnExist: true });");
    expect(server).not.toContain('runGit(["clone", repoUrl, target]);');
  });

  test("trusts flow checkouts before starting the Codex app server", () => {
    expect(server).toContain("function ensureCodexProjectTrusted(projectPath: string)");
    expect(server).toContain('const codexHome = codexEnv.CODEX_HOME || process.env.CODEX_HOME || join(homedir(), ".codex");');
    expect(server).toContain('const header = `[projects.${tomlBasicString(resolve(projectPath))}]`;');
    expect(server).toContain('appendFileSync(configPath, `${prefix}\\n${header}\\ntrust_level = "trusted"\\n`, "utf8");');
    expect(server).toContain('Bun.spawn(["/bin/zsh", "-lc", command], {');
    expect(server).toContain("function repairFlowCheckoutPath(flow: Flow)");
    expect(server).toContain("const activeFlow = repairFlowCheckoutPath(flow);");
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

  test("keeps ticket status out of cards and pins id to the card corner", () => {
    expect(app).not.toContain('class="ticket-status"');
    expect(app).toContain('class="ticket-meta"');
    expect(app).toContain('class="ticket-id"');
    expect(app).toContain('<span class="ticket-id">${escapeHtml(ticket.identifier)}</span>');
    expect(css).not.toContain(".ticket-status {");
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

  test("marks tickets with flows using the favicon instead of a green card tint", () => {
    expect(app).toContain('class="ticket-flow-mark"');
    expect(app).toContain('class="ticket-flow-corner"');
    expect(app).toContain('<span class="ticket-stage">${stageName}</span>');
    expect(app).toContain('${stageName ? `<span class="ticket-stage">${stageName}</span>` : ""}<img class="ticket-flow-mark" src="/favicon.svg" alt="In flow" title="In flow">');
    expect(css).toContain(".ticket-flow-mark");
    expect(css).toContain(".ticket-flow-corner");
    expect(css).not.toContain(".ticket-card.in-flow {\n  border-color:");
    expect(css).not.toContain(".ticket-card.in-flow:hover");
  });

  test("grows the ticket favicon smoothly while the agent is in a turn", () => {
    expect(app).toContain("function ticketAgentWorking(ticket)");
    expect(app).toContain('flow.agentStatus === "running"');
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

  test("renders Markdown headings, inline formatting, and code blocks in Linear and Agent panes", () => {
    expect(app).toContain('import { renderInlineMarkdown, renderLinearMarkdown } from "./linear-markdown.js";');
    expect(app).toContain("function usesTerminalBlockMarkdown(source)");
    expect(app).toContain('["user", "agent", "agent:message", "agent:thinking", "agent:reasoning"].includes(source)');
    expect(app).toContain('document.createElement(usesTerminalBlockMarkdown(group.source) ? "div" : "pre")');
    expect(app).toContain('renderLinearMarkdown(message, "", { images: false, links: true })');
    expect(app).not.toContain("body.textContent = formatTerminalMessage(group.source, group.message);");
    expect(css).toContain(".linear-markdown h1,");
    expect(css).toContain("margin: 6px 0 2px;");
    expect(css).toContain(".linear-markdown a,\n.terminal-entry-body a");
    expect(css).toContain(".linear-markdown ul,\n.linear-markdown ol {\n  margin: 4px 0 4px 18px;");
    expect(css).toContain(".terminal-entry-body ul,\n.terminal-entry-body ol {\n  margin: 4px 0;\n  padding-left: 3ch;");
    expect(css).toContain(".terminal-entry-body ul {\n  padding-left: 2ch;");
    expect(css).toContain(".terminal-entry-body li > ul,\n.terminal-entry-body li > ol {\n  margin: 2px 0;\n  padding-left: 4ch;");
    expect(css).toContain(".linear-markdown li,\n.terminal-entry-body li");
    expect(css).toContain(".linear-markdown code,\n.terminal-entry-body code");
    expect(markdown).toContain("<strong>");
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
    expect(app).toContain("function syncLinearTicketsWithFlows()");
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
    expect(html).toContain('<a class="agent-context-branch"></a>');
    expect(html).not.toContain('class="agent-context-phase"');
    expect(app).toContain("function agentModelLabel(flow)");
    expect(app).toContain("function agentContextWindowLabel(flow)");
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
    expect(app).toContain("const stageName = ticket.flowStage ? escapeHtml(ticket.flowStage) : \"\";");
    expect(app).not.toContain("titleCase");
    expect(app).toContain("renderAgentContext(flow);");
    expect(css).toContain("grid-template-columns: auto minmax(0, 1fr) auto;");
    expect(css).not.toContain(".agent-context-window::before");
    expect(css).not.toContain('content: "context ";');
    expect(css).not.toContain(".agent-context-model::before");
    expect(css).not.toContain('content: "model ";');
    expect(css).not.toContain(".agent-context-branch::before");
    expect(css).not.toContain('content: "branch ";');
    expect(css).not.toContain(".agent-context-phase");
    expect(css).not.toContain('content: "phase ";');
    expect(css).toContain("--link: #2563eb;");
    expect(css).toContain("--link: #60a5fa;");
    expect(css).toContain(".agent-context a[href] {\n  color: var(--link);\n}");
    expect(css).not.toContain(".agent-context a[href]:hover");
    expect(css).toContain("border-left: 1px solid var(--line-strong);");
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

  test("refreshes the displayed checkout branch after each agent turn", () => {
    expect(server).toContain("function checkoutBranchUpdate(flowId: string): Partial<Flow>");
    expect(server).toContain('runGit(["rev-parse", "--abbrev-ref", "HEAD"], flow.checkoutPath);');
    expect(server).toContain("branchName && branchName !== flow.branchName ? { branchName } : {}");
    expect(server).toContain('insertLog(flowId, "agent:status", `could not read checkout branch: ${String(error)}`);');
    expect(server).toContain("...checkoutBranchUpdate(runtime.flowId),");
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
    expect(html).toContain('class="agent-interrupt icon-button"');
    expect(html).toContain('aria-label="Pause agent"');
    expect(html).toContain('class="agent-image-context" aria-label="Attached image context" hidden');
    expect(html).not.toContain('class="agent-image-drop-overlay"');
    expect(html).toContain('class="history-search-indicator" aria-live="polite" aria-hidden="true"');
    expect(html).toContain('class="slash-menu" role="listbox" hidden');
    expect(html).not.toContain('class="agent-working" aria-live="polite" hidden');
    expect(html).not.toContain("<span>working</span>");
    expect(html).toContain('<textarea class="message-input" placeholder="Prompt the agent" rows="1"></textarea>');
    expect(html).toContain('<path d="M9 6v12" />');
    expect(html).toContain('<path d="M15 6v12" />');
    expect(html.indexOf('class="terminal"')).toBeLessThan(html.indexOf('class="message-form"'));
    expect(app).not.toContain("agentStart.addEventListener");
    expect(app).toContain("agentInterrupt.disabled = state.interruptSubmitting || !agentEnabled || (!agentRunning && (!flow && !ticket));");
    expect(app).toContain("function agentWorkingForFlow(flow)");
    expect(app).toContain("const AGENT_WORKING_POLL_INTERVAL_MS = 2500;");
    expect(app).toContain("function syncAgentWorkingPoll(flowId, agentWorking)");
    expect(app).toContain("function pollAgentWorkingFlow()");
    expect(app).toContain('const data = await api(`/api/flows/${flowId}/agent/status`);');
    expect(app).toContain('block.className = "terminal-entry terminal-entry-working";');
    expect(app).toContain('body.className = "terminal-entry-body agent-working";');
    expect(app).toContain('dots.setAttribute("aria-label", "Agent working");');
    expect(app).toContain("syncAgentWorkingPoll(id, agentWorking);");
    expect(app).toContain("if (agentWorking) appendTerminalWorkingBlock(fragment);");
    expect(app).not.toContain('els.flowPane.querySelector(".agent-working").hidden = !agentWorking;');
    expect(app).toContain("if (state.interruptSubmitting) return;");
    expect(app).toContain("state.interruptSubmitting = true;");
    expect(app).toContain(
      'state.messageSubmitting || state.agentImageUploading || agentRunning || !agentEnabled || (!flow && !ticket);',
    );
    expect(app).toContain("async function uploadAgentImages(files)");
    expect(app).toContain("function eventHasDraggedFiles(event)");
    expect(app).toContain("function setAgentImageDragActive(active)");
    expect(app).toContain('await api(`/api/flows/${encodeURIComponent(flow.id)}/context-images`,');
    expect(app).toContain("function agentMessageWithImages(message)");
    expect(app).toContain('document.addEventListener("drop"');
    expect(css).not.toContain(".agent-image-drop-overlay");
    expect(server).toContain("async function saveFlowContextImages(flow: Flow, formData: FormData)");
    expect(server).toContain('parts[3] === "context-images" && request.method === "POST"');
    expect(app).toContain("if (state.messageSubmitting) return;");
    expect(app).toContain("state.messageSubmitting = true;");
    expect(app).toContain("const flow = await ensureSelectedFlow();");
    expect(app).toContain('await api(`/api/flows/${flow.id}/message`, {');
    expect(app).toContain("/agent/interrupt");
    expect(server).toContain("const agentHeartbeatSweepIntervalMs = 5000;");
    expect(server).toContain("function reconcileAgentHeartbeat(flow: Flow");
    expect(server).toContain('flow.agentStatus !== "running" && flow.agentStatus !== "interrupting"');
    expect(server).toContain('insertLog(flow.id, "agent:error", "agent runtime disappeared while status was running\\n");');
    expect(server).toContain("setInterval(sweepAgentHeartbeats, agentHeartbeatSweepIntervalMs);");
    expect(server).toContain('parts[3] === "agent" && parts[4] === "status" && request.method === "GET"');
    expect(server).toContain("turnRunning: Boolean(agentProcesses.get(id)?.activeTurnId)");
    expect(app).not.toContain("agentActionIcon");
    expect(css).toContain("[hidden] {\n  display: none !important;");
    expect(css).toContain("grid-template-columns: auto minmax(0, 1fr) auto;");
    expect(css).toContain("grid-template-rows: minmax(0, 1fr) auto;");
    expect(css).toContain("border-top: 1px solid var(--line);");
    expect(css).toContain(".agent-working");
    expect(css).not.toContain("padding: 0 14px 6px;");
    expect(css).toContain("@keyframes agent-working-dot");
    expect(css).toContain(".message-input {\n  min-width: 0;\n  min-height: 36px;");
    expect(css).toContain("max-height: min(220px, 30vh);");
    expect(css).toContain("resize: none;");
    expect(css).toContain("overflow-y: auto;");
    expect(css).toContain(".history-search-indicator");
    expect(css).toContain(".message-form.history-searching");
    expect(css).toContain("max-height 120ms ease");
    expect(css).toContain(".message-form.history-searching .history-search-indicator");
    expect(css).toContain("bottom: calc(100% - 4px);");
    expect(css).toContain(".slash-menu");
    expect(css).toContain("grid-template-columns: minmax(128px, max-content) minmax(0, 1fr);");
    expect(css).toContain(".slash-command-name {\n  min-width: 0;");
    expect(css).toContain("white-space: nowrap;");
    expect(css).toContain(".agent-interrupt:disabled");
    expect(css).not.toContain(".agent-start svg");
    expect(server).toContain('"turn/interrupt"');
    expect(server).toContain("async function interruptAgent");
    expect(server).not.toContain("agent stopped by Turbopump");
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
    expect(app).toContain('const FLOW_SPLIT_SIZE_KEY = "flow.topPaneSize";');
    expect(app).toContain("function flowSplitBounds(content, rect)");
    expect(app).toContain("const minTopPx = 0;");
    expect(app).not.toContain('linearDetail?.querySelector(".linear-meta")');
    expect(app).toContain('content.querySelector(".message-form")');
    expect(app).toContain("function setFlowSplitSize(value)");
    expect(app).toContain('content.style.setProperty("--top-pane-size"');
    expect(css).toContain(".agent-panel {\n  position: relative;\n  overflow: hidden;\n}");
    expect(css).toContain(".terminal {\n  display: grid;\n  align-content: start;\n  gap: 10px;\n  min-height: 0;");
    expect(css).toContain("background: var(--panel);\n  z-index: 1;");
    expect(app).toContain('els.flowPane.querySelector(".flow-resizer").addEventListener("pointerdown"');
    expect(app).toContain('els.flowPane.querySelector(".flow-resizer").addEventListener("keydown"');
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
    expect(app).toContain('if (meta.tone === "output") block.appendChild(renderOutputDeleteButton(group));');
    expect(app).toContain("function renderOutputDeleteButton(group)");
    expect(app).toContain("function deleteOutputLogGroup(flowId, ids)");
    expect(app).toContain('await api(`/api/flows/${encodeURIComponent(flowId)}/logs`, {');
    expect(app).toContain('if (message.event === "logs-deleted")');
    expect(server).toContain('const allowedSources = new Set(["agent:output", "agent:cmd"]);');
    expect(server).toContain('broadcast("logs-deleted", { flowId, ids: uniqueIds });');
    expect(server).toContain('if (parts[3] === "logs" && request.method === "DELETE")');
    expect(app).not.toContain('renderInlineMarkdown(`$ ${formatTerminalMessage(group.source, group.message)}`');
    expect(css).toContain(".terminal-command-line {\n  display: flex;");
    expect(css).toContain(".terminal-output-delete");
    expect(css).toContain(".terminal-entry-output:hover > .terminal-output-delete");
    expect(css).toContain(".terminal-command-line {\n  display: flex;\n  align-items: baseline;\n  gap: 7px;\n  min-width: 0;\n  font-size: 10px;");
    expect(css).toContain(".terminal-entry-command .terminal-entry-body {\n  flex: 1 1 auto;\n  padding-left: 0;");
    expect(css).toContain(".terminal-entry-command .terminal-entry-body {\n  flex: 1 1 auto;\n  padding-left: 0;\n  font-size: 10px;");
    expect(css).toContain(".terminal-trace-body .terminal-entry-assistant,\n.terminal-trace-body .terminal-entry-assistant .terminal-entry-time,\n.terminal-entry-output,\n.terminal-entry-error {\n  font-size: 10px;");
  });

  test("drains paginated logs on refresh", () => {
    expect(app).toContain("if (flow) await loadLogs(flow.id);");
    expect(app).toContain("void loadAllLogs();");
    expect(app).toContain("function appendLogEntry(log)");
    expect(app).toContain("if (list.some((entry) => entry.id === id)) return false;");
    expect(app).toContain("appendLogEntry(log);");
    expect(app).toContain("appendLogEntry({\n        id,");
    expect(app).toContain("while (true)");
    expect(app).toContain("if (!data.logs.length) break;");
    expect(app).toContain("if (data.logs.length < 1000) break;");
    expect(app).toContain("state.lastLogId.set(id, highestLogId);");
  });

  test("renders logs in chronological order in the Agent pane", () => {
    expect(app).toContain("function scrollTerminalToLatest(terminal)");
    expect(app).toContain("requestAnimationFrame(() =>");
    expect(app).toContain("terminal.scrollTop = terminal.scrollHeight;");
    expect(app).toContain('hour: "numeric"');
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
    expect(server).toContain('insertLog(\n    flowId,\n    "agent:trace-group",');
    expect(server).toContain("const latestUserLogBeforeStmt = db.query(");
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
    expect(app).toContain("function syntheticSteerTraceRanges(logs, existingRanges)");
    expect(app).toContain("function isTurnCompletedLog(log)");
    expect(app).toContain('String(log.message || "").trim() === "agent runtime disappeared while status was running"');
    expect(app).toContain("const runtimeDisappearedTraceRanges = syntheticRuntimeDisappearedTraceRanges(normalizedLogs, persistedTraceRanges);");
    expect(app).toContain("...runtimeDisappearedTraceRanges,");
    expect(app).toContain("...syntheticSteerTraceRanges(normalizedLogs, [...persistedTraceRanges, ...runtimeDisappearedTraceRanges]),");
    expect(app).toContain("function appendTerminalTraceGroup(fragment, group)");
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
    expect(app).toContain('body.className = "terminal-trace-body";');
    expect(css).toContain(".terminal-trace-group");
    expect(css).toContain("user-select: none;");
    expect(css).toContain(".terminal-trace-group:not([open]) > .terminal-trace-summary .terminal-entry-time");
    expect(css).toContain(".terminal-trace-body");
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
    expect(server).toContain(promptLog);
    expect(server.indexOf(promptLog)).toBeLessThan(
      server.indexOf("const runtime = existingRuntime ?? (await startCodexAppServer(updated));"),
    );
  });

  test("supports slash command suggestions and dispatch", () => {
    expect(app).toContain('const SLASH_COMMANDS = [');
    expect(app).toContain('name: "/clear"');
    expect(app).toContain('name: "/compact"');
    expect(app).toContain('name: "/effort"');
    expect(app).toContain('name: "/fast"');
    expect(app).toContain('name: "/model"');
    expect(app).toContain('"/effort": ["xhigh", "high", "medium", "low"].map((effort) => ({');
    expect(app).toContain('"/model": ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"].map((model) => ({');
    expect(app).toContain('description: "",');
    expect(app).toContain("function slashCommandExpansionMatches(query)");
    expect(app).toContain("function slashCommandHasExpansions(commandName)");
    expect(app).toContain("function validSlashCommand(value)");
    expect(app).toContain("if (expansions.length) return expansions;");
    expect(app).toContain("function renderSlashMenu()");
    expect(app).toContain("function selectSlashCommand");
    expect(app).toContain("function resizeMessageInput()");
    expect(app).toContain('const terminal = els.flowPane.querySelector(".terminal");');
    expect(app).toContain("const shouldFollowLatest = !state.terminalFollowPaused && terminalAtLatest(terminal);");
    expect(app).toContain('input.style.height = "auto";');
    expect(app).toContain("input.style.height = `${input.scrollHeight}px`;");
    expect(app).toContain("if (shouldFollowLatest) scrollTerminalToLatest(terminal);");
    expect(app).toContain('if (!query.startsWith("/")) return [];');
    expect(app).toContain(".sort((a, b) => a.name.localeCompare(b.name))");
    expect(app).not.toContain("SLASH_COMMAND_EXPANSIONS[command] = sortSlashCommands(expansions);");
    expect(app).toContain('els.flowPane.querySelector(".message-input").addEventListener("keydown"');
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
    expect(server).toContain('updateFlow(flow.id, { agentStatus: "running" });');
    expect(app).toContain("const agentRunning = flow?.agentStatus === \"running\";");
    expect(app).toContain("state.messageSubmitting || state.agentImageUploading || agentRunning || !agentEnabled || (!flow && !ticket);");
    expect(app).toContain("state.interruptSubmitting || !agentEnabled || (!agentRunning && (!flow && !ticket));");
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
    expect(app).toContain("return Boolean(input && !input.disabled && document.activeElement !== input);");
    expect(app).toContain("function focusMessageInputForKey(event)");
    expect(app).toContain('if (event.key === "$" && state.inputMode === "prompt")');
    expect(app).toContain("input.setRangeText(event.key, start, end, \"end\");");
    expect(app).toContain('input.dispatchEvent(new Event("input", { bubbles: true }));');
    expect(app).toContain("if (focusMessageInputForKey(event)) return;");
  });

  test("supports separate reverse search histories for prompts and shell commands", () => {
    expect(app).toContain('const PROMPT_HISTORY_KEY = "flow.promptHistory";');
    expect(app).toContain('const SHELL_HISTORY_KEY = "flow.shellHistory";');
    expect(app).toContain("const MAX_INPUT_HISTORY_ITEMS = 200;");
    expect(app).toContain("function initialInputHistory(key)");
    expect(app).toContain("promptHistory: initialInputHistory(PROMPT_HISTORY_KEY)");
    expect(app).toContain("shellHistory: initialInputHistory(SHELL_HISTORY_KEY)");
    expect(app).toContain("historySearch: null");
    expect(app).toContain("function inputHistoryMode()");
    expect(app).toContain('return state.inputMode === "command" ? "shell" : "prompt";');
    expect(app).toContain("function rememberInputHistory(value, mode = inputHistoryMode())");
    expect(app).toContain("function rememberLogHistory(log)");
    expect(app).toContain('if (normalized.source === "user") rememberInputHistory(normalized.message, "prompt");');
    expect(app).toContain('if (normalized.source === "shell:command") rememberInputHistory(normalized.message, "shell");');
    expect(app).toContain("rememberLogHistory(log);");
    expect(app).toContain("const existingIndex = history.indexOf(item);");
    expect(app).toContain("history.unshift(item);");
    expect(app).toContain("history.splice(MAX_INPUT_HISTORY_ITEMS);");
    expect(app).toContain("function matchingInputHistory(query, mode = inputHistoryMode())");
    expect(app).toContain("item.toLowerCase().includes(needle)");
    expect(app).toContain("function renderHistorySearchIndicator()");
    expect(app).toContain('form?.classList.toggle("history-searching", Boolean(search));');
    expect(app).toContain('indicator.setAttribute("aria-hidden", String(!search));');
    expect(app).toContain("const shouldFollowLatest = !state.terminalFollowPaused && terminalAtLatest(terminal);");
    expect(app).toContain("applyFlowSplitSize();");
    expect(app).toContain("if (shouldFollowLatest) followTerminalToLatestDuringLayout(terminal, 160);");
    expect(app).toContain('indicator.innerHTML = `<strong>${label}</strong> bck-i-search: ${escapeHtml(search.query)}_${resultText}`;');
    expect(app).toContain("function scrollTerminalToLatestNow(terminal)");
    expect(app).toContain("function followTerminalToLatestDuringLayout(terminal, durationMs)");
    expect(app).toContain("if (now - startedAt < durationMs) requestAnimationFrame(follow);");
    expect(app).toContain("function startOrAdvanceHistorySearch(input)");
    expect(app).toContain('query: "",');
    expect(app).toContain("draft: input.value");
    expect(app).toContain("matches: []");
    expect(app).toContain("search.matches = search.query ? matchingInputHistory(search.query, search.mode) : [];");
    expect(app).toContain("state.historySearch.index = Math.min(state.historySearch.index + 1, state.historySearch.matches.length - 1);");
    expect(app).toContain("function moveHistorySearchForward(input)");
    expect(app).toContain("search.index = Math.max(search.index - 1, 0);");
    expect(app).toContain("function handleHistorySearchKeydown(event)");
    expect(app).toContain("function enterCommandModeFromDollarKey(event)");
    expect(app).toContain('state.inputMode !== "prompt" || event.key !== "$"');
    expect(app).toContain("function setInputMode(mode)");
    expect(app).toContain('setInputMode(state.inputMode === "command" ? "prompt" : "command");');
    expect(app).toContain('commandMode ? "Switch to prompt mode" : "Switch to shell mode"');
    expect(app).toContain("toggleInputMode();");
    expect(app).toContain("if (enterCommandModeFromDollarKey(event)) return;");
    expect(app).toContain('event.ctrlKey && event.key.toLowerCase() === "r"');
    expect(app).toContain('event.ctrlKey && event.key.toLowerCase() === "z"');
    expect(app).toContain("if (!state.historySearch) return false;");
    expect(app).toContain("updateHistorySearchMatches(input, state.historySearch.query + event.key);");
    expect(app).toContain("function handleGlobalHistorySearchKeydown(event)");
    expect(app).toContain("if (isEditableKeyTarget(event.target)) return false;");
    expect(app).toContain("if (handleGlobalHistorySearchKeydown(event)) return;");
    expect(app).toContain("if (handleHistorySearchKeydown(event)) return;");
    expect(app).toContain('const mode = command === null ? "prompt" : "shell";');
    expect(app).toContain("rememberInputHistory(command ?? message, mode);");
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
