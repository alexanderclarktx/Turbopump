import { describe, expect, test } from "bun:test";

const app = await Bun.file("public/app.js").text();
const css = await Bun.file("public/styles.css").text();
const server = await Bun.file("src/server.ts").text();
const packageJson = await Bun.file("package.json").json();

describe("Agent providers", () => {
  test("stores a per-flow provider with a codex default", () => {
    expect(server).toContain('type AgentProviderKind = "codex" | "claude";');
    expect(server).toContain("agentProvider: string;");
    expect(server).toContain("agentProvider text not null default 'codex',");
    expect(server).toContain("tryMigration(\"alter table flows add column agentProvider text not null default 'codex'\");");
    expect(server).toContain('const defaultAgentProviderSettingKey = "defaultAgentProvider";');
    expect(server).toContain("function defaultAgentProviderKind(): AgentProviderKind");
    expect(server).toContain("defaultAgentProviderKind(),");
    expect(server).toContain("function flowProviderKind(flow: Flow): AgentProviderKind");
  });

  test("routes runtime lifecycle calls through the provider interface", () => {
    expect(server).toContain("type AgentProvider = {");
    expect(server).toContain("startRuntime(flow: Flow): Promise<RuntimeProcess>;");
    expect(server).toContain("stop(runtime: RuntimeProcess, reason: string): void;");
    expect(server).toContain("handleSlashCommand(flow: Flow, command: string, message: string, userLogId: number): Promise<boolean>;");
    expect(server).toContain("const agentProviders: Record<AgentProviderKind, AgentProvider> = {");
    expect(server).toContain("runtime = await providerForFlow(updated).startRuntime(updated);");
    expect(server).toContain("await providerForRuntime(runtime).sendTurn(runtime, updated, composeTurnMessage(updated.id, userMessage), userLogId);");
    expect(server).toContain("await providerForRuntime(runtime).interrupt(runtime, flow ?? (getFlow(flowId) as Flow));");
    expect(server).toContain('providerForRuntime(runtime).stop(runtime, "agent environment updated");');
    expect(server).toContain('providerForRuntime(agentRuntime).stop(agentRuntime, "flow deleted");');
  });

  test("keeps codex behavior behind the codex provider", () => {
    expect(server).toContain("const codexProvider: AgentProvider = {");
    expect(server).toContain("async function handleCodexSlashCommand(flow: Flow, command: string, message: string, userLogId: number)");
    expect(server).toContain("startRuntime: (flow) => startCodexAppServer(flow),");
    expect(server).toContain("async function interruptCodexTurn(runtime: RuntimeProcess)");
    expect(server).toContain('await sendCodexRequest(runtime, "turn/interrupt", {');
  });

  test("does not pass ANTHROPIC_API_KEY to the claude runtime", () => {
    expect(server).toContain("function claudeRuntimeEnv(flow: Flow)");
    expect(server).toContain("delete env.ANTHROPIC_API_KEY;");
    expect(server).toContain("env: claudeRuntimeEnv(activeFlow),");
  });

  test("implements the claude provider on the Agent SDK stream", () => {
    expect(packageJson.dependencies["@anthropic-ai/claude-agent-sdk"]).toBeTruthy();
    expect(server).toContain("const claudeProvider: AgentProvider = {");
    expect(server).toContain("async function loadClaudeSdk()");
    expect(server).toContain('const moduleName = ["@anthropic-ai", "claude-agent-sdk"].join("/");');
    expect(server).toContain("async function startClaudeRuntime(flow: Flow)");
    expect(server).toContain("function createClaudeInputQueue()");
    expect(server).toContain("async function streamClaudeMessages(runtime: RuntimeProcess, query: ClaudeQuery)");
    expect(server).toContain("function claudeSessionSettingKey(flowId: string)");
    expect(server).toContain("return `claudeSession:${flowId}`;");
    expect(server).toContain("deleteSettingByKeyStmt.run(claudeSessionSettingKey(flowId));");
  });

  test("maps claude SDK messages into existing agent log sources", () => {
    const handler = server.slice(
      server.indexOf("function handleClaudeMessage(runtime: RuntimeProcess, message: ClaudeSdkMessage)"),
      server.indexOf("async function sendClaudeTurn"),
    );
    expect(handler).toContain('insertLog(runtime.flowId, "agent:message", block.text);');
    expect(handler).toContain('insertLog(runtime.flowId, "agent:message-boundary", "");');
    expect(handler).toContain('insertLog(runtime.flowId, "agent:reasoning", block.thinking);');
    expect(handler).toContain('insertLog(runtime.flowId, "agent:tool", claudeToolUseLabel(block));');
    expect(handler).toContain('insertLog(runtime.flowId, "agent:tool-result", block.is_error ? "failed" : "completed");');
    expect(handler).toContain("setSetting(claudeSessionSettingKey(runtime.flowId), sessionId);");
    expect(handler).toContain("finishClaudeTurn(runtime, message);");
    expect(server).toContain("function claudeTokenUsageMetadata(message: ClaudeSdkMessage): Partial<Flow>");
    expect(server).toContain("function claudeContextWindowMetadata(message: ClaudeSdkMessage): Partial<Flow>");
    expect(server).toContain("function claudeTurnTotalTokens(message: ClaudeSdkMessage)");
    expect(server).toContain('agentTotalTokensUsed: (flowBefore?.agentTotalTokensUsed || 0) + claudeTurnTotalTokens(message),');
    expect(server).toContain("function claudeOauthAccessToken()");
    expect(server).toContain("async function claudeUsageLimits()");
    expect(server).toContain('await fetch("https://api.anthropic.com/api/oauth/usage", {');
    expect(server).toContain("rows.push([claudeUsageLimitLabel(limit), claudeUsageLimitValue(limit)]);");
    expect(server).toContain('tryMigration("alter table flows add column agentTotalTokensUsed integer not null default 0");');
    expect(server).toContain("...claudeContextWindowMetadata(message),");
    expect(server).toContain("if (usage.agentContextTokensUsed) {");
    expect(server).toContain("function finishClaudeTurn(runtime: RuntimeProcess, message: ClaudeSdkMessage)");
    expect(server).toContain("createCompletedTurnTraceGroupAfterLog(runtime.flowId, activeTurnTraceAfterLogId, turnStatusLogId + 1);");
  });

  test("routes slash commands through the active provider", () => {
    const slashRouter = server.slice(
      server.indexOf("async function handleSlashCommand(flow: Flow, message: string)"),
      server.indexOf("async function startAgent("),
    );
    expect(slashRouter).toContain("const provider = providerForFlow(flow);");
    expect(slashRouter).toContain('if (command === "/provider") {');
    expect(slashRouter).toContain("if (await provider.handleSlashCommand(flow, command, message, userLogId)) return true;");
    expect(slashRouter).toContain("throw new Error(`Unknown slash command: ${command}`);");
    expect(server).toContain("async function handleClaudeSlashCommand(flow: Flow, command: string, message: string, userLogId: number)");
    expect(server).toContain("async function clearClaudeSession(flow: Flow)");
    expect(server).toContain("async function compactClaudeSession(flow: Flow, promptLogId?: number)");
    expect(server).toContain('const compactingStaleMs = runtime.provider === "claude" ? claudeRuntimeStaleMs : agentRuntimeStaleMs;');
    expect(server).toContain('const claudeCompactModel = "claude-sonnet-5";');
    expect(server).toContain("function restoreClaudeCompactModel(runtime: RuntimeProcess)");
    expect(server).toContain("await claude.query.setModel(claudeCompactModel);");
    expect(server).toContain("claude.compactRestoreModel = flowModel;");
    expect(server).toContain("function finishClaudeCompaction(runtime: RuntimeProcess, succeeded: boolean)");
    expect(server).toContain("finishClaudeCompaction(runtime, subtype === \"success\");");
    expect(app).toContain('{ name: "/compact", description: "Compact the current Claude session context" }');
  });

  test("switches providers as a fresh-session handoff with the full transcript", () => {
    expect(server).toContain("async function switchFlowProvider(flow: Flow, target: string)");
    expect(server).toContain('throw new Error("Usage: /provider codex|claude");');
    expect(server).toContain('throw new Error("Cannot switch providers while an agent turn is running.");');
    expect(server).toContain("function providerHandoffPrompt(flow: Flow, fromLabel: string)");
    expect(server).toContain("function flowTranscriptTurns(flowId: string)");
    expect(server).toContain(
      "select source, message from logs where flowId = ? and source in ('user', 'agent:message', 'agent:message-boundary') order by id asc",
    );
    expect(server).toContain("setSetting(handoffPendingSettingKey(flow.id), providerHandoffPrompt(flow, agentProviders[current].label));");
    expect(server).toContain("function composeTurnMessage(flowId: string, message: string)");
    expect(server).toContain("function takePendingHandoff(flowId: string)");
    expect(server).toContain("deleteSettingByKeyStmt.run(handoffPendingSettingKey(flowId));");
  });

  test("exposes providers to the client and keeps the UI provider-aware", () => {
    expect(server).toContain("defaultProvider: defaultAgentProviderKind(),");
    expect(server).toContain("providers: clientAgentProviders(),");
    expect(app).toContain("const CLAUDE_SLASH_COMMANDS = [");
    expect(app).toContain("const CLAUDE_SLASH_COMMAND_EXPANSIONS = {");
    expect(app).toContain("function agentProviderKindForFlow(flow)");
    expect(app).toContain("function activeAgentProviderKind()");
    expect(app).toContain("function activeSlashCommands()");
    expect(app).toContain("function activeSlashCommandExpansions()");
    expect(app).toContain('"agent:message": { label: agentLabel, marker: ">", tone: "assistant" },');
    expect(app).toContain('{ name: "/provider", description: "Switch the agent provider for this flow" }');
    expect(app).toContain('{ name: "/provider claude", description: "Use Claude for this flow" }');
    expect(app).toContain("/^(starting|resuming) Claude session\\b/i.test(message)");
  });

  test("shows the active provider icon next to the model name in the flow status bar", () => {
    expect(app).toContain("function agentProviderIcon(flow)");
    expect(app).toContain("icon.dataset.provider = agentProviderKindForFlow(flow);");
    expect(app).toContain('context.querySelector(".agent-context-model").prepend(agentProviderIcon(flow));');
    expect(css).toContain(".agent-context .agent-provider-icon {");
    expect(css).toContain('mask: url("provider-icons/openai.svg") no-repeat center / contain;');
    expect(css).toContain('.agent-context .agent-provider-icon[data-provider="claude"]');
    expect(css).toContain('mask-image: url("provider-icons/claude.svg");');
  });
});
