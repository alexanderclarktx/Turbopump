import { DEFAULT_FAVICON_HREF } from "./constants.js";
import { promptInput, promptQueuedForSelectedFlow, resizeMessageInput, shellInput } from "./prompt.js";
import { els, state } from "./state.js";

const AGENT_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-5",
];

export const SLASH_COMMANDS = [
  { name: "/clear", description: "Start a fresh Codex thread for this flow" },
  { name: "/compact", description: "Compact the current Codex thread context" },
  { name: "/effort", description: "Set Codex reasoning effort" },
  { name: "/fast", description: "Toggle fast mode for this flow" },
  { name: "/model", description: "Set the agent model for this flow" },
  { name: "/permissions", description: "Set Codex permissions for this flow" },
  { name: "/plugins", description: "List Codex plugins" },
  { name: "/review", description: "Ask Codex to review the current changes" },
  { name: "/status", description: "Show current flow status" },
];

export const SLASH_COMMAND_EXPANSIONS = {
  "/effort": ["xhigh", "high", "medium", "low"].map((effort) => ({
    name: `/effort ${effort}`,
    description: "",
  })),
  "/model": AGENT_MODELS.map((model) => ({
    name: `/model ${model}`,
    description: "",
  })),
  "/permissions": [
    { name: "/permissions read-only", description: "Read files only" },
    { name: "/permissions workspace-write", description: "Write inside the workspace" },
    { name: "/permissions full-access", description: "Full filesystem access", icon: DEFAULT_FAVICON_HREF },
  ],
  "/review": [
    { name: "/review base", description: "Review against a base branch (PR style)" },
    { name: "/review uncommitted", description: "Review uncommitted changes" },
    { name: "/review commit", description: "Review a commit" },
    { name: "/review custom", description: "Custom review instructions" },
  ],
};

export const CLAUDE_SLASH_COMMANDS = [
  { name: "/clear", description: "Start a fresh Claude session for this flow" },
  { name: "/compact", description: "Compact the current Claude session context" },
  { name: "/model", description: "Set the agent model for this flow" },
  { name: "/permissions", description: "Set Claude permissions for this flow" },
  { name: "/review", description: "Ask Claude to review the current changes" },
  { name: "/status", description: "Show current flow status" },
];

export const CLAUDE_SLASH_COMMAND_EXPANSIONS = {
  "/model": SLASH_COMMAND_EXPANSIONS["/model"],
  "/permissions": SLASH_COMMAND_EXPANSIONS["/permissions"],
  "/review": SLASH_COMMAND_EXPANSIONS["/review"],
};

export const SLASH_COMMANDS_WITH_ARGUMENTS = ["/review base", "/review commit", "/review custom"];

export function sortSlashCommands(commands) {
  return [...commands].sort((a, b) => a.name.localeCompare(b.name));
}

export function agentProviderKindForFlow(flow) {
  return flow?.agentProvider === "claude" ? "claude" : "codex";
}

export function activeAgentProviderKind() {
  const flow = state.flows.find((item) => item.id === state.selectedFlowId) || null;
  return agentProviderKindForFlow(flow);
}

export function activeSlashCommands() {
  return activeAgentProviderKind() === "claude" ? SORTED_CLAUDE_SLASH_COMMANDS : SORTED_SLASH_COMMANDS;
}

export function activeSlashCommandExpansions() {
  return activeAgentProviderKind() === "claude" ? CLAUDE_SLASH_COMMAND_EXPANSIONS : SLASH_COMMAND_EXPANSIONS;
}

export function slashCommandExpansionMatches(query) {
  const activeExpansions = activeSlashCommandExpansions();
  const exactExpansions = activeExpansions[query];
  if (exactExpansions) return exactExpansions;
  const [command, ...args] = query.split(/\s+/);
  if (!args.length) return [];
  const expansions = activeExpansions[command] || [];
  return expansions.filter((item) => item.name.startsWith(query));
}

export function slashCommandHasExpansions(commandName) {
  return Boolean(activeSlashCommandExpansions()[commandName]);
}

export function slashCommandAllowsArguments(commandName) {
  return SLASH_COMMANDS_WITH_ARGUMENTS.includes(commandName);
}

export function validSlashCommand(value) {
  const commandName = value.trim();
  if (slashCommandHasExpansions(commandName)) return false;
  if (activeSlashCommands().some((command) => command.name === commandName)) return true;
  return Object.values(activeSlashCommandExpansions()).some((expansions) =>
    expansions.some(
      (command) =>
        command.name === commandName ||
        (slashCommandAllowsArguments(command.name) && commandName.startsWith(`${command.name} `)),
    ),
  );
}

export const SORTED_SLASH_COMMANDS = sortSlashCommands(SLASH_COMMANDS);

export const SORTED_CLAUDE_SLASH_COMMANDS = sortSlashCommands(CLAUDE_SLASH_COMMANDS);

export function slashCommandMatches(value) {
  const query = value.trimStart();
  if (!query.startsWith("/")) return [];
  const expansions = slashCommandExpansionMatches(query);
  if (expansions.length) return expansions;
  return activeSlashCommands().filter((command) => command.name.startsWith(query));
}

export function hideSlashMenu() {
  const menu = els.flowPane.querySelector(".slash-menu");
  state.slashMenuCommands = null;
  menu.hidden = true;
  menu.replaceChildren();
}

function renderSlashMenuItems(matches) {
  const menu = els.flowPane.querySelector(".slash-menu");
  if (!matches.length) {
    hideSlashMenu();
    return;
  }

  state.slashCommandIndex = Math.min(state.slashCommandIndex, matches.length - 1);
  const fragment = document.createDocumentFragment();
  matches.forEach((command, index) => {
    const button = document.createElement("button");
    button.className = `slash-command${index === state.slashCommandIndex ? " active" : ""}`;
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === state.slashCommandIndex));
    button.dataset.command = command.name;

    const name = document.createElement("span");
    name.className = "slash-command-name";
    name.textContent = command.name;
    if (command.icon) {
      const icon = document.createElement("img");
      icon.className = "slash-command-icon";
      icon.src = command.icon;
      icon.alt = "";
      name.append(" ", icon);
    }

    const description = document.createElement("span");
    description.className = "slash-command-description";
    description.textContent = command.description;

    button.replaceChildren(name, description);
    fragment.appendChild(button);
  });
  menu.replaceChildren(fragment);
  menu.hidden = false;
}

export function renderSlashMenuCommands(commands) {
  state.slashMenuCommands = commands;
  renderSlashMenuItems(commands);
}

export function renderSlashMenu() {
  if (state.slashMenuCommands) {
    renderSlashMenuItems(state.slashMenuCommands);
    return;
  }
  const input = promptInput();
  if (!input || document.activeElement === shellInput() || promptQueuedForSelectedFlow()) {
    hideSlashMenu();
    return;
  }
  renderSlashMenuItems(slashCommandMatches(input.value));
}

export function selectSlashCommand(index = state.slashCommandIndex) {
  const input = promptInput();
  if (!input) return false;
  const matches = slashCommandMatches(input.value);
  const command = matches[index];
  if (!command) return false;
  input.value = command.name;
  resizeMessageInput();
  if (slashCommandHasExpansions(command.name)) {
    state.slashCommandIndex = 0;
    renderSlashMenu();
  } else {
    hideSlashMenu();
  }
  input.focus();
  return true;
}
