export const COLLAPSED_LINEAR_STATUSES_KEY = "flow.collapsedLinearStatuses";

export const COLLAPSED_SETTINGS_SECTIONS_KEY = "flow.collapsedSettingsSections";

export const PINNED_LINEAR_ISSUES_KEY = "flow.pinnedLinearIssues";

export const NOTIFIED_LINEAR_ISSUES_KEY = "flow.notifiedLinearIssueIds";

export const FLOW_SPLIT_SIZE_KEY = "flow.topPaneSize";

export const TICKET_DRAWER_SIZE_KEY = "flow.ticketDrawerSize";

export const LINEAR_PANE_HIDDEN_KEY = "flow.linearPaneHidden";

export const SHELL_OUTPUT_SPLIT_SIZE_KEY = "flow.shellOutputPaneSize";

export const SHELL_PANE_HIDDEN_KEY = "flow.shellPaneHidden";

export const THEME_KEY = "flow.theme";

export const PROMPT_HISTORY_KEY = "flow.promptHistory";

export const SHELL_HISTORY_KEY = "flow.shellHistory";

export const MAX_INPUT_HISTORY_ITEMS = 200;

export const DEFAULT_TOAST_DURATION_MS = 3200;

export const ERROR_TOAST_DURATION_MS = 8000;

export const DEFAULT_FAVICON_HREF = "/favicon.svg";

export const DEFAULT_COLLAPSED_LINEAR_STATUSES = ["backlog", "canceled"];

export const LINEAR_STATUS_ORDER = ["in-review", "in-eng", "ready-for-eng", "triage", "backlog", "canceled"];

export const LOG_PREFETCH_DELAY_MS = 750;

export const LOG_PREFETCH_BATCH_SIZE = 1;

export const LOG_PREFETCH_MAX_FLOW_COUNT = 3;

export const GITHUB_CI_RECENT_MS = 30 * 60 * 1000;

export const LOG_PAGE_SIZE = 1000;

export const AGENT_TRACE_INITIAL_TURN_COUNT = 6;

export const AGENT_TRACE_TURN_PAGE_SIZE = 6;

export const TERMINAL_TRACE_INITIAL_RENDER_COUNT = 18;

export const TERMINAL_TRACE_RENDER_BATCH_SIZE = 48;

export const TERMINAL_TRACE_OPEN_DURATION_MS = 90;

export const TERMINAL_TRACE_CLOSE_DURATION_MS = 80;

export const MARKDOWN_CODE_COPY_OFFSET = 6;

export const MARKDOWN_CODE_COPY_SIZE = 24;

export const MARKDOWN_TABLE_MIN_COLUMN_WIDTH = 72;

export const TICKET_DRAWER_MIN_SIZE = 280;

export const TICKET_DRAWER_MAX_SIZE = 320;

export const TICKET_START_AGENT_FLAME_PATH =
  "M33 4C37 14 29 20 29 28C29 23 26 19 22 16C23 27 13 31 13 45C13 55 21 62 32 62S51 55 51 44C51 30 39 23 33 4Z";

export const TICKET_START_AGENT_FLAME_ANIMATION_VALUES = [
  TICKET_START_AGENT_FLAME_PATH,
  "M30 4C35 14 27 20 29 28C28 23 25 19 20 16C23 27 13 31 13 45C13 55 21 62 32 62S51 55 51 44C51 30 36 23 30 4Z",
  "M36 4C39 14 31 20 29 28C30 23 27 19 24 16C23 27 13 31 13 45C13 55 21 62 32 62S51 55 51 44C51 30 42 23 36 4Z",
  TICKET_START_AGENT_FLAME_PATH,
].join(";");

export const QUEUED_PROMPT_PREFIX_HTML = '<span class="queued-prompt-spinner" aria-hidden="true"></span>';

export const MODAL_HIDE_DELAY_MS = 220;
