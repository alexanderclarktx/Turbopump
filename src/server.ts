import { Database } from "bun:sqlite";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

type ThreadStartSource = "startup" | "clear";
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
type ServiceTier = "fast" | "flex";
type AgentSandbox = "read-only" | "workspace-write" | "danger-full-access";

type Flow = {
  id: string;
  linearIssueId: string;
  linearIssueUrl: string;
  title: string;
  linearStatus: string;
  checkoutPath: string;
  branchName: string;
  prUrl: string;
  githubCiStatus: GithubCiState;
  githubCiCheckedAt: string;
  githubCiTargetUrl: string;
  githubCiDescription: string;
  baseSha: string;
  agentStatus: string;
  agentModel: string;
  agentReasoningEffort: string;
  agentServiceTier: string;
  agentSandbox: string;
  agentContextTokensUsed: number;
  agentContextWindow: number;
  serving: number;
  createdAt: string;
  updatedAt: string;
  shellOutputClearAfterLogId?: number;
  agentRuntimeKind?: "agent" | "shell";
  agentRuntimeStatus?: "running" | "interrupting" | "";
  shellRuntimeStatus?: "running" | "interrupting" | "";
  agentCompacting?: boolean;
  agentQueuedMessage?: boolean;
  queuedPrompt?: QueuedPrompt | null;
};

type QueuedPrompt = {
  flowId: string;
  message: string;
  createdAt: string;
  updatedAt: string;
};

type LogRow = {
  id: number;
  flowId: string;
  source: string;
  message: string;
  createdAt: string;
};

type DiffFile = {
  path: string;
  additions: number | null;
  deletions: number | null;
};

type UploadedImage = File;

type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  archivedAt?: string | null;
  priority?: number;
  estimate?: number | null;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  state?: { id?: string; name: string; color?: string; type?: string };
  team?: { id?: string; key: string; name: string };
  project?: { name: string } | null;
  assignee?: { name: string } | null;
  creator?: { name: string } | null;
  labels?: { nodes?: { name: string; color?: string }[] };
  comments?: {
    nodes?: {
      id: string;
      body: string;
      createdAt: string;
      updatedAt?: string;
      user?: { name: string } | null;
      parent?: { id: string } | null;
    }[];
  };
};

type LinearIssueConnection = {
  nodes: LinearIssue[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
};

type LinearWorkflowState = {
  id: string;
  name: string;
  color?: string;
  type?: string;
  team?: { id: string; key: string; name: string } | null;
};

type GithubCiState = "success" | "pending" | "failure" | "merged" | "unknown";

const rootDir = process.cwd();
const agentHeartbeatSweepIntervalMs = 5000;
const agentRuntimeStartGraceMs = 30000;
const agentRuntimeStaleMs = 120000;
const warmedRepoPullIntervalMs = 60000;
const dataDir = join(rootDir, ".flow");
const legacyDataDir = join(rootDir, `.${"water"}${"flow"}`);
const worktreeDir = join(dataDir, "worktrees");
const repoCheckoutDir = join(dataDir, "repo");
const publicDir = join(rootDir, "public");
const prismDir = join(rootDir, "node_modules", "prismjs");
const dbPath = join(dataDir, "flow.sqlite");
const legacyDbPath = join(legacyDataDir, `${"water"}flow.sqlite`);
const port = Number(process.env.PORT ?? 3999);
const apiBaseUrl = `http://localhost:${port}`;
const defaultCodexAppServerCommand = "codex app-server --listen stdio://";
const serviceTiers = new Set<ServiceTier>(["fast", "flex"]);
const reasoningEfforts = new Set<ReasoningEffort>(["low", "medium", "high", "xhigh"]);
const agentSandboxes = new Set<AgentSandbox>(["read-only", "workspace-write", "danger-full-access"]);
const agentModels = new Set(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"]);
const reviewFindingInstructions =
  "Focus on bugs, behavioral regressions, missing tests, and risks. Report findings first with file and line references.";
const serveProcessPidSettingKey = "serveProcessPid";
const serveProcessFlowSettingKey = "serveProcessFlowId";
const defaultAgentDeveloperInstructions = [
  "You are running inside Turbopump, a local coding-agent workflow system.",
  "",
  "Work only in the worktree directory supplied as the current working directory.",
  "",
  "Update flow metadata when appropriate by POSTing JSON to:",
  "{flowMetaApiUrl}",
  'Example body: {"prUrl":"https://github.com/org/repo/pull/123"}',
  'Each field in the body is optional.',
  "",
  "Flow ID: {flowId}",
  "Linear issue: {linearIssueId}",
  "Issue title: {title}",
  "Worktree path: {checkoutPath}",
  "",
  "working guidelines:",
  "- use short PR titles",
  "- do not capitalize the first word of PR titles"
].join("\n");

mkdirSync(dataDir, { recursive: true });
mkdirSync(worktreeDir, { recursive: true });
if (!existsSync(dbPath) && existsSync(legacyDbPath)) copyFileSync(legacyDbPath, dbPath);

const db = new Database(dbPath);
db.exec("pragma busy_timeout = 5000");

function tryMigration(sql: string) {
  try {
    db.exec(sql);
  } catch {
    // Ignore migrations that are already applied or irrelevant for a new database.
  }
}

tryMigration(`alter table ${"water"}flows rename to flows`);
tryMigration(`alter table logs rename column ${"water"}flowId to flowId`);
db.exec(`
  create table if not exists settings (
    key text primary key,
    value text not null
  );

  create table if not exists environment_variables (
    id integer primary key check (id = 1),
    contents text not null,
    updatedAt text not null
  );

  create table if not exists flows (
    id text primary key,
    linearIssueId text not null,
    linearIssueUrl text not null,
    title text not null,
    linearStatus text not null default '',
    checkoutPath text not null,
    branchName text not null,
    prUrl text not null default '',
    githubCiStatus text not null default 'unknown',
    githubCiCheckedAt text not null default '',
    githubCiTargetUrl text not null default '',
    githubCiDescription text not null default '',
    baseSha text not null default '',
    agentStatus text not null default 'idle',
    agentModel text not null default '',
    agentReasoningEffort text not null default '',
    agentServiceTier text not null default 'fast',
    agentSandbox text not null default 'danger-full-access',
    agentContextTokensUsed integer not null default 0,
    agentContextWindow integer not null default 0,
    serving integer not null default 0,
    createdAt text not null,
    updatedAt text not null
  );

  create table if not exists logs (
    id integer primary key autoincrement,
    flowId text not null,
    source text not null,
    message text not null,
    createdAt text not null
  );

  create table if not exists shell_output_state (
    flowId text primary key,
    clearAfterLogId integer not null default 0,
    updatedAt text not null
  );

  create table if not exists queued_prompts (
    flowId text primary key,
    message text not null,
    createdAt text not null,
    updatedAt text not null
  );

  create table if not exists linear_issues (
    identifier text primary key,
    issueJson text not null,
    updatedAt text not null
  );

  create index if not exists logs_flow_id_id_idx on logs(flowId, id);
  create index if not exists logs_flow_id_source_id_idx on logs(flowId, source, id);
  create index if not exists flows_linear_issue_id_idx on flows(linearIssueId);
`);
tryMigration("alter table flows drop column stage");
tryMigration("alter table flows add column agentModel text not null default ''");
tryMigration("alter table flows add column agentReasoningEffort text not null default ''");
tryMigration("alter table flows add column agentServiceTier text not null default 'fast'");
tryMigration("alter table flows add column agentSandbox text not null default 'danger-full-access'");
tryMigration("alter table flows add column agentContextTokensUsed integer not null default 0");
tryMigration("alter table flows add column agentContextWindow integer not null default 0");
tryMigration("alter table flows add column prUrl text not null default ''");
tryMigration("alter table flows add column githubCiStatus text not null default 'unknown'");
tryMigration("alter table flows add column githubCiCheckedAt text not null default ''");
tryMigration("alter table flows add column githubCiTargetUrl text not null default ''");
tryMigration("alter table flows add column githubCiDescription text not null default ''");
tryMigration("update flows set agentContextTokensUsed = 0 where agentContextWindow > 0 and agentContextTokensUsed > agentContextWindow");

const clients = new Set<ServerWebSocket>();
const agentProcesses = new Map<string, RuntimeProcess>();
const agentRuntimeRecoveries = new Map<string, Promise<RuntimeProcess | null>>();
const shellProcesses = new Map<string, RuntimeProcess>();
const linearIssueCache = new Map<string, LinearIssue>();
const deletedFlowIds = new Set<string>();
let selectedGithubCiFlowId = "";
let githubCiPolling = false;
let warmedRepoPulling = false;
let serveProcess: RuntimeProcess | null = null;

type RuntimeProcess = {
  flowId: string;
  kind: "agent" | "serve" | "shell";
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  command?: string;
  requestId?: number;
  stdoutBuffer?: string;
  threadId?: string;
  activeTurnId?: string;
  activeTurnTraceAfterLogId?: number;
  compacting?: boolean;
  compactingStartedAt?: number;
  compactionPromptLogId?: number;
  queuedAgentMessages?: Array<{ message: string; queuedLogId: number }>;
  lastSeenAt?: number;
  stopping?: boolean;
  pending?: Map<
    number,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >;
};

type RuntimeSignal = "SIGINT" | "SIGTERM" | "SIGKILL";

type ServerWebSocket = {
  send: (message: string) => void;
};

type WsRequest = {
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

const getSettingStmt = db.query("select value from settings where key = ?");
const setSettingStmt = db.query(`
  insert into settings (key, value) values (?, ?)
  on conflict(key) do update set value = excluded.value
`);
const getEnvironmentVariablesStmt = db.query("select contents from environment_variables where id = 1");
const setEnvironmentVariablesStmt = db.query(`
  insert into environment_variables (id, contents, updatedAt) values (1, ?, ?)
  on conflict(id) do update set contents = excluded.contents, updatedAt = excluded.updatedAt
`);
const insertLogStmt = db.query(`
  insert into logs (flowId, source, message, createdAt) values (?, ?, ?, ?)
`);
const logByIdStmt = db.query("select * from logs where id = ?");
const deleteLogByIdStmt = db.query("delete from logs where id = ?");
const deleteLogsByFlowIdStmt = db.query("delete from logs where flowId = ?");
const latestUserLogBeforeStmt = db.query(
  "select id from logs where flowId = ? and source = 'user' and id < ? order by id desc limit 1",
);
const logsAfterStmt = db.query("select * from logs where flowId = ? and id > ? order by id asc");
const logsPageStmt = db.query("select * from logs where flowId = ? and id > ? order by id asc limit ?");
const logsBeforePageStmt = db.query(`
  select * from (
    select * from logs where flowId = ? and id < ? order by id desc limit ?
  ) order by id asc
`);
const latestLogIdStmt = db.query("select id from logs where flowId = ? order by id desc limit 1");
const shellOutputStateStmt = db.query("select clearAfterLogId from shell_output_state where flowId = ?");
const allShellOutputStateStmt = db.query("select flowId, clearAfterLogId from shell_output_state");
const setShellOutputClearAfterLogIdStmt = db.query(`
  insert into shell_output_state (flowId, clearAfterLogId, updatedAt) values (?, ?, ?)
  on conflict(flowId) do update set clearAfterLogId = excluded.clearAfterLogId, updatedAt = excluded.updatedAt
`);
const queuedPromptByFlowIdStmt = db.query("select * from queued_prompts where flowId = ?");
const setQueuedPromptStmt = db.query(`
  insert into queued_prompts (flowId, message, createdAt, updatedAt) values (?, ?, ?, ?)
  on conflict(flowId) do update set message = excluded.message, updatedAt = excluded.updatedAt
`);
const deleteQueuedPromptStmt = db.query("delete from queued_prompts where flowId = ?");
const upsertLinearIssueStmt = db.query(`
  insert into linear_issues (identifier, issueJson, updatedAt) values (?, ?, ?)
  on conflict(identifier) do update set issueJson = excluded.issueJson, updatedAt = excluded.updatedAt
`);
const deleteLinearIssueStmt = db.query("delete from linear_issues where identifier = ?");
const linearIssueByIdentifierStmt = db.query("select issueJson from linear_issues where identifier = ?");
const allLinearIssuesStmt = db.query("select issueJson from linear_issues order by updatedAt desc");
const flowByIdStmt = db.query("select * from flows where id = ?");
const flowByIssueStmt = db.query("select * from flows where linearIssueId = ? limit 1");
const allFlowsStmt = db.query("select * from flows order by createdAt asc");
const deleteFlowByIdStmt = db.query("delete from flows where id = ?");
const deleteShellOutputStateByFlowIdStmt = db.query("delete from shell_output_state where flowId = ?");
const deleteSettingByKeyStmt = db.query("delete from settings where key = ?");
const latestPromptTimestampStmt = db.query(
  "select createdAt from logs where flowId = ? and source = 'user' order by id desc limit 1",
);

function now() {
  return new Date().toISOString();
}

function getSetting(key: string, fallback = "") {
  const row = getSettingStmt.get(key) as { value: string } | null;
  return row?.value ?? fallback;
}

function getStoredSetting(key: string) {
  const row = getSettingStmt.get(key) as { value: string } | null;
  return row?.value ?? null;
}

function setSetting(key: string, value: string) {
  setSettingStmt.run(key, value);
}

function persistedServePid() {
  const value = Number(getSetting(serveProcessPidSettingKey));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function persistedServeFlowId() {
  return getSetting(serveProcessFlowSettingKey);
}

function rememberServeProcess(runtime: RuntimeProcess) {
  setSetting(serveProcessPidSettingKey, String(runtime.proc.pid));
  setSetting(serveProcessFlowSettingKey, runtime.flowId);
}

function clearPersistedServeProcess(runtime?: RuntimeProcess) {
  if (runtime && persistedServePid() !== runtime.proc.pid) return;
  deleteSettingByKeyStmt.run(serveProcessPidSettingKey);
  deleteSettingByKeyStmt.run(serveProcessFlowSettingKey);
}

function readEnvContents() {
  const row = getEnvironmentVariablesStmt.get() as { contents: string } | null;
  return row?.contents ?? "";
}

function writeEnvContents(contents: string) {
  setEnvironmentVariablesStmt.run(contents, now());
}

function parseEnv(contents: string) {
  const env: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function runtimeEnv(flow?: Flow) {
  return {
    ...process.env,
    ...parseEnv(readEnvContents()),
    FLOW_API_URL: apiBaseUrl,
    FLOW_RUN_ID: flow?.id ?? "",
  } as Record<string, string>;
}

function shellRuntimeEnv(flow: Flow) {
  const env = runtimeEnv(flow);
  delete env.NO_COLOR;
  delete env.NODE_DISABLE_COLORS;
  return {
    ...env,
    TERM: process.env.TERM || "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor",
    FORCE_COLOR: process.env.FORCE_COLOR || "3",
    CLICOLOR: "1",
    CLICOLOR_FORCE: "1",
  } as Record<string, string>;
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function broadcast(event: string, payload: unknown) {
  const message = JSON.stringify({ event, payload });
  for (const client of clients) {
    try {
      client.send(message);
    } catch {
      clients.delete(client);
    }
  }
}

function sendWsResponse(ws: ServerWebSocket, requestId: unknown, payload: unknown) {
  ws.send(JSON.stringify({ event: "response", requestId, payload }));
}

function sendWsError(ws: ServerWebSocket, requestId: unknown, error: unknown) {
  ws.send(
    JSON.stringify({
      event: "response",
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

function wsParams(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function wsFlowId(params: Record<string, unknown>) {
  const flowId = String(params.flowId || "");
  if (!flowId || !getFlow(flowId)) throw new Error("Flow not found");
  return flowId;
}

async function handleWsRequest(ws: ServerWebSocket, rawMessage: string | Buffer) {
  let request: WsRequest;
  try {
    request = JSON.parse(String(rawMessage)) as WsRequest;
  } catch {
    return;
  }

  if (request.id === undefined || typeof request.method !== "string") return;

  try {
    const params = wsParams(request.params);
    if (request.method === "logs") {
      const flowId = wsFlowId(params);
      const limit = Math.min(1000, Math.max(1, Math.trunc(Number(params.limit ?? 1000) || 1000)));
      if (params.before !== undefined) {
        const before = Number(params.before);
        const normalizedBefore = Number.isFinite(before) && before > 0 ? Math.trunc(before) : Number.MAX_SAFE_INTEGER;
        const logs = logsBeforePageStmt.all(flowId, normalizedBefore, limit);
        sendWsResponse(ws, request.id, { logs });
        return;
      }
      const after = Number(params.after ?? 0);
      const logs = logsPageStmt.all(flowId, Number.isFinite(after) ? Math.max(0, Math.trunc(after)) : 0, limit);
      sendWsResponse(ws, request.id, { logs });
      return;
    }

    if (request.method === "flow") {
      const flowId = wsFlowId(params);
      const reconciled = await reconcileAgentHeartbeat(getFlow(flowId) as Flow);
      sendWsResponse(ws, request.id, {
        flow: clientFlow(reconciled),
        turnRunning: Boolean(agentProcesses.get(flowId)?.activeTurnId),
      });
      return;
    }

    if (request.method === "selected-github-flow") {
      const flowId = String(params.flowId || "");
      if (flowId) wsFlowId({ flowId });
      setSelectedGithubCiFlow(flowId);
      sendWsResponse(ws, request.id, { ok: true });
      return;
    }

    throw new Error(`Unsupported WebSocket method: ${request.method}`);
  } catch (error) {
    sendWsError(ws, request.id, error);
  }
}

function insertLog(flowId: string, source: string, message: string) {
  if (deletedFlowIds.has(flowId)) return 0;
  const createdAt = now();
  const result = insertLogStmt.run(flowId, source, message, createdAt) as {
    lastInsertRowid?: number | bigint;
  };
  const id = Number(result.lastInsertRowid ?? 0);
  broadcast("log", { id, flowId, source, message, createdAt });
  return id;
}

function deleteOutputLogs(flowId: string, ids: number[]) {
  const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!uniqueIds.length) throw new Error("No log ids provided.");

  const rows = uniqueIds.map((id) => logByIdStmt.get(id) as LogRow | null);
  const allowedSources = new Set(["agent:output", "agent:cmd", "shell:output"]);
  if (rows.some((row) => !row || row.flowId !== flowId || !allowedSources.has(row.source))) {
    throw new Error("Only output logs for this flow can be deleted.");
  }

  for (const id of uniqueIds) deleteLogByIdStmt.run(id);
  broadcast("logs-deleted", { flowId, ids: uniqueIds });
  return uniqueIds;
}

function deleteQueuedUserLog(flowId: string, id: number) {
  const log = logByIdStmt.get(id) as LogRow | null;
  if (!log || log.flowId !== flowId || log.source !== "user:queued") return;
  deleteLogByIdStmt.run(id);
  broadcast("logs-deleted", { flowId, ids: [id] });
}

function deleteQueuedAgentMessagePlaceholders(runtime: RuntimeProcess) {
  for (const queued of runtime.queuedAgentMessages ?? []) deleteQueuedUserLog(runtime.flowId, queued.queuedLogId);
}

function getFlow(id: string) {
  return flowByIdStmt.get(id) as Flow | null;
}

function getFlowByIssue(identifier: string) {
  return flowByIssueStmt.get(identifier) as Flow | null;
}

function listFlows() {
  return allFlowsStmt.all() as Flow[];
}

function latestLogId(flowId: string) {
  const row = latestLogIdStmt.get(flowId) as { id: number } | null;
  return row?.id ?? 0;
}

function shellOutputClearAfterLogId(flowId: string) {
  const row = shellOutputStateStmt.get(flowId) as { clearAfterLogId: number } | null;
  return row?.clearAfterLogId ?? 0;
}

function shellOutputClearAfterLogIds() {
  const rows = allShellOutputStateStmt.all() as Array<{ flowId: string; clearAfterLogId: number }>;
  return new Map(rows.map((row) => [row.flowId, row.clearAfterLogId]));
}

function queuedPromptForFlow(flowId: string) {
  return queuedPromptByFlowIdStmt.get(flowId) as QueuedPrompt | null;
}

function normalizeQueuedPromptMessage(value: unknown) {
  const message = String(value ?? "");
  if (!message.trim()) throw new Error("Queued message cannot be blank.");
  return message;
}

function setQueuedPrompt(flowId: string, message: string) {
  const existing = queuedPromptForFlow(flowId);
  const timestamp = now();
  setQueuedPromptStmt.run(flowId, message, existing?.createdAt ?? timestamp, timestamp);
  broadcast("flows", listClientFlows());
}

function clearQueuedPrompt(flowId: string, options: { broadcast?: boolean } = {}) {
  const existing = queuedPromptForFlow(flowId);
  deleteQueuedPromptStmt.run(flowId);
  if (existing && options.broadcast !== false) broadcast("flows", listClientFlows());
  return Boolean(existing);
}

function setShellOutputClearAfterLogId(flowId: string, clearAfterLogId: number) {
  const normalized = Number.isFinite(clearAfterLogId) ? Math.max(0, Math.trunc(clearAfterLogId)) : 0;
  setShellOutputClearAfterLogIdStmt.run(flowId, normalized, now());
  broadcast("shell-output-cleared", { flowId, clearAfterLogId: normalized });
  return normalized;
}

function runtimeAdjustedFlow(flow: Flow) {
  const shellRuntime = shellProcesses.get(flow.id);
  const agentRuntime = agentProcesses.get(flow.id);
  const agentRuntimeActive = Boolean(agentRuntime?.activeTurnId || agentRuntime?.compacting);
  const shellRuntimeStatus = shellRuntime ? (shellRuntime.stopping ? "interrupting" : "running") : "";
  const agentRuntimeStatus = agentRuntimeActive
    ? agentRuntime?.stopping || flow.agentStatus === "interrupting"
      ? "interrupting"
      : "running"
    : "";

  if (!shellRuntimeStatus && !agentRuntimeStatus) return flow;

  const agentStatus =
    agentRuntimeStatus === "interrupting" || shellRuntimeStatus === "interrupting" ? "interrupting" : "running";
  return {
    ...flow,
    agentStatus,
    agentRuntimeKind: shellRuntimeStatus && !agentRuntimeStatus ? "shell" : "agent",
    agentRuntimeStatus,
    shellRuntimeStatus,
    agentCompacting: Boolean(agentRuntime?.compacting),
    agentQueuedMessage: Boolean(agentRuntime?.queuedAgentMessages?.length),
  };
}

function clientFlow(flow: Flow, clearAfterLogId = shellOutputClearAfterLogId(flow.id)) {
  return {
    ...runtimeAdjustedFlow(flow),
    shellOutputClearAfterLogId: clearAfterLogId,
    queuedPrompt: queuedPromptForFlow(flow.id),
  };
}

function listClientFlows() {
  const clearAfterLogIds = shellOutputClearAfterLogIds();
  return listFlows().map((flow) => clientFlow(flow, clearAfterLogIds.get(flow.id) ?? 0));
}

function worktreeNameFromPath(path: string) {
  return basename(resolve(path));
}

function worktreeFlowMap() {
  const map = new Map<string, Flow>();
  for (const flow of listFlows()) {
    if (!flow.checkoutPath) continue;
    map.set(worktreeNameFromPath(flow.checkoutPath), flow);
  }
  return map;
}

function latestPromptTimestamp(flowId: string) {
  const row = latestPromptTimestampStmt.get(flowId) as { createdAt: string } | null;
  return row?.createdAt ?? "";
}

function latestLinearStatusForFlow(flow: Flow | null) {
  if (!flow) return "";
  const issue = cachedLinearIssue(flow.linearIssueId);
  return issue?.state?.name || flow.linearStatus || "";
}

function listWorktreeDirectories() {
  if (!existsSync(worktreeDir)) return [];
  const directories: Array<{ name: string; path: string }> = [];
  for (const entry of readdirSync(worktreeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    directories.push({ name: entry.name, path: join(worktreeDir, entry.name) });
  }
  return directories;
}

function listWorktrees() {
  const flowsByWorktree = worktreeFlowMap();
  return listWorktreeDirectories()
    .map((entry) => {
      const path = entry.path;
      const stats = statSync(path);
      const flow = flowsByWorktree.get(entry.name) ?? null;
      const createdAtMs = stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs;
      return {
        name: entry.name,
        path,
        createdAt: new Date(createdAtMs).toISOString(),
        updatedAt: stats.mtime.toISOString(),
        ticketId: flow?.linearIssueId ?? entry.name.match(/[a-z]+-\d+/i)?.[0]?.toUpperCase() ?? "",
        ticketName: flow?.title ?? "",
        linearStatus: latestLinearStatusForFlow(flow),
        lastPromptAt: flow ? latestPromptTimestamp(flow.id) : "",
      };
    })
    .sort((a, b) => {
      const aTime = Date.parse(a.lastPromptAt || a.createdAt || "");
      const bTime = Date.parse(b.lastPromptAt || b.createdAt || "");
      return bTime - aTime || a.name.localeCompare(b.name);
    });
}

function worktreePathForName(name: string) {
  const safeName = basename(name);
  if (!safeName || safeName !== name || safeName === "." || safeName === "..") {
    throw new Error("Invalid worktree name.");
  }
  const target = resolve(worktreeDir, safeName);
  const worktreeRoot = resolve(worktreeDir);
  if (!target.startsWith(`${worktreeRoot}/`)) throw new Error("Invalid worktree path.");
  return target;
}

function deleteWorktree(name: string) {
  const target = worktreePathForName(name);
  if (!existsSync(target)) throw new Error("Worktree not found.");
  const stats = statSync(target);
  if (!stats.isDirectory()) throw new Error("Worktree is not a directory.");
  const flow = worktreeFlowMap().get(name) ?? null;
  if (flow) stopFlowRuntimesForDelete(flow.id);
  if (existsSync(repoCheckoutDir) && isGitWorktree(target)) {
    runGit(["worktree", "remove", "--force", target], repoCheckoutDir);
    runGit(["worktree", "prune"], repoCheckoutDir);
  } else {
    rmSync(target, { recursive: true, force: true });
  }
  if (flow) deleteFlowTraceData(flow.id);
  return { deletedFlowId: flow?.id ?? "" };
}

function isGitWorktree(path: string) {
  try {
    return statSync(join(path, ".git")).isFile();
  } catch {
    return false;
  }
}

function stopFlowRuntimesForDelete(flowId: string) {
  const shellRuntime = shellProcesses.get(flowId);
  if (shellRuntime) {
    shellRuntime.stopping = true;
    shellProcesses.delete(flowId);
    signalRuntimeProcess(shellRuntime, "SIGTERM");
  }

  const agentRuntime = agentProcesses.get(flowId);
  if (agentRuntime) {
    agentRuntime.stopping = true;
    agentProcesses.delete(flowId);
    signalRuntimeProcess(agentRuntime, "SIGTERM");
  }

  if (serveProcess?.flowId === flowId) {
    const previous = serveProcess;
    serveProcess = null;
    signalRuntimeProcess(previous, "SIGTERM");
  }
}

function deleteFlowTraceData(flowId: string) {
  deletedFlowIds.add(flowId);
  deleteLogsByFlowIdStmt.run(flowId);
  deleteShellOutputStateByFlowIdStmt.run(flowId);
  deleteQueuedPromptStmt.run(flowId);
  deleteSettingByKeyStmt.run(codexThreadSettingKey(flowId));
  deleteSettingByKeyStmt.run(codexActiveTurnSettingKey(flowId));
  deleteFlowByIdStmt.run(flowId);
}

function safeImageExtension(file: UploadedImage) {
  const fromName = extname(file.name).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"].includes(fromName)) return fromName;
  if (file.type === "image/png") return ".png";
  if (file.type === "image/jpeg") return ".jpg";
  if (file.type === "image/gif") return ".gif";
  if (file.type === "image/webp") return ".webp";
  if (file.type === "image/avif") return ".avif";
  if (file.type === "image/svg+xml") return ".svg";
  return "";
}

function imageContentType(path: string) {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".avif") return "image/avif";
  if (extension === ".svg") return "image/svg+xml";
  return "";
}

async function saveFlowContextImages(flow: Flow, formData: FormData) {
  const values = formData.getAll("images");
  const files = values.filter((value): value is UploadedImage => {
    return typeof value === "object" && value !== null && "arrayBuffer" in value && "type" in value && "name" in value;
  });
  if (!files.length) throw new Error("No images provided.");
  const contextDir = join(flow.checkoutPath, ".flow", "context");
  mkdirSync(contextDir, { recursive: true });

  const images = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) throw new Error("Only image files can be attached.");
    const extension = safeImageExtension(file);
    if (!extension) throw new Error("Unsupported image type.");
    const name = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${crypto.randomUUID()}${extension}`;
    const path = join(contextDir, name);
    writeFileSync(path, Buffer.from(await file.arrayBuffer()));
    images.push({
      name: file.name,
      path,
      relativePath: `.flow/context/${name}`,
      type: file.type,
      size: file.size,
    });
  }
  return images;
}

async function serveFlowContextImage(flow: Flow, rawPath: string) {
  if (!rawPath) return new Response("Image path is required.", { status: 400 });
  const contextDir = join(flow.checkoutPath, ".flow", "context");
  const resolved = rawPath.startsWith("/") ? resolve(rawPath) : resolve(flow.checkoutPath, rawPath);
  if (!pathIsInsideDirectory(resolved, contextDir)) return new Response("Not found", { status: 404 });
  const contentType = imageContentType(resolved);
  if (!contentType) return new Response("Unsupported image type.", { status: 400 });
  const file = Bun.file(resolved);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, { headers: { "content-type": contentType } });
}

function normalizePrUrl(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (typeof value !== "string") throw new Error("prUrl must be a string.");
  const prUrl = value.trim();
  if (!prUrl) return "";
  try {
    const parsed = new URL(prUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported protocol.");
  } catch {
    throw new Error("prUrl must be an http(s) URL.");
  }
  return prUrl;
}

function flowMetaUpdate(body: Record<string, unknown>): Partial<Flow> {
  const fields: Partial<Flow> = {};
  if ("prUrl" in body) {
    fields.prUrl = normalizePrUrl(body.prUrl);
    fields.githubCiStatus = "unknown";
    fields.githubCiCheckedAt = "";
    fields.githubCiTargetUrl = "";
    fields.githubCiDescription = "";
  }
  return fields;
}

function combineGithubCiStates(states: GithubCiState[]): GithubCiState {
  if (states.includes("failure")) return "failure";
  if (states.includes("pending")) return "pending";
  if (states.includes("success")) return "success";
  return "unknown";
}

function githubRollupState(check: { status?: string | null; conclusion?: string | null; state?: string | null }): GithubCiState {
  const status = String(check.status || "").toLowerCase();
  const conclusion = String(check.conclusion || "").toLowerCase();
  const state = String(check.state || "").toLowerCase();
  if (status && status !== "completed") return "pending";
  if (state === "pending" || state === "expected") return "pending";
  if (state === "failure" || state === "error") return "failure";
  if (state === "success") return "success";
  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") return "success";
  if (conclusion === "failure" || conclusion === "cancelled" || conclusion === "timed_out" || conclusion === "action_required" || conclusion === "startup_failure") return "failure";
  return "unknown";
}

async function getGithubCiStatus(flow: Flow) {
  try {
    const pr = JSON.parse(await runGh(["pr", "view", flow.prUrl, "--json", "statusCheckRollup,headRefOid,state,url"], flow)) as {
      headRefOid?: string;
      state?: string;
      url?: string;
      statusCheckRollup?: Array<{
        status?: string | null;
        conclusion?: string | null;
        state?: string | null;
        detailsUrl?: string | null;
        targetUrl?: string | null;
      }>;
    };
    if (String(pr.state || "").toLowerCase() === "merged") {
      return {
        state: "merged" as GithubCiState,
        prUrl: flow.prUrl,
        sha: pr.headRefOid || "",
        description: "GitHub PR merged.",
        targetUrl: pr.url || flow.prUrl,
        checkedAt: now(),
      };
    }
    const checks = pr.statusCheckRollup || [];
    const states = checks.map(githubRollupState);
    const state = combineGithubCiStates(states);
    return {
      state,
      prUrl: flow.prUrl,
      sha: pr.headRefOid || "",
      description: state === "unknown" ? "No CI status found." : `GitHub CI ${state}.`,
      targetUrl: checks.find((item) => item.detailsUrl || item.targetUrl)?.detailsUrl || checks.find((item) => item.targetUrl)?.targetUrl || pr.url || flow.prUrl,
      checkedAt: now(),
    };
  } catch (error) {
    return {
      state: "unknown" as GithubCiState,
      prUrl: flow.prUrl,
      description: error instanceof Error ? error.message : String(error),
      checkedAt: now(),
    };
  }
}

function setSelectedGithubCiFlow(flowId: string) {
  if (selectedGithubCiFlowId === flowId) return;
  selectedGithubCiFlowId = flowId;
  void pollSelectedGithubCiStatus();
}

async function pollSelectedGithubCiStatus() {
  if (githubCiPolling) return;
  const flowId = selectedGithubCiFlowId;
  const flow = flowId ? getFlow(flowId) : null;
  if (!flow?.prUrl) return;
  githubCiPolling = true;
  try {
    const ci = await getGithubCiStatus(flow);
    const current = getFlow(flowId);
    if (!current || current.prUrl !== flow.prUrl || selectedGithubCiFlowId !== flowId) return;
    updateFlow(flowId, {
      githubCiStatus: ci.state,
      githubCiCheckedAt: ci.checkedAt || now(),
      githubCiTargetUrl: ci.targetUrl || flow.prUrl,
      githubCiDescription: ci.description || "",
    });
  } finally {
    githubCiPolling = false;
  }
}

setInterval(() => void pollSelectedGithubCiStatus(), 5000);

function updateFlow(id: string, fields: Partial<Flow>) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
  db.query(`update flows set ${assignments}, updatedAt = ? where id = ?`).run(
    ...entries.map(([, value]) => value),
    now(),
    id,
  );
  broadcast("flows", listClientFlows());
}

function pathIsInsideDirectory(path: string, directory: string) {
  const target = resolve(path);
  const root = resolve(directory);
  return target.startsWith(`${root}/`);
}

function flowHasWorktree(flow: Flow) {
  return Boolean(flow.checkoutPath && pathIsInsideDirectory(flow.checkoutPath, worktreeDir) && existsSync(flow.checkoutPath));
}

function assertFlowWorktree(flow: Flow) {
  if (flowHasWorktree(flow)) return flow;
  throw new Error(`Worktree does not exist: ${flow.checkoutPath}`);
}

function ensureFlowWorktree(flow: Flow) {
  if (flowHasWorktree(flow)) return flow;

  const { target, branch, baseSha } = createWorktree(flow.id, flow.linearIssueId);
  updateFlow(flow.id, { checkoutPath: target, branchName: branch, baseSha });
  insertLog(flow.id, "flow", `Created worktree ${branch}\n`);
  broadcast("checkouts", listWorktrees());
  return getFlow(flow.id) ?? { ...flow, checkoutPath: target, branchName: branch, baseSha };
}

function flowStatusAgeMs(flow: Flow, nowMs = Date.now()) {
  const updatedAt = Date.parse(flow.updatedAt);
  return Number.isFinite(updatedAt) ? nowMs - updatedAt : Number.POSITIVE_INFINITY;
}

async function recoverAgentRuntime(flow: Flow) {
  const existing = agentProcesses.get(flow.id);
  if (existing) return existing;
  if (flow.agentStatus !== "running" && flow.agentStatus !== "interrupting") return null;

  const activeTurnId = persistedActiveTurnId(flow.id);
  if (!activeTurnId) return null;

  const existingRecovery = agentRuntimeRecoveries.get(flow.id);
  if (existingRecovery) return existingRecovery;

  const recovery = (async () => {
    try {
      const runtime = await startCodexAppServer(flow);
      runtime.activeTurnId = runtime.activeTurnId || activeTurnId;
      runtime.lastSeenAt = Date.now();
      updateFlow(flow.id, { agentStatus: flow.agentStatus === "interrupting" ? "interrupting" : "running" });
      return runtime;
    } catch {
      updateFlow(flow.id, { agentStatus: "failed" });
      return null;
    }
  })();

  agentRuntimeRecoveries.set(flow.id, recovery);
  try {
    return await recovery;
  } finally {
    agentRuntimeRecoveries.delete(flow.id);
  }
}

async function reconcileAgentHeartbeat(flow: Flow, nowMs = Date.now()) {
  const shellRuntime = shellProcesses.get(flow.id);
  if (shellRuntime) {
    const shellStatus = shellRuntime.stopping ? "interrupting" : "running";
    if (flow.agentStatus !== shellStatus) {
      updateFlow(flow.id, { agentStatus: shellStatus });
      return getFlow(flow.id) ?? { ...flow, agentStatus: shellStatus };
    }
    return flow;
  }

  if (flow.agentStatus !== "running" && flow.agentStatus !== "interrupting") return flow;

  const runtime = agentProcesses.get(flow.id);
  const statusAge = flowStatusAgeMs(flow, nowMs);
  if (!runtime) {
    const recovered = await recoverAgentRuntime(flow);
    if (recovered) return getFlow(flow.id) ?? flow;
    if (statusAge < agentRuntimeStartGraceMs) return flow;
    insertLog(flow.id, "agent:error", "agent runtime disappeared while status was running\n");
    updateFlow(flow.id, { agentStatus: "failed" });
    return getFlow(flow.id) ?? flow;
  }

  if (runtime.compacting) {
    const compactingStartedAt = runtime.compactingStartedAt ?? runtime.lastSeenAt ?? nowMs;
    if (nowMs - compactingStartedAt <= agentRuntimeStaleMs) return flow;
    runtime.compacting = false;
    runtime.compactingStartedAt = undefined;
    runtime.compactionPromptLogId = undefined;
    insertLog(flow.id, "agent:error", `context compaction timed out after ${Math.round(agentRuntimeStaleMs / 1000)}s\n`);
    updateFlow(flow.id, { agentStatus: "failed" });
    void startNextQueuedAgentMessage(runtime);
    return getFlow(flow.id) ?? flow;
  }

  if (!runtime.activeTurnId) {
    if (statusAge < agentRuntimeStartGraceMs) return flow;
    insertLog(flow.id, "agent:status", "agent runtime idle while status was running");
    updateFlow(flow.id, { agentStatus: "idle" });
    return getFlow(flow.id) ?? flow;
  }

  const lastSeenAt = runtime.lastSeenAt ?? nowMs;
  if (nowMs - lastSeenAt <= agentRuntimeStaleMs) return flow;

  runtime.activeTurnId = undefined;
  runtime.activeTurnTraceAfterLogId = undefined;
  insertLog(flow.id, "agent:error", `agent heartbeat timed out after ${Math.round(agentRuntimeStaleMs / 1000)}s\n`);
  updateFlow(flow.id, { agentStatus: "failed" });
  return getFlow(flow.id) ?? flow;
}

async function sweepAgentHeartbeats() {
  const nowMs = Date.now();
  for (const flow of listFlows()) await reconcileAgentHeartbeat(flow, nowMs);
}

setInterval(() => void sweepAgentHeartbeats(), agentHeartbeatSweepIntervalMs);

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function normalizeAgentCommand(command = "") {
  const trimmed = command.trim();
  if (!trimmed || trimmed === "codex exec" || trimmed.startsWith("codex exec ")) {
    return defaultCodexAppServerCommand;
  }
  return trimmed;
}

function tomlBasicString(value: string) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\b", "\\b")
    .replaceAll("\t", "\\t")
    .replaceAll("\n", "\\n")
    .replaceAll("\f", "\\f")
    .replaceAll("\r", "\\r")}"`;
}

function ensureCodexProjectTrusted(projectPath: string) {
  const codexEnv = parseEnv(readEnvContents());
  const codexHome = codexEnv.CODEX_HOME || process.env.CODEX_HOME || join(homedir(), ".codex");
  const configPath = join(codexHome, "config.toml");
  mkdirSync(codexHome, { recursive: true });

  const config = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const header = `[projects.${tomlBasicString(resolve(projectPath))}]`;
  const sectionStart = config.indexOf(header);
  if (sectionStart !== -1) {
    const afterHeader = sectionStart + header.length;
    const nextSectionOffset = config.slice(afterHeader).search(/\n\[/);
    const sectionEnd = nextSectionOffset === -1 ? config.length : afterHeader + nextSectionOffset;
    const section = config.slice(sectionStart, sectionEnd);
    if (/^\s*trust_level\s*=\s*"trusted"\s*$/m.test(section)) return;

    const replacement = /^\s*trust_level\s*=/m.test(section)
      ? section.replace(/^\s*trust_level\s*=.*$/m, 'trust_level = "trusted"')
      : `${header}\ntrust_level = "trusted"${config.slice(afterHeader, sectionEnd)}`;
    writeFileSync(configPath, `${config.slice(0, sectionStart)}${replacement}${config.slice(sectionEnd)}`, "utf8");
    return;
  }

  const prefix = config.endsWith("\n") || config.length === 0 ? "" : "\n";
  appendFileSync(configPath, `${prefix}\n${header}\ntrust_level = "trusted"\n`, "utf8");
}

function codexThreadSettingKey(flowId: string) {
  return `codexThread:${flowId}`;
}

function codexActiveTurnSettingKey(flowId: string) {
  return `codexActiveTurn:${flowId}`;
}

function latestActiveTurnIdFromLogs(flowId: string) {
  const rows = db
    .query("select message from logs where flowId = ? and source = 'agent:status' and message like 'turn %' order by id desc limit 50")
    .all(flowId) as Array<{ message?: string }>;

  for (const row of rows) {
    const message = String(row.message || "").trim();
    const started = message.match(/^turn started\s+(\S+)/);
    if (started?.[1]) return started[1];
    if (/^turn \S+/.test(message)) return "";
  }
  return "";
}

function persistedActiveTurnId(flowId: string) {
  return getSetting(codexActiveTurnSettingKey(flowId)) || latestActiveTurnIdFromLogs(flowId);
}

function setActiveTurnId(flowId: string, turnId = "") {
  if (turnId) setSetting(codexActiveTurnSettingKey(flowId), turnId);
  else deleteSettingByKeyStmt.run(codexActiveTurnSettingKey(flowId));
}

function gitCommandLabel(args: string[]) {
  return `git ${args[0] ?? ""}`.trim();
}

function runGit(args: string[], cwd = rootDir) {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();
  if (result.exitCode !== 0) {
    const output = stderr || stdout;
    throw new Error(output ? `${gitCommandLabel(args)} failed: ${output}` : `${gitCommandLabel(args)} failed`);
  }
  return stdout;
}

async function runGh(args: string[], flow?: Flow) {
  const proc = Bun.spawn({
    cmd: ["gh", ...args],
    cwd: flow?.checkoutPath || rootDir,
    stdout: "pipe",
    stderr: "pipe",
    env: flow ? runtimeEnv(flow) : runtimeEnv(),
  });
  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const stdout = stdoutText.trim();
  const stderr = stderrText.trim();
  if (exitCode !== 0) {
    const output = stderr || stdout;
    throw new Error(output ? `gh ${args[0] ?? ""} failed: ${output}` : `gh ${args[0] ?? ""} failed`);
  }
  return stdout;
}

function parseLinearIssue(input: string) {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/i);
  const keyMatch = trimmed.match(/\b([A-Z]+-\d+)\b/i);
  const identifier = (urlMatch?.[1] ?? keyMatch?.[1] ?? trimmed).toUpperCase();
  return {
    identifier,
    url: trimmed.startsWith("http") ? trimmed : "",
  };
}

function cacheLinearIssue(issue: LinearIssue | null | undefined) {
  if (!issue?.identifier) return;
  const identifier = issue.identifier.toUpperCase();
  if (isDeletedLinearIssue(issue)) {
    linearIssueCache.delete(identifier);
    deleteLinearIssueStmt.run(identifier);
    return;
  }
  linearIssueCache.set(identifier, issue);
  upsertLinearIssueStmt.run(identifier, JSON.stringify(issue), issue.updatedAt || now());
}

function cachedLinearIssue(identifier: string) {
  const issueId = identifier.toUpperCase();
  const cached = linearIssueCache.get(issueId);
  if (cached) return cached;
  const row = linearIssueByIdentifierStmt.get(issueId) as { issueJson: string } | null;
  if (!row) return null;
  try {
    const issue = JSON.parse(row.issueJson) as LinearIssue;
    if (!issue?.identifier) return null;
    linearIssueCache.set(issue.identifier.toUpperCase(), issue);
    return issue;
  } catch {
    return null;
  }
}

function linearAuthHeader(apiKey = getSetting("linearApiKey")) {
  return apiKey;
}

class LinearUnavailableError extends Error {
  status = 503;
}

const linearUnavailableBackoffMs = 30_000;
const linearRequestTimeoutMs = 5_000;
let linearUnavailableUntil = 0;
let lastLinearUnavailableWarningAt = 0;

function isLinearNetworkError(error: unknown) {
  const value = error as { code?: unknown; message?: unknown; path?: unknown };
  const text = `${String(value?.code || "")} ${String(value?.message || "")} ${String(value?.path || "")}`;
  return /api\.linear\.app|FailedToOpenSocket|ConnectionRefused|Unable to connect/i.test(text);
}

function linearBackoffRemainingMs() {
  return Math.max(0, linearUnavailableUntil - Date.now());
}

function markLinearUnavailable() {
  linearUnavailableUntil = Date.now() + linearUnavailableBackoffMs;
}

function throwIfLinearUnavailable() {
  const remaining = linearBackoffRemainingMs();
  if (remaining > 0) {
    throw new LinearUnavailableError(`Linear is temporarily unreachable. Retrying allowed in ${Math.ceil(remaining / 1000)}s.`);
  }
}

function logLinearUnavailable(error: unknown) {
  const nowMs = Date.now();
  if (nowMs - lastLinearUnavailableWarningAt < linearUnavailableBackoffMs) return;
  lastLinearUnavailableWarningAt = nowMs;
  console.warn(error instanceof Error ? error.message : String(error));
}

function linearConfigPayload() {
  const hasApiKey = Boolean(getSetting("linearApiKey"));
  return {
    signedIn: hasApiKey,
    hasApiKey,
    viewerName: hasApiKey ? getSetting("linearViewerName") : "",
  };
}

async function linearGraphql<T>(query: string, variables: Record<string, unknown> = {}, apiKey?: string) {
  const authorization = linearAuthHeader(apiKey);
  if (!authorization) {
    throw new Error("Linear is not connected. Add your Linear API key in the top-right Linear configuration.");
  }

  throwIfLinearUnavailable();
  let response: Response;
  try {
    response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        "public-file-urls-expire-in": "3600",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(linearRequestTimeoutMs),
    });
  } catch (error) {
    if (isLinearNetworkError(error)) {
      markLinearUnavailable();
      throw new LinearUnavailableError("Linear is unreachable. Check your network connection.");
    }
    throw error;
  }
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (!response.ok) throw new Error(`Linear GraphQL failed: ${response.status}`);
  if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
  if (!body.data) throw new Error("Linear returned no data.");
  return body.data;
}

async function fetchLinearAttachment(rawUrl: string) {
  const authorization = linearAuthHeader();
  if (!authorization) {
    return new Response("Linear is not connected.", { status: 401 });
  }

  let attachmentUrl: URL;
  try {
    attachmentUrl = new URL(rawUrl);
  } catch {
    return new Response("Invalid attachment URL.", { status: 400 });
  }

  if (attachmentUrl.protocol !== "https:" || attachmentUrl.hostname !== "uploads.linear.app") {
    return new Response("Unsupported attachment URL.", { status: 400 });
  }

  const response = await fetch(attachmentUrl, {
    headers: {
      authorization,
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(linearRequestTimeoutMs),
  });

  if (response.status >= 300 && response.status < 400) {
    return new Response("Linear redirected this attachment instead of returning image data.", { status: 502 });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) return new Response(`Linear attachment fetch failed: ${response.status}`, { status: response.status });
  if (!contentType.startsWith("image/")) {
    return new Response("Linear attachment response was not an image.", { status: 502 });
  }

  return new Response(response.body, {
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=300",
    },
  });
}

function repoBasename(repo: string) {
  return basename(repo.replace(/\.git$/, "").replace(/\/$/, "")) || "repo";
}

function safeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function ensureRepoCheckout(repoUrl: string) {
  if (!existsSync(repoCheckoutDir)) {
    runGit(["clone", repoUrl, repoCheckoutDir]);
    runGit(["config", "advice.detachedHead", "false"], repoCheckoutDir);
    return;
  }

  const configuredUrl = runGit(["remote", "get-url", "origin"], repoCheckoutDir);
  if (configuredUrl !== repoUrl) {
    const hasExistingWorktrees = listWorktreeDirectories().some((entry) => isGitWorktree(entry.path));
    if (hasExistingWorktrees) {
      throw new Error("Configured repo URL changed. Delete existing worktrees before switching repositories.");
    }
    rmSync(repoCheckoutDir, { recursive: true, force: true });
    runGit(["clone", repoUrl, repoCheckoutDir]);
    runGit(["config", "advice.detachedHead", "false"], repoCheckoutDir);
    return;
  }

  runGit(["worktree", "prune"], repoCheckoutDir);
}

function pullWarmedRepo() {
  if (warmedRepoPulling) return;
  if (!serverHasActiveWork()) return;
  if (!existsSync(repoCheckoutDir)) return;
  const repoUrl = getSetting("repoUrl");
  if (!repoUrl) return;
  warmedRepoPulling = true;
  try {
    const configuredUrl = runGit(["remote", "get-url", "origin"], repoCheckoutDir);
    if (configuredUrl !== repoUrl) return;
    runGit(["worktree", "prune"], repoCheckoutDir);
    runGit(["pull", "--ff-only"], repoCheckoutDir);
  } catch (error) {
    console.warn(`warmed repo pull failed: ${String(error)}`);
  } finally {
    warmedRepoPulling = false;
  }
}

setInterval(pullWarmedRepo, warmedRepoPullIntervalMs);

function createWorktree(flowId: string, issueId: string) {
  const repoUrl = getSetting("repoUrl");
  if (!repoUrl) throw new Error("Configure a repo before creating a flow.");

  const target = join(worktreeDir, `${safeSlug(issueId)}-${flowId.slice(0, 8)}`);
  if (existsSync(target)) throw new Error(`Worktree already exists: ${target}`);

  ensureRepoCheckout(repoUrl);
  const baseSha = runGit(["rev-parse", "HEAD"], repoCheckoutDir);
  let branch = `turbo/${safeSlug(issueId)}`;
  try {
    runGit(["worktree", "add", "-b", branch, target, baseSha], repoCheckoutDir);
  } catch (error) {
    if (!/\balready exists\b|\bis already checked out\b/i.test(String(error))) throw error;
    branch = `${branch}-${flowId.slice(0, 8)}`;
    runGit(["worktree", "add", "-b", branch, target, baseSha], repoCheckoutDir);
  }
  return { target, branch, baseSha };
}

async function streamProcessOutput(
  flowId: string,
  source: string,
  stream: ReadableStream<Uint8Array> | null,
) {
  if (!stream) return;
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) insertLog(flowId, source, decoder.decode(value, { stream: true }));
  }
  const remainder = decoder.decode();
  if (remainder) insertLog(flowId, source, remainder);
}

function signalProcessGroup(pid: number, signal: RuntimeSignal) {
  let signaled = false;
  try {
    process.kill(-pid, signal);
    signaled = true;
  } catch {
    // The process may not be a process-group leader, or it may already be gone.
  }
  return signaled;
}

function signalRuntimeProcess(runtime: RuntimeProcess, signal: RuntimeSignal) {
  let signaled = signalProcessGroup(runtime.proc.pid, signal);
  try {
    runtime.proc.kill(signal);
    signaled = true;
  } catch {
    // The group signal above may already have handled it.
  }
  return signaled;
}

function cleanupPersistedServeProcess() {
  const pid = persistedServePid();
  if (!pid) return;
  const flowId = persistedServeFlowId();
  signalProcessGroup(pid, "SIGTERM");
  if (flowId) insertLog(flowId, "serve", "\n[stale serve process stopped by Turbopump]\n");
  db.query("update flows set serving = 0").run();
  clearPersistedServeProcess();
  setTimeout(() => signalProcessGroup(pid, "SIGKILL"), 1500);
}

function forgetRuntimeProcess(runtime: RuntimeProcess) {
  if (runtime.kind === "agent" && agentProcesses.get(runtime.flowId) === runtime) agentProcesses.delete(runtime.flowId);
  if (runtime.kind === "shell" && shellProcesses.get(runtime.flowId) === runtime) shellProcesses.delete(runtime.flowId);
  if (runtime.kind === "serve" && serveProcess === runtime) serveProcess = null;
}

function cleanupFailedRuntimeProcess(runtime: RuntimeProcess, reason: string) {
  runtime.stopping = true;
  rejectCodexPending(runtime, new Error(reason));
  forgetRuntimeProcess(runtime);
  signalRuntimeProcess(runtime, "SIGTERM");
  setTimeout(() => {
    if (runtime.proc.exitCode === null) signalRuntimeProcess(runtime, "SIGKILL");
  }, 1500);
}

function scheduleShellInterruptEscalation(flowId: string, runtime: RuntimeProcess) {
  setTimeout(() => {
    if (shellProcesses.get(flowId) !== runtime) return;
    insertLog(flowId, "shell:status", "shell interrupt escalated");
    signalRuntimeProcess(runtime, "SIGTERM");
  }, 1500);
  setTimeout(() => {
    if (shellProcesses.get(flowId) !== runtime) return;
    insertLog(flowId, "shell:status", "shell interrupt forced cleanup");
    signalRuntimeProcess(runtime, "SIGKILL");
    shellProcesses.delete(flowId);
    updateFlow(flowId, { agentStatus: "idle" });
  }, 3500);
}

function writeCodexMessage(runtime: RuntimeProcess, message: Record<string, unknown>) {
  if (runtime.kind !== "agent") throw new Error("Codex messages can only be sent to agent processes.");
  runtime.proc.stdin?.write(`${JSON.stringify(message)}\n`);
}

function sendCodexNotification(runtime: RuntimeProcess, method: string, params?: unknown) {
  writeCodexMessage(runtime, {
    method,
    ...(params === undefined ? {} : { params }),
  });
}

function sendCodexRequest(runtime: RuntimeProcess, method: string, params?: unknown) {
  if (!runtime.pending) runtime.pending = new Map();
  runtime.requestId = (runtime.requestId ?? 0) + 1;
  const id = runtime.requestId;
  const promise = new Promise<unknown>((resolve, reject) => {
    runtime.pending?.set(id, { method, resolve, reject });
  });
  writeCodexMessage(runtime, {
    method,
    id,
    ...(params === undefined ? {} : { params }),
  });
  return promise;
}

function textInput(text: string) {
  return [{ type: "text", text, text_elements: [] }];
}

function isNoActiveTurnInterruptError(error: unknown) {
  return error instanceof Error && /no active turn to interrupt/i.test(error.message);
}

function isNoActiveTurnSteerError(error: unknown) {
  return error instanceof Error && /no active turn to steer/i.test(error.message);
}

function codexThreadMetadata(payload: {
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
}) {
  return {
    agentModel: payload.model ?? "",
    agentReasoningEffort: payload.reasoningEffort ?? "",
    agentServiceTier: payload.serviceTier ?? "",
  };
}

function agentTemplateContext(flow: Flow) {
  return {
    flowId: flow.id,
    linearIssueId: flow.linearIssueId,
    title: flow.title,
    prUrl: flow.prUrl,
    checkoutPath: flow.checkoutPath,
    flowMetaApiUrl: `${apiBaseUrl}/api/flows/${flow.id}/meta`,
  };
}

function renderAgentTemplate(template: string, flow: Flow) {
  const context = agentTemplateContext(flow);
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key: string) =>
    key in context ? context[key as keyof typeof context] : match,
  );
}

function getAgentDeveloperInstructionsTemplate() {
  const stored = getStoredSetting("agentDeveloperInstructions");
  if (stored !== null) return stored;
  setSetting("agentDeveloperInstructions", defaultAgentDeveloperInstructions);
  return defaultAgentDeveloperInstructions;
}

function flowDeveloperInstructions(flow: Flow) {
  return renderAgentTemplate(getAgentDeveloperInstructionsTemplate(), flow);
}

function codexThreadOverrides(flow: Flow) {
  return {
    ...(flow.agentModel ? { model: flow.agentModel } : {}),
    ...(reasoningEfforts.has(flow.agentReasoningEffort as ReasoningEffort)
      ? { reasoningEffort: flow.agentReasoningEffort as ReasoningEffort }
      : {}),
    ...(serviceTiers.has(flow.agentServiceTier as ServiceTier)
      ? { serviceTier: flow.agentServiceTier as ServiceTier }
      : {}),
  };
}

function codexTurnOverrides(flow: Flow) {
  return codexThreadOverrides(flow);
}

function configuredAgentMetadata(flow: Flow): Partial<Flow> {
  return {
    ...(flow.agentModel ? { agentModel: flow.agentModel } : {}),
    ...(reasoningEfforts.has(flow.agentReasoningEffort as ReasoningEffort)
      ? { agentReasoningEffort: flow.agentReasoningEffort }
      : {}),
    ...(serviceTiers.has(flow.agentServiceTier as ServiceTier) ? { agentServiceTier: flow.agentServiceTier } : {}),
    ...(agentSandboxes.has(flow.agentSandbox as AgentSandbox) ? { agentSandbox: flow.agentSandbox } : {}),
  };
}

function codexSandboxMode(flow: Flow): AgentSandbox {
  return agentSandboxes.has(flow.agentSandbox as AgentSandbox)
    ? (flow.agentSandbox as AgentSandbox)
    : "danger-full-access";
}

function codexSandboxPolicy(flow: Flow) {
  const sandbox = codexSandboxMode(flow);
  if (sandbox === "read-only") return { type: "readOnly", networkAccess: true };
  if (sandbox === "workspace-write") {
    return {
      type: "workspaceWrite",
      writableRoots: [flow.checkoutPath],
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  }
  return { type: "dangerFullAccess" };
}

function optionalInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function codexTokenUsageMetadata(params: Record<string, unknown>): Partial<Flow> {
  const tokenUsage = params.tokenUsage as Record<string, unknown> | undefined;
  const last = tokenUsage?.last as Record<string, unknown> | undefined;
  return {
    agentContextTokensUsed: optionalInteger(last?.inputTokens),
    agentContextWindow: optionalInteger(tokenUsage?.modelContextWindow),
  };
}

function codexThreadParams(flow: Flow, sessionStartSource: ThreadStartSource = "startup") {
  return {
    ...codexThreadOverrides(flow),
    cwd: flow.checkoutPath,
    approvalPolicy: "on-failure",
    approvalsReviewer: "auto_review",
    sandbox: codexSandboxMode(flow),
    developerInstructions: flowDeveloperInstructions(flow),
    serviceName: "turbopump",
    experimentalRawEvents: false,
    persistExtendedHistory: true,
    sessionStartSource,
  };
}

function codexThreadResumeParams(flow: Flow, threadId: string) {
  return {
    ...codexThreadOverrides(flow),
    threadId,
    cwd: flow.checkoutPath,
    approvalPolicy: "on-failure",
    approvalsReviewer: "auto_review",
    sandbox: codexSandboxMode(flow),
    developerInstructions: flowDeveloperInstructions(flow),
    persistExtendedHistory: true,
  };
}

function codexTurnParams(runtime: RuntimeProcess, flow: Flow, message: string) {
  if (!runtime.threadId) throw new Error("Codex thread is not ready.");
  return {
    threadId: runtime.threadId,
    input: textInput(message),
    cwd: flow.checkoutPath,
    approvalPolicy: "on-failure",
    approvalsReviewer: "auto_review",
    sandboxPolicy: codexSandboxPolicy(flow),
    ...codexTurnOverrides(flow),
  };
}

function rejectCodexPending(runtime: RuntimeProcess, error: Error) {
  for (const pending of runtime.pending?.values() ?? []) {
    pending.reject(error);
  }
  runtime.pending?.clear();
}

function resolveCodexResponse(runtime: RuntimeProcess, message: Record<string, unknown>) {
  if (typeof message.id !== "number") return false;
  if (!("result" in message) && !("error" in message)) return false;
  const pending = runtime.pending?.get(message.id);
  if (!pending) return true;
  runtime.pending?.delete(message.id);
  if ("error" in message && message.error) {
    const details = message.error as { message?: string };
    pending.reject(new Error(details.message || `${pending.method} failed`));
  } else {
    pending.resolve(message.result);
  }
  return true;
}

function codexItemStartedLog(item: Record<string, unknown>) {
  if (item.type === "commandExecution") {
    return { source: "agent:tool", message: String(item.command ?? "") };
  }
  if (item.type === "fileChange") {
    return { source: "agent:tool", message: "apply_patch" };
  }
  if (item.type === "mcpToolCall") {
    return { source: "agent:tool", message: `${String(item.server ?? "")}.${String(item.tool ?? "")}` };
  }
  if (item.type === "webSearch") {
    const query = String(item.query ?? "");
    return { source: "agent:tool", message: query ? `web search: ${query}` : "web search" };
  }
  return null;
}

function codexItemCompletedLog(item: Record<string, unknown>) {
  if (item.type === "commandExecution") {
    const status = String(item.status ?? "completed");
    const exit = item.exitCode === null || item.exitCode === undefined ? "" : ` exit ${item.exitCode}`;
    return { source: "agent:tool-result", message: `${status}${exit}` };
  }
  if (item.type === "fileChange") {
    return { source: "agent:tool-result", message: `file changes ${String(item.status ?? "completed")}` };
  }
  if (item.type === "mcpToolCall") {
    return { source: "agent:tool-result", message: `mcp ${String(item.status ?? "completed")}` };
  }
  if (item.type === "agentMessage") {
    return { source: "agent:message-boundary", message: "" };
  }
  return null;
}

function handleCodexServerRequest(runtime: RuntimeProcess, message: Record<string, unknown>) {
  const method = String(message.method ?? "");
  const id = message.id;
  if (typeof id !== "number") return false;

  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    insertLog(runtime.flowId, "agent:approval", `${method} accepted by Turbopump auto-approver`);
    writeCodexMessage(runtime, { id, result: { decision: "acceptForSession" } });
    return true;
  }

  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    insertLog(runtime.flowId, "agent:approval", `${method} approved by Turbopump auto-approver`);
    writeCodexMessage(runtime, { id, result: { decision: "approved_for_session" } });
    return true;
  }

  if (method === "item/permissions/requestApproval") {
    const params = (message.params ?? {}) as { permissions?: unknown };
    insertLog(runtime.flowId, "agent:approval", "permissions approved by Turbopump auto-approver");
    writeCodexMessage(runtime, {
      id,
      result: {
        permissions: params.permissions ?? { network: { enabled: true }, fileSystem: null },
        scope: "session",
      },
    });
    return true;
  }

  if (method === "mcpServer/elicitation/request") {
    insertLog(runtime.flowId, "agent:approval", "MCP elicitation declined");
    writeCodexMessage(runtime, { id, result: { action: "decline", content: null } });
    return true;
  }

  if (method === "item/tool/requestUserInput") {
    insertLog(runtime.flowId, "agent:input", "user input request returned empty answers");
    writeCodexMessage(runtime, { id, result: { answers: {} } });
    return true;
  }

  insertLog(runtime.flowId, "agent:protocol", `unsupported server request ${method}`);
  writeCodexMessage(runtime, {
    id,
    error: { code: -32601, message: `Turbopump does not support ${method}` },
  });
  return true;
}

function isUserLogSource(source: string) {
  return source === "user" || source === "user:queued";
}

function isAgentMessageBoundarySource(source: string) {
  return source === "agent:message-boundary";
}

function isTraceCountSource(source: string) {
  return !isAgentMessageBoundarySource(source) && source !== "user:queued";
}

function createTraceGroupBetweenLogs(flowId: string, afterId: number, beforeId: number, kind = "") {
  if (beforeId <= afterId) return;

  const logs = (logsAfterStmt.all(flowId, afterId) as LogRow[]).filter(
    (log) => log.id < beforeId && isTraceCountSource(log.source),
  );
  const traceCount = logs.length;
  if (traceCount <= 1) return;

  insertLog(
    flowId,
    kind === "shell" ? "shell:trace-group" : "agent:trace-group",
    JSON.stringify({
      afterId,
      beforeId,
      count: traceCount,
      ...(kind ? { kind } : {}),
    }),
  );
}

function createCompletedTurnTraceGroup(flowId: string, beforeId: number) {
  const prompt = latestUserLogBeforeStmt.get(flowId, beforeId) as { id: number } | null;
  if (!prompt) return;

  createTraceGroupBetweenLogs(flowId, prompt.id, beforeId);
}

function createCompletedTurnTraceGroupAfterLog(flowId: string, afterId: number | undefined, beforeId: number) {
  if (afterId) {
    createTraceGroupBetweenLogs(flowId, afterId, beforeId);
    return;
  }
  createCompletedTurnTraceGroup(flowId, beforeId);
}

function worktreeBranchUpdate(flowId: string): Partial<Flow> {
  const existing = getFlow(flowId);
  if (!existing?.checkoutPath) return {};
  try {
    const flow = assertFlowWorktree(existing);
    const branchName = runGit(["rev-parse", "--abbrev-ref", "HEAD"], flow.checkoutPath);
    return branchName && branchName !== flow.branchName ? { branchName } : {};
  } catch (error) {
    insertLog(flowId, "agent:status", `could not read worktree branch: ${String(error)}`);
    return {};
  }
}

function updateRuntimeThreadFromParams(runtime: RuntimeProcess, params: Record<string, unknown>) {
  const thread = params.thread as { id?: string } | undefined;
  if (!thread?.id || thread.id === runtime.threadId) return;
  runtime.threadId = thread.id;
  setSetting(codexThreadSettingKey(runtime.flowId), thread.id);
}

function finishCodexCompaction(runtime: RuntimeProcess, params: Record<string, unknown>) {
  updateRuntimeThreadFromParams(runtime, params);
  runtime.activeTurnId = undefined;
  runtime.activeTurnTraceAfterLogId = undefined;
  runtime.compacting = false;
  runtime.compactingStartedAt = undefined;
  const compactionPromptLogId = runtime.compactionPromptLogId;
  runtime.compactionPromptLogId = undefined;
  const contextCompactedLogId = insertLog(runtime.flowId, "agent:status", "context compacted");
  deleteQueuedAgentMessagePlaceholders(runtime);
  if (compactionPromptLogId) createTraceGroupBetweenLogs(runtime.flowId, compactionPromptLogId, contextCompactedLogId + 1, "compact");
  updateFlow(runtime.flowId, { agentStatus: "idle" });
  void startNextQueuedAgentMessage(runtime);
}

function handleCodexNotification(runtime: RuntimeProcess, message: Record<string, unknown>) {
  const method = String(message.method ?? "");
  const params = (message.params ?? {}) as Record<string, unknown>;
  const threadId = typeof params.threadId === "string" ? params.threadId : "";
  if (threadId && runtime.threadId && threadId !== runtime.threadId) return;

  if (method === "turn/started") {
    const turn = params.turn as { id?: string } | undefined;
    runtime.activeTurnId = turn?.id;
    setActiveTurnId(runtime.flowId, runtime.activeTurnId ?? "");
    insertLog(runtime.flowId, "agent:status", `turn started ${runtime.activeTurnId ?? ""}`);
    updateFlow(runtime.flowId, { agentStatus: "running" });
    return;
  }

  if (method === "turn/completed") {
    const turn = params.turn as { id?: string; status?: string; error?: { message?: string } | null } | undefined;
    if (!turn?.id || turn.id === runtime.activeTurnId) runtime.activeTurnId = undefined;
    if (!runtime.activeTurnId) setActiveTurnId(runtime.flowId);
    const activeTurnTraceAfterLogId = runtime.activeTurnTraceAfterLogId;
    if (!runtime.activeTurnId) runtime.activeTurnTraceAfterLogId = undefined;
    if (runtime.compacting && turn?.status !== "failed") {
      finishCodexCompaction(runtime, params);
      return;
    }
    const turnStatusLogId = insertLog(runtime.flowId, "agent:status", `turn ${turn?.status ?? "completed"}`);
    createCompletedTurnTraceGroupAfterLog(runtime.flowId, activeTurnTraceAfterLogId, turnStatusLogId + 1);
    if (turn?.error?.message) insertLog(runtime.flowId, "agent:error", `${turn.error.message}\n`);
    if (runtime.compacting) {
      runtime.compacting = false;
      runtime.compactingStartedAt = undefined;
      runtime.compactionPromptLogId = undefined;
    }
    updateFlow(runtime.flowId, {
      ...worktreeBranchUpdate(runtime.flowId),
      agentStatus: turn?.status === "failed" ? "failed" : "idle",
    });
    if (turn?.status !== "failed") void startNextQueuedAgentMessage(runtime);
    return;
  }

  if (method === "thread/compacted") {
    if (runtime.compacting) finishCodexCompaction(runtime, params);
    else updateRuntimeThreadFromParams(runtime, params);
    return;
  }

  if (method === "model/rerouted") {
    const toModel = typeof params.toModel === "string" ? params.toModel : "";
    if (toModel) updateFlow(runtime.flowId, { agentModel: toModel });
    return;
  }

  if (method === "thread/tokenUsage/updated") {
    updateFlow(runtime.flowId, codexTokenUsageMetadata(params));
    return;
  }

  if (method === "item/agentMessage/delta") {
    insertLog(runtime.flowId, "agent:message", String(params.delta ?? ""));
    return;
  }

  if (method === "item/reasoning/summaryTextDelta") {
    insertLog(runtime.flowId, "agent:reasoning", String(params.delta ?? ""));
    return;
  }

  if (method === "item/commandExecution/outputDelta") {
    insertLog(runtime.flowId, "agent:cmd", String(params.delta ?? ""));
    return;
  }

  if (method === "item/started") {
    const item = params.item as Record<string, unknown> | undefined;
    if (!item) return;
    const log = codexItemStartedLog(item);
    if (log) insertLog(runtime.flowId, log.source, log.message);
    return;
  }

  if (method === "item/completed") {
    const item = params.item as Record<string, unknown> | undefined;
    if (!item) return;
    const log = codexItemCompletedLog(item);
    if (log) insertLog(runtime.flowId, log.source, log.message);
    return;
  }

  if (method === "error") {
    const error = params.error as { message?: string } | undefined;
    const wasCompacting = Boolean(runtime.compacting);
    if (wasCompacting) {
      runtime.compacting = false;
      runtime.compactingStartedAt = undefined;
      runtime.compactionPromptLogId = undefined;
    }
    insertLog(runtime.flowId, "agent:error", `${error?.message ?? JSON.stringify(params)}\n`);
    if (wasCompacting) updateFlow(runtime.flowId, { agentStatus: runtime.activeTurnId ? "running" : "failed" });
  }
}

function handleCodexMessage(runtime: RuntimeProcess, message: Record<string, unknown>) {
  runtime.lastSeenAt = Date.now();
  if (resolveCodexResponse(runtime, message)) return;
  if (message.method && typeof message.id === "number") {
    handleCodexServerRequest(runtime, message);
    return;
  }
  if (message.method) handleCodexNotification(runtime, message);
}

async function streamCodexAppServerOutput(
  runtime: RuntimeProcess,
  stream: ReadableStream<Uint8Array> | null,
) {
  if (!stream) return;
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    runtime.stdoutBuffer = `${runtime.stdoutBuffer ?? ""}${value ? decoder.decode(value, { stream: true }) : ""}`;
    const lines = runtime.stdoutBuffer.split(/\r?\n/);
    runtime.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        handleCodexMessage(runtime, JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        insertLog(runtime.flowId, "agent:protocol", line);
      }
    }
  }
  const remainder = decoder.decode();
  if (remainder) runtime.stdoutBuffer = `${runtime.stdoutBuffer ?? ""}${remainder}`;
}

function spawnLoggedProcess(
  flow: Flow,
  kind: "agent" | "serve",
  command: string,
  source: string,
) {
  const proc = Bun.spawn(["/bin/zsh", "-lc", command], {
    cwd: flow.checkoutPath,
    env: runtimeEnv(flow),
    detached: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const runtime = { flowId: flow.id, kind, proc };
  insertLog(flow.id, source, `$ ${command}\n`);
  void streamProcessOutput(flow.id, source, proc.stdout);
  void streamProcessOutput(flow.id, `${source}:stderr`, proc.stderr);
  void proc.exited.then((code) => {
    insertLog(flow.id, source, `\n[process exited with code ${code}]\n`);
    if (kind === "agent" && agentProcesses.get(flow.id)?.proc === proc) {
      agentProcesses.delete(flow.id);
      updateFlow(flow.id, { agentStatus: code === 0 ? "idle" : "failed" });
    }
    if (kind === "serve") {
      clearPersistedServeProcess(runtime);
      if (serveProcess?.proc === proc) {
        serveProcess = null;
        updateFlow(flow.id, { serving: 0 });
      }
    }
  });

  return runtime;
}

async function startCodexAppServer(flow: Flow) {
  const activeFlow = assertFlowWorktree(flow);
  const command = normalizeAgentCommand(getSetting("agentCommand", defaultCodexAppServerCommand));
  const env = runtimeEnv(activeFlow);
  try {
    ensureCodexProjectTrusted(activeFlow.checkoutPath);
  } catch (error) {
    insertLog(activeFlow.id, "agent:status", `could not trust Codex worktree: ${String(error)}`);
  }

  const proc = Bun.spawn(["/bin/zsh", "-lc", command], {
    cwd: activeFlow.checkoutPath,
    env,
    detached: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const runtime: RuntimeProcess = {
    flowId: activeFlow.id,
    kind: "agent",
    proc,
    command,
    requestId: 0,
    stdoutBuffer: "",
    lastSeenAt: Date.now(),
    pending: new Map(),
  };

  agentProcesses.set(activeFlow.id, runtime);
  insertLog(activeFlow.id, "agent:status", `$ ${command}`);
  void streamCodexAppServerOutput(runtime, proc.stdout);
  void streamProcessOutput(activeFlow.id, "agent:stderr", proc.stderr);
  void proc.exited.then((code) => {
    rejectCodexPending(runtime, new Error(`codex app-server exited with code ${code}`));
    if (agentProcesses.get(activeFlow.id)?.proc === proc) {
      agentProcesses.delete(activeFlow.id);
      updateFlow(activeFlow.id, {
        agentStatus: runtime.stopping ? "stopped" : code === 0 ? "idle" : "failed",
      });
    }
    insertLog(activeFlow.id, "agent:status", `app-server exited with code ${code}`);
  });

  try {
    await sendCodexRequest(runtime, "initialize", {
      clientInfo: {
        name: "turbopump",
        title: "Turbopump",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    sendCodexNotification(runtime, "initialized");

    const savedThreadId = getSetting(codexThreadSettingKey(activeFlow.id));
    let threadResponse: unknown;
    if (savedThreadId) {
      try {
        threadResponse = await sendCodexRequest(runtime, "thread/resume", {
          ...codexThreadResumeParams(activeFlow, savedThreadId),
        });
      } catch (error) {
        insertLog(activeFlow.id, "agent:status", `could not resume Codex thread ${savedThreadId}: ${String(error)}`);
      }
    }
    if (!threadResponse) {
      threadResponse = await sendCodexRequest(runtime, "thread/start", codexThreadParams(activeFlow));
    }

    const threadPayload = threadResponse as {
      thread?: { id?: string };
      model?: string;
      reasoningEffort?: string | null;
      serviceTier?: string | null;
    };
    const thread = threadPayload.thread;
    if (!thread?.id) throw new Error("Codex app-server did not return a thread id.");
    runtime.threadId = thread.id;
    if (activeFlow.agentStatus === "running" || activeFlow.agentStatus === "interrupting") {
      runtime.activeTurnId = persistedActiveTurnId(activeFlow.id) || runtime.activeTurnId;
    }
    setSetting(codexThreadSettingKey(activeFlow.id), thread.id);
    updateFlow(activeFlow.id, { ...codexThreadMetadata(threadPayload), ...configuredAgentMetadata(activeFlow) });
    insertLog(activeFlow.id, "agent:status", `Codex thread ${thread.id} ready`);
    return runtime;
  } catch (error) {
    insertLog(activeFlow.id, "agent:status", `cleaning up failed app-server startup: ${String(error)}`);
    cleanupFailedRuntimeProcess(runtime, `codex app-server startup failed: ${String(error)}`);
    throw error;
  }
}

async function sendAgentTurn(runtime: RuntimeProcess, flow: Flow, message: string, userLogId = 0) {
  if (!runtime.threadId) throw new Error("Codex thread is not ready.");
  runtime.lastSeenAt = Date.now();
  if (runtime.activeTurnId) {
    try {
      await sendCodexRequest(runtime, "turn/steer", {
        threadId: runtime.threadId,
        input: textInput(message),
        expectedTurnId: runtime.activeTurnId,
      });
      return;
    } catch (error) {
      if (!isNoActiveTurnSteerError(error)) throw error;
      runtime.activeTurnId = undefined;
      runtime.activeTurnTraceAfterLogId = undefined;
      setActiveTurnId(runtime.flowId);
      insertLog(runtime.flowId, "agent:status", "stale active turn cleared before starting a new turn");
    }
  }
  const response = (await sendCodexRequest(runtime, "turn/start", codexTurnParams(runtime, flow, message))) as {
    turn?: { id?: string };
  };
  runtime.activeTurnId = response.turn?.id;
  runtime.activeTurnTraceAfterLogId = userLogId || undefined;
  setActiveTurnId(runtime.flowId, runtime.activeTurnId ?? "");
}

function parseSlashCommand(message: string) {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return null;
  const [command] = trimmed.split(/\s+/, 1);
  return command.toLowerCase();
}

function isCompactSlashCommand(message: string) {
  return parseSlashCommand(message) === "/compact";
}

function slashCommandArgs(message: string) {
  const trimmed = message.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return "";
  return trimmed.slice(firstSpace).trim();
}

function agentSandboxForSlashCommand(value: string): AgentSandbox | "" {
  const sandbox = value.toLowerCase();
  return sandbox === "full-access" ? "danger-full-access" : agentSandboxes.has(sandbox as AgentSandbox) ? (sandbox as AgentSandbox) : "";
}

function reviewPromptForSlashCommand(message: string) {
  const [preset = "", ...rest] = slashCommandArgs(message).split(/\s+/);
  const detail = rest.join(" ").trim();
  if (preset === "base") {
    const base = detail ? ` against base branch/ref ${detail}` : " against the base branch";
    return `Review the current changes${base}. Treat this as a PR-style review. ${reviewFindingInstructions}`;
  }
  if (preset === "uncommitted") {
    return `Review the uncommitted changes in the working tree. ${reviewFindingInstructions}`;
  }
  if (preset === "commit") {
    const target = detail ? ` ${detail}` : "";
    return `Review commit${target}. If no commit ref is specified, ask the user which commit to review. ${reviewFindingInstructions}`;
  }
  if (preset === "custom") {
    if (!detail) return "Ask the user for custom review instructions before reviewing.";
    return `Review the current changes using these custom review instructions:\n\n${detail}\n\n${reviewFindingInstructions}`;
  }
  throw new Error("Usage: /review base [branch]|uncommitted|commit [ref]|custom [instructions]");
}

async function ensureCodexRuntime(flow: Flow) {
  return agentProcesses.get(flow.id) ?? (await startCodexAppServer(flow));
}

async function startFreshCodexThread(runtime: RuntimeProcess, flow: Flow) {
  if (runtime.activeTurnId) throw new Error("Cannot clear while a Codex turn is running.");
  runtime.activeTurnTraceAfterLogId = undefined;
  runtime.compacting = false;
  runtime.compactingStartedAt = undefined;
  runtime.compactionPromptLogId = undefined;
  runtime.queuedAgentMessages = [];
  const threadResponse = (await sendCodexRequest(runtime, "thread/start", codexThreadParams(flow, "clear"))) as {
    thread?: { id?: string };
    model?: string;
    reasoningEffort?: string | null;
    serviceTier?: string | null;
  };
  const thread = threadResponse.thread;
  if (!thread?.id) throw new Error("Codex app-server did not return a thread id.");
  runtime.threadId = thread.id;
  runtime.activeTurnId = undefined;
  runtime.activeTurnTraceAfterLogId = undefined;
  setActiveTurnId(flow.id);
  setSetting(codexThreadSettingKey(flow.id), thread.id);
  updateFlow(flow.id, {
    ...codexThreadMetadata(threadResponse),
    ...configuredAgentMetadata(flow),
    agentContextTokensUsed: 0,
  });
  insertLog(flow.id, "agent:status", "context cleared");
  updateFlow(flow.id, { agentStatus: "idle" });
}

async function compactCodexThread(runtime: RuntimeProcess, flow: Flow, promptLogId?: number) {
  if (!runtime.threadId) throw new Error("Codex thread is not ready.");
  if (runtime.activeTurnId) throw new Error("Cannot compact while a Codex turn is running.");
  runtime.compacting = true;
  runtime.compactingStartedAt = Date.now();
  runtime.compactionPromptLogId = promptLogId;
  insertLog(flow.id, "agent:status", "compact requested");
  updateFlow(flow.id, { agentStatus: "running" });
  try {
    await sendCodexRequest(runtime, "thread/compact/start", { threadId: runtime.threadId });
  } catch (error) {
    runtime.compacting = false;
    runtime.compactingStartedAt = undefined;
    runtime.compactionPromptLogId = undefined;
    updateFlow(flow.id, { agentStatus: "failed" });
    throw error;
  }
}

function formatCodexPluginList(stdout: string) {
  const parsed = JSON.parse(stdout) as {
    installed?: Array<{ pluginId?: unknown; name?: unknown; enabled?: unknown; version?: unknown }>;
  };
  const plugins = parsed.installed ?? [];
  if (!plugins.length) return "No installed Codex plugins.";
  return [
    "| Plugin | Status | Version |",
    "| --- | --- | --- |",
    ...plugins.map((plugin) =>
      [
        `| ${String(plugin.pluginId || plugin.name || "unknown")} `,
        `${plugin.enabled === false ? "installed, disabled" : "installed, enabled"} `,
        `${typeof plugin.version === "string" ? plugin.version : ""} |`,
      ].join("| "),
    ),
  ].join("\n");
}

async function listCodexPlugins(flow: Flow) {
  updateFlow(flow.id, { agentStatus: "running" });
  insertLog(flow.id, "agent:status", "listing Codex plugins");
  const proc = Bun.spawn({
    cmd: ["codex", "plugin", "list", "--json"],
    cwd: flow.checkoutPath,
    stdout: "pipe",
    stderr: "pipe",
    env: runtimeEnv(flow),
  });
  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const stdout = stdoutText.trim();
  const stderr = stderrText.trim();
  if (stdout) insertLog(flow.id, "agent:message", `${formatCodexPluginList(stdout)}\n`);
  if (stderr) insertLog(flow.id, exitCode === 0 ? "agent:status" : "agent:error", `${stderr}\n`);
  updateFlow(flow.id, { agentStatus: exitCode === 0 ? "idle" : "failed" });
  if (exitCode !== 0) throw new Error(stderr || stdout || "codex plugin list failed");
}

async function startAgentTurnAfterUserLog(flow: Flow, userLogId: number, agentMessage: string) {
  updateFlow(flow.id, { agentStatus: "running" });
  const updated = getFlow(flow.id);
  if (!updated) throw new Error("Flow disappeared while starting agent.");

  const existingRuntime = agentProcesses.get(flow.id);
  let runtime: RuntimeProcess | undefined;
  let createdRuntime = false;
  try {
    runtime = existingRuntime;
    if (!runtime) {
      runtime = await startCodexAppServer(updated);
      createdRuntime = true;
    }
    await sendAgentTurn(runtime, updated, agentMessage, userLogId);
  } catch (error) {
    if (createdRuntime && runtime) cleanupFailedRuntimeProcess(runtime, `agent turn failed: ${String(error)}`);
    updateFlow(flow.id, { agentStatus: "failed" });
    insertLog(flow.id, "agent:error", `${String(error)}\n`);
    throw error;
  }
}

async function startQueuedPromptIfReady(flowId: string) {
  const flow = getFlow(flowId);
  const queued = queuedPromptForFlow(flowId);
  if (!flow || !queued) return false;
  const runtime = agentProcesses.get(flowId);
  if (runtime?.stopping || runtime?.compacting || runtime?.activeTurnId) return false;

  clearQueuedPrompt(flowId, { broadcast: false });
  try {
    await startAgent(flow, queued.message);
  } catch {
    // startAgent records the failure on the flow.
  }
  broadcast("flows", listClientFlows());
  return true;
}

async function steerQueuedPrompt(flow: Flow) {
  const queued = queuedPromptForFlow(flow.id);
  if (!queued) throw new Error("No queued message to steer.");
  if (isCompactSlashCommand(queued.message)) throw new Error("Queued /compact cannot be steered.");
  const runtime = agentProcesses.get(flow.id);
  if (!runtime?.activeTurnId || runtime.compacting) throw new Error("No active agent turn to steer.");

  clearQueuedPrompt(flow.id, { broadcast: false });
  try {
    await startAgent(flow, queued.message);
  } catch (error) {
    broadcast("flows", listClientFlows());
    throw error;
  }
  broadcast("flows", listClientFlows());
  return true;
}

async function startNextQueuedAgentMessage(runtime: RuntimeProcess) {
  if (runtime.stopping || runtime.compacting || runtime.activeTurnId) return;
  const queued = runtime.queuedAgentMessages?.shift();
  if (!queued) {
    await startQueuedPromptIfReady(runtime.flowId);
    return;
  }
  const flow = getFlow(runtime.flowId);
  if (!flow) return;
  deleteQueuedUserLog(flow.id, queued.queuedLogId);
  const userLogId = insertLog(flow.id, "user", `${queued.message}\n`);
  try {
    await startAgentTurnAfterUserLog(flow, userLogId, queued.message);
  } catch {
    // startAgentTurnAfterUserLog records the failure on the flow.
  }
}

async function handleSlashCommand(flow: Flow, message: string) {
  flow = ensureFlowWorktree(flow);
  const command = parseSlashCommand(message);
  if (!command) return false;
  const userLogId = insertLog(flow.id, "user", `${message.trim()}\n`);

  if (command === "/fast") {
    const serviceTier = flow.agentServiceTier === "fast" ? "" : "fast";
    updateFlow(flow.id, { agentServiceTier: serviceTier });
    insertLog(flow.id, "agent:status", serviceTier ? "fast mode enabled" : "fast mode disabled");
    return true;
  }
  if (command === "/effort") {
    const reasoningEffort = slashCommandArgs(message).toLowerCase() as ReasoningEffort;
    if (!reasoningEfforts.has(reasoningEffort)) throw new Error("Usage: /effort high|medium|low|xhigh");
    updateFlow(flow.id, { agentReasoningEffort: reasoningEffort });
    insertLog(flow.id, "agent:status", `reasoning effort set to ${reasoningEffort}`);
    return true;
  }
  if (command === "/model") {
    const model = slashCommandArgs(message).toLowerCase();
    if (!agentModels.has(model)) throw new Error("Usage: /model gpt-5.5|gpt-5.4|gpt-5.4-mini|gpt-5.3-codex|gpt-5.2");
    updateFlow(flow.id, { agentModel: model });
    insertLog(flow.id, "agent:status", `model set to ${model}`);
    return true;
  }
  if (command === "/review") {
    await startAgentTurnAfterUserLog(flow, userLogId, reviewPromptForSlashCommand(message));
    return true;
  }
  if (command === "/plugins") {
    await listCodexPlugins(flow);
    return true;
  }
  if (command === "/permissions") {
    const agentSandbox = agentSandboxForSlashCommand(slashCommandArgs(message));
    if (!agentSandbox) throw new Error("Usage: /permissions read-only|workspace-write|full-access");
    updateFlow(flow.id, { agentSandbox });
    insertLog(flow.id, "agent:status", `permissions set to ${agentSandbox}`);
    return true;
  }

  const runtime = await ensureCodexRuntime(flow);
  if (command === "/clear") {
    await startFreshCodexThread(runtime, flow);
    return true;
  }
  if (command === "/compact") {
    await compactCodexThread(runtime, flow, userLogId);
    return true;
  }
  throw new Error(`Unknown slash command: ${command}`);
}

async function startAgent(flow: Flow, userMessage = "") {
  flow = ensureFlowWorktree(flow);
  const message = userMessage.trim();
  const existingRuntime = agentProcesses.get(flow.id);
  if (message && existingRuntime?.compacting) {
    if (existingRuntime.queuedAgentMessages?.length) {
      throw new Error("A message is already queued until context compaction finishes.");
    }
    insertLog(flow.id, "agent:status", "message queued until context compaction finishes");
    const queuedLogId = insertLog(flow.id, "user:queued", `${userMessage}\n`);
    if (!existingRuntime.queuedAgentMessages) existingRuntime.queuedAgentMessages = [];
    existingRuntime.queuedAgentMessages.push({ message: userMessage, queuedLogId });
    updateFlow(flow.id, { agentStatus: "running" });
    return;
  }
  if (userMessage && (await handleSlashCommand(flow, userMessage))) return;
  updateFlow(flow.id, {
    agentStatus: message ? "running" : "idle",
  });
  const updated = getFlow(flow.id);
  if (!updated) throw new Error("Flow disappeared while starting agent.");

  const userLogId = message ? insertLog(flow.id, "user", `${userMessage}\n`) : 0;
  let runtime: RuntimeProcess | undefined;
  let createdRuntime = false;
  try {
    runtime = existingRuntime;
    if (!runtime) {
      runtime = await startCodexAppServer(updated);
      createdRuntime = true;
    }
    if (!message) return;
    await sendAgentTurn(runtime, updated, userMessage, userLogId);
  } catch (error) {
    if (createdRuntime && runtime) cleanupFailedRuntimeProcess(runtime, `agent turn failed: ${String(error)}`);
    updateFlow(flow.id, { agentStatus: "failed" });
    insertLog(flow.id, "agent:error", `${String(error)}\n`);
    throw error;
  }
}

function startShellCommand(flow: Flow, userCommand: string) {
  flow = ensureFlowWorktree(flow);
  const command = userCommand.trim();
  if (!command) throw new Error("Type a shell command after $.");
  if (shellProcesses.has(flow.id)) throw new Error("A shell command is already running.");

  const proc = Bun.spawn(["/bin/zsh", "-lc", command], {
    cwd: flow.checkoutPath,
    env: shellRuntimeEnv(flow),
    detached: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const runtime: RuntimeProcess = { flowId: flow.id, kind: "shell", proc, command };
  shellProcesses.set(flow.id, runtime);
  updateFlow(flow.id, { agentStatus: "running" });
  const commandLogId = insertLog(flow.id, "shell:command", command);

  const stdoutDone = streamProcessOutput(flow.id, "shell:output", proc.stdout).catch((error) =>
    insertLog(flow.id, "shell:stderr", `stdout read failed: ${String(error)}\n`),
  );
  const stderrDone = streamProcessOutput(flow.id, "shell:stderr", proc.stderr).catch((error) =>
    insertLog(flow.id, "shell:stderr", `stderr read failed: ${String(error)}\n`),
  );
  void Promise.all([stdoutDone, stderrDone]);

  void (async () => {
    try {
      const code = await proc.exited;
      if (shellProcesses.get(flow.id)?.proc === proc) shellProcesses.delete(flow.id);
      await Promise.all([stdoutDone, stderrDone]);
      const resultLogId = insertLog(
        flow.id,
        "shell:result",
        `${code === 0 ? "completed" : runtime.stopping ? "interrupted" : "failed"} exit ${code}`,
      );
      createTraceGroupBetweenLogs(flow.id, commandLogId, resultLogId + 1, "shell");
      updateFlow(flow.id, { agentStatus: code === 0 || runtime.stopping ? "idle" : "failed" });
    } catch (error) {
      if (shellProcesses.get(flow.id)?.proc === proc) shellProcesses.delete(flow.id);
      insertLog(flow.id, "shell:stderr", `shell command failed: ${String(error)}\n`);
      updateFlow(flow.id, { agentStatus: "failed" });
    }
  })();
}

function interruptShellCommand(flowId: string) {
  const runtime = shellProcesses.get(flowId);
  if (!runtime) return false;
  insertLog(flowId, "shell:status", "shell interrupt requested");
  runtime.stopping = true;
  try {
    runtime.proc.stdin?.write("\x03");
  } catch {
    // Some commands close stdin before exiting; SIGINT below is the fallback.
  }
  signalRuntimeProcess(runtime, "SIGINT");
  scheduleShellInterruptEscalation(flowId, runtime);
  return true;
}

async function interruptAgent(flowId: string) {
  const flow = getFlow(flowId);
  const runtime = agentProcesses.get(flowId) ?? (flow ? await recoverAgentRuntime(flow) : null);
  if (!runtime) return;
  if (runtime.compacting && !runtime.activeTurnId) {
    runtime.compacting = false;
    runtime.compactingStartedAt = undefined;
    runtime.compactionPromptLogId = undefined;
    runtime.queuedAgentMessages = [];
    setActiveTurnId(flowId);
    insertLog(flowId, "agent:status", "compact interrupted");
    updateFlow(flowId, { agentStatus: "idle" });
    return;
  }
  if (!runtime.threadId || !runtime.activeTurnId) {
    runtime.activeTurnTraceAfterLogId = undefined;
    setActiveTurnId(flowId);
    updateFlow(flowId, { agentStatus: "idle" });
    return;
  }
  const turnId = runtime.activeTurnId;
  updateFlow(flowId, { agentStatus: "interrupting" });
  insertLog(flowId, "agent:status", `interrupt requested ${turnId}`);
  try {
    await sendCodexRequest(runtime, "turn/interrupt", {
      threadId: runtime.threadId,
      turnId,
    });
  } catch (error) {
    if (!isNoActiveTurnInterruptError(error)) throw error;
    runtime.activeTurnId = undefined;
    runtime.activeTurnTraceAfterLogId = undefined;
    setActiveTurnId(flowId);
    insertLog(flowId, "agent:status", "interrupt ignored: no active turn");
    updateFlow(flowId, { agentStatus: "idle" });
  }
}

function stopIdleAgentRuntimesForEnvUpdate() {
  for (const runtime of agentProcesses.values()) {
    if (runtime.activeTurnId) continue;
    runtime.stopping = true;
    agentProcesses.delete(runtime.flowId);
    signalRuntimeProcess(runtime, "SIGTERM");
    updateFlow(runtime.flowId, { agentStatus: "idle" });
    insertLog(runtime.flowId, "agent:status", "agent environment updated");
  }
}

function stopServe() {
  if (!serveProcess) return;
  const previous = serveProcess;
  serveProcess = null;
  signalRuntimeProcess(previous, "SIGTERM");
  db.query("update flows set serving = 0").run();
  insertLog(previous.flowId, "serve", "\n[serve stopped by Turbopump]\n");
  broadcast("flows", listClientFlows());
}

function startServe(flow: Flow) {
  const serveCommand = getSetting("serveCommand");
  if (!serveCommand) throw new Error("Configure a repo serve command first.");
  stopServe();
  updateFlow(flow.id, { serving: 1 });
  const updated = getFlow(flow.id);
  if (!updated) throw new Error("Flow disappeared while starting serve.");
  serveProcess = spawnLoggedProcess(updated, "serve", serveCommand, "serve");
  rememberServeProcess(serveProcess);
}

function serverHasActiveWork() {
  return Boolean(clients.size || agentProcesses.size || shellProcesses.size || serveProcess);
}

async function fetchLinearIssue(identifier: string) {
  if (!linearAuthHeader()) return null;
  let body: { issue?: LinearIssue };
  try {
    body = await linearGraphql<{ issue?: LinearIssue }>(
      `
        query Issue($id: String!) {
          issue(id: $id) {
            id
            identifier
            title
            url
            archivedAt
            state { id name color type }
          }
        }
      `,
      { id: identifier },
    );
  } catch (error) {
    if (isLinearIssueNotFoundError(error)) return null;
    throw error;
  }
  const issue = body.issue ?? null;
  cacheLinearIssue(issue);
  return issue && !isDeletedLinearIssue(issue) ? issue : null;
}

async function fetchLinearIssueDetail(identifier: string) {
  if (!linearAuthHeader()) return null;
  let body: { issue?: LinearIssue };
  try {
    body = await linearGraphql<{ issue?: LinearIssue }>(
      `
        query IssueDetail($id: String!) {
          issue(id: $id) {
            id
            identifier
            title
            url
            archivedAt
            description
            priority
            estimate
            createdAt
            updatedAt
            state { id name color type }
            team { key name }
            project { name }
            assignee { name }
            creator { name }
            labels { nodes { name color } }
            comments(first: 50) {
              nodes {
                id
                body
                createdAt
                updatedAt
                user { name }
                parent { id }
              }
            }
          }
        }
      `,
      { id: identifier },
    );
  } catch (error) {
    if (isLinearIssueNotFoundError(error)) return null;
    throw error;
  }
  const issue = body.issue ?? null;
  cacheLinearIssue(issue);
  return issue && !isDeletedLinearIssue(issue) ? issue : null;
}

async function syncLinearStatus(flow: Flow) {
  try {
    const issue = await fetchLinearIssue(flow.linearIssueId);
    if (!issue) return;
    updateFlow(flow.id, {
      title: issue.title || flow.title,
      linearIssueUrl: issue.url || flow.linearIssueUrl,
      linearStatus: issue.state?.name || "",
    });
  } catch (error) {
    if (error instanceof LinearUnavailableError) throw error;
    insertLog(flow.id, "linear", `[linear sync failed] ${String(error)}\n`);
  }
}

async function updateLinearIssueStatus(identifier: string, issueId: string, stateId: string) {
  if (!stateId.trim()) throw new Error("Linear status is required.");
  const data = await linearGraphql<{
    issueUpdate?: {
      success: boolean;
      issue?: LinearIssue;
    };
  }>(
    `
      mutation UpdateIssueStatus($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
          issue {
            id
            identifier
            title
            url
            priority
            estimate
            createdAt
            updatedAt
            state { id name color type }
            team { key name }
            project { name }
            labels { nodes { name color } }
          }
        }
      }
    `,
    { id: issueId || identifier, stateId },
  );
  const issue = data.issueUpdate?.issue;
  if (!data.issueUpdate?.success || !issue) throw new Error("Linear did not update the issue status.");
  cacheLinearIssue(issue);

  const flow = getFlowByIssue(issue.identifier);
  if (flow) {
    updateFlow(flow.id, {
      title: issue.title || flow.title,
      linearIssueUrl: issue.url || flow.linearIssueUrl,
      linearStatus: issue.state?.name || "",
    });
  }
  return { issue, flow: flow ? getFlow(flow.id) : null };
}

async function updateLinearIssuePriority(identifier: string, issueId: string, priority: number) {
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) throw new Error("Linear priority must be between 0 and 4.");
  const data = await linearGraphql<{
    issueUpdate?: {
      success: boolean;
      issue?: LinearIssue;
    };
  }>(
    `
      mutation UpdateIssuePriority($id: String!, $priority: Int!) {
        issueUpdate(id: $id, input: { priority: $priority }) {
          success
          issue {
            id
            identifier
            title
            url
            priority
            estimate
            createdAt
            updatedAt
            state { id name color type }
            team { key name }
            project { name }
            labels { nodes { name color } }
          }
        }
      }
    `,
    { id: issueId || identifier, priority },
  );
  const issue = data.issueUpdate?.issue;
  if (!data.issueUpdate?.success || !issue) throw new Error("Linear did not update the issue priority.");
  cacheLinearIssue(issue);
  return { issue };
}

function linearWorkflowKey(name = "") {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function createBlankInEngLinearIssue() {
  const data = await linearGraphql<{
    viewer: {
      id: string;
      name: string;
      assignedIssues: {
        nodes: LinearIssue[];
      };
    };
    workflowStates: {
      nodes: LinearWorkflowState[];
    };
  }>(`
    query NewIssueContext {
      viewer {
        id
        name
        assignedIssues(first: 100) {
          nodes {
            team { id key name }
          }
        }
      }
      workflowStates(first: 250) {
        nodes {
          id
          name
          color
          type
          team { id key name }
        }
      }
    }
  `);
  const teamRanks = new Map<string, number>();
  for (const issue of data.viewer.assignedIssues.nodes) {
    const key = issue.team?.key;
    if (key) teamRanks.set(key, (teamRanks.get(key) ?? 0) + 1);
  }
  const inEngStates = data.workflowStates.nodes.filter((state) => linearWorkflowKey(state.name) === "in-eng" && state.team?.id);
  const state = inEngStates.sort((a, b) => (teamRanks.get(b.team?.key ?? "") ?? 0) - (teamRanks.get(a.team?.key ?? "") ?? 0))[0];
  if (!state?.team?.id) throw new Error('No Linear workflow state named "In Eng" was found.');

  const created = await linearGraphql<{
    issueCreate?: {
      success: boolean;
      issue?: LinearIssue;
    };
  }>(
    `
      mutation CreateBlankInEngIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
            priority
            estimate
            createdAt
            updatedAt
            state { id name color type }
            team { id key name }
            project { name }
            assignee { name }
            labels { nodes { name color } }
          }
        }
      }
    `,
    {
      input: {
        teamId: state.team.id,
        stateId: state.id,
        assigneeId: data.viewer.id,
        title: "Untitled",
      },
    },
  );
  const issue = created.issueCreate?.issue;
  if (!created.issueCreate?.success || !issue) throw new Error("Linear did not create the issue.");
  cacheLinearIssue(issue);
  return { issue, viewer: { id: data.viewer.id, name: data.viewer.name } };
}

function isDeletedLinearIssue(issue: LinearIssue) {
  return Boolean(issue.archivedAt);
}

function isDoneLinearIssue(issue: LinearIssue) {
  const stateName = linearWorkflowKey(issue.state?.name ?? "");
  const stateType = linearWorkflowKey(issue.state?.type ?? "");
  return stateType === "completed" || stateName === "done" || stateName === "completed";
}

function isDuplicateLinearIssue(issue: LinearIssue) {
  return linearWorkflowKey(issue.state?.name ?? "") === "duplicate";
}

function isLinearIssueNotFoundError(error: unknown) {
  return /not found|does not exist|not accessible|Could not find/i.test(String((error as Error)?.message || error));
}

function assignedLinearIssuesPayload(viewer: { id: string; name: string }, issues: LinearIssue[], cached = false) {
  const flowsByIssue = new Map(listFlows().map((flow) => [flow.linearIssueId, flow]));
  return {
    viewer,
    cached,
    issues: issues.flatMap((issue) => {
      const flow = flowsByIssue.get(issue.identifier);
      if (isDeletedLinearIssue(issue)) return [];
      if (!flow && (isDoneLinearIssue(issue) || isDuplicateLinearIssue(issue))) return [];
      return [
        {
          ...issue,
          flowId: flow?.id ?? "",
        },
      ];
    }),
  };
}

function cachedLinearIssuesFromDb() {
  const issues: LinearIssue[] = [];
  for (const row of allLinearIssuesStmt.all() as { issueJson: string }[]) {
    try {
      const issue = JSON.parse(row.issueJson) as LinearIssue;
      if (!issue?.identifier || isDeletedLinearIssue(issue)) continue;
      linearIssueCache.set(issue.identifier.toUpperCase(), issue);
      issues.push(issue);
    } catch {
      continue;
    }
  }
  return issues;
}

function cachedAssignedLinearIssuesPayload() {
  return assignedLinearIssuesPayload(
    { id: "", name: getSetting("linearViewerName") || "Cached Linear" },
    cachedLinearIssuesFromDb(),
    true,
  );
}

function hasCachedAssignedLinearIssues() {
  return Boolean((allLinearIssuesStmt.get() as { issueJson: string } | null)?.issueJson);
}

async function listAssignedLinearIssues(apiKey?: string) {
  let viewer: { id: string; name: string } | null = null;
  const issues: LinearIssue[] = [];
  let after: string | null = null;
  try {
    do {
      const data = await linearGraphql<{
        viewer: {
          id: string;
          name: string;
          assignedIssues: LinearIssueConnection;
        };
      }>(`
        query AssignedToMe($after: String) {
          viewer {
            id
            name
            assignedIssues(first: 100, after: $after) {
              nodes {
                id
                identifier
                title
                url
                archivedAt
                priority
                estimate
                createdAt
                updatedAt
                state { id name color type }
                team { key name }
                project { name }
                labels { nodes { name color } }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `, { after }, apiKey);
      viewer = { id: data.viewer.id, name: data.viewer.name };
      issues.push(...data.viewer.assignedIssues.nodes);
      const pageInfo = data.viewer.assignedIssues.pageInfo;
      after = pageInfo?.hasNextPage ? pageInfo.endCursor ?? null : null;
    } while (after);
  } catch (error) {
    if (!apiKey && hasCachedAssignedLinearIssues()) {
      if (error instanceof LinearUnavailableError) logLinearUnavailable(error);
      else console.warn(error instanceof Error ? error.message : String(error));
      return cachedAssignedLinearIssuesPayload();
    }
    throw error;
  }
  for (const issue of issues) cacheLinearIssue(issue);
  if (!viewer) throw new Error("Linear did not return the viewer.");
  return assignedLinearIssuesPayload(viewer, issues);
}

async function getDiff(flow: Flow, options: { patch?: boolean } = {}) {
  try {
    flow = assertFlowWorktree(flow);
  } catch (error) {
    return { status: "", stat: "", names: "", patch: String(error), count: 0, additions: 0, deletions: 0, baseRef: "", files: [] };
  }
  const run = async (args: string[], options: { trim?: boolean } = {}) => {
    const result = Bun.spawn({
      cmd: ["git", ...args],
      cwd: flow.checkoutPath,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
      result.exited,
    ]);
    const text = exitCode === 0 ? stdout : stderr || stdout;
    return {
      ok: exitCode === 0,
      text: options.trim === false ? text : text.trim(),
    };
  };

  const remoteHead = await run(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const baseRefCandidates = [
    remoteHead.ok ? remoteHead.text : "",
    "origin/main",
    "origin/master",
    flow.baseSha,
  ].filter(Boolean);
  let baseRef = flow.baseSha;
  for (const candidate of baseRefCandidates) {
    const mergeBase = await run(["merge-base", "HEAD", candidate]);
    if (mergeBase.ok && mergeBase.text) {
      baseRef = mergeBase.text;
      break;
    }
  }

  const namesResult = await run(["diff", "--name-only", "-z", baseRef], { trim: false });
  const numstatResult = await run(["diff", "--find-renames", "--numstat", baseRef], { trim: false });
  const names = namesResult.ok ? namesResult.text : "";
  let additions = 0;
  let deletions = 0;
  const files: DiffFile[] = [];
  if (numstatResult.ok) {
    for (const line of numstatResult.text.split("\n")) {
      const [added, deleted] = line.split("\t");
      const path = line.split("\t").slice(2).join("\t").trim();
      const addedCount = Number(added);
      const deletedCount = Number(deleted);
      if (Number.isFinite(addedCount)) additions += addedCount;
      if (Number.isFinite(deletedCount)) deletions += deletedCount;
      if (path) {
        files.push({
          path,
          additions: Number.isFinite(addedCount) ? addedCount : null,
          deletions: Number.isFinite(deletedCount) ? deletedCount : null,
        });
      }
    }
  }
  const diff = {
    status: names.replaceAll("\0", "\n").trim(),
    names,
    count: names.split("\0").filter(Boolean).length,
    additions,
    deletions,
    baseRef,
    files,
  };
  if (!options.patch) return { ...diff, stat: "", patch: "" };
  const combinedResult = await run(["diff", "--find-renames", "--stat", "--patch", baseRef], { trim: false });
  const combined = combinedResult.text;
  const patchStart = combined.indexOf("diff --git ");
  const stat = patchStart >= 0 ? combined.slice(0, patchStart).trim() : "";
  const patch = patchStart >= 0 ? combined.slice(patchStart) : combined;
  return {
    ...diff,
    stat,
    patch,
  };
}

async function handleApi(request: Request, url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/api/bootstrap") {
    return json({
      repo: {
        repoUrl: getSetting("repoUrl"),
        repoName: getSetting("repoName"),
        serveCommand: getSetting("serveCommand"),
        agentCommand: normalizeAgentCommand(getSetting("agentCommand", defaultCodexAppServerCommand)),
      },
      linear: linearConfigPayload(),
      agents: {
        developerInstructions: getAgentDeveloperInstructionsTemplate(),
        defaultDeveloperInstructions: defaultAgentDeveloperInstructions,
      },
      flows: listClientFlows(),
    });
  }

  if (url.pathname === "/api/checkouts" && request.method === "GET") {
    return json({ checkouts: listWorktrees() });
  }

  if (parts[0] === "api" && parts[1] === "checkouts" && parts[2] && request.method === "DELETE") {
    let result: { deletedFlowId: string };
    try {
      result = deleteWorktree(decodeURIComponent(parts[2]));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
    broadcast("flows", listClientFlows());
    broadcast("checkouts", listWorktrees());
    return json({ ok: true, ...result, flows: listClientFlows(), checkouts: listWorktrees() });
  }

  if (url.pathname === "/api/repo" && request.method === "POST") {
    const body = await readJson<{
      repoUrl: string;
      serveCommand: string;
      agentCommand?: string;
    }>(request);
    const repoUrl = body.repoUrl.trim();
    if (!repoUrl) return json({ error: "repoUrl is required" }, { status: 400 });
    setSetting("repoUrl", repoUrl);
    setSetting("repoName", repoBasename(repoUrl));
    setSetting("serveCommand", body.serveCommand.trim());
    setSetting("agentCommand", normalizeAgentCommand(body.agentCommand));
    return json({ ok: true });
  }

  if (url.pathname === "/api/agents" && request.method === "POST") {
    const body = await readJson<{
      developerInstructions?: string;
    }>(request);
    setSetting("agentDeveloperInstructions", body.developerInstructions ?? "");
    return json({ ok: true });
  }

  if (url.pathname === "/api/env" && request.method === "GET") {
    return json({ contents: readEnvContents() });
  }

  if (url.pathname === "/api/env" && request.method === "PUT") {
    const body = await readJson<{ contents: string }>(request);
    writeEnvContents(body.contents ?? "");
    setSetting("envVersion", String(Number(getSetting("envVersion", "0")) + 1));
    stopIdleAgentRuntimesForEnvUpdate();
    const activeServe = serveProcess ? getFlow(serveProcess.flowId) : null;
    if (activeServe) startServe(activeServe);
    return json({ ok: true, restartedServe: Boolean(activeServe) });
  }

  if (url.pathname === "/api/linear/config" && request.method === "GET") {
    return json(linearConfigPayload());
  }

  if (url.pathname === "/api/linear/config" && request.method === "PUT") {
    const body = await readJson<{ apiKey: string }>(request);
    const apiKey = body.apiKey?.trim() ?? "";
    if (!apiKey) return json({ error: "Linear API key is required." }, { status: 400 });
    const assigned = await listAssignedLinearIssues(apiKey);
    setSetting("linearViewerName", assigned.viewer.name);
    setSetting("linearApiKey", apiKey);
    return json({ ok: true, viewer: assigned.viewer, issueCount: assigned.issues.length });
  }

  if (url.pathname === "/api/linear/config" && request.method === "DELETE") {
    setSetting("linearApiKey", "");
    setSetting("linearViewerName", "");
    return json({ ok: true });
  }

  if (url.pathname === "/api/linear/attachment" && request.method === "GET") {
    return await fetchLinearAttachment(url.searchParams.get("url") ?? "");
  }

  if (url.pathname === "/api/linear/issues" && request.method === "POST") {
    const result = await createBlankInEngLinearIssue();
    setSetting("linearViewerName", result.viewer.name);
    return json({ ok: true, ...result });
  }

  if (parts[0] === "api" && parts[1] === "linear" && parts[2] === "issues" && parts[3] && request.method === "GET") {
    const issue = await fetchLinearIssueDetail(decodeURIComponent(parts[3]));
    if (!issue) return json({ error: "Linear issue not found" }, { status: 404 });
    return json({ issue });
  }

  if (parts[0] === "api" && parts[1] === "linear" && parts[2] === "issues" && parts[3] && parts[4] === "status" && request.method === "POST") {
    const body = await readJson<{ issueId?: string; stateId?: string }>(request);
    const result = await updateLinearIssueStatus(decodeURIComponent(parts[3]), body.issueId || "", body.stateId || "");
    if (result.flow) {
      broadcast("flows", listClientFlows());
      broadcast("checkouts", listWorktrees());
    }
    return json({ ok: true, ...result, flow: result.flow ? clientFlow(result.flow) : null });
  }

  if (parts[0] === "api" && parts[1] === "linear" && parts[2] === "issues" && parts[3] && parts[4] === "priority" && request.method === "POST") {
    const body = await readJson<{ issueId?: string; priority?: number }>(request);
    const result = await updateLinearIssuePriority(decodeURIComponent(parts[3]), body.issueId || "", Number(body.priority));
    return json({ ok: true, ...result });
  }

  if (url.pathname === "/api/flows" && request.method === "POST") {
    const body = await readJson<{
      issue: string;
      title?: string;
      url?: string;
      linearStatus?: string;
      state?: { name?: string } | null;
    }>(request);
    const parsed = parseLinearIssue(body.issue || "");
    if (!parsed.identifier) return json({ error: "Linear issue URL or key is required" }, { status: 400 });
    const existing = getFlowByIssue(parsed.identifier);
    if (existing) return json({ ok: true, alreadyExists: true, flow: clientFlow(existing) });

    const id = crypto.randomUUID();
    const linearIssue = cachedLinearIssue(parsed.identifier);
    const { target, branch, baseSha } = createWorktree(id, parsed.identifier);
    const createdAt = now();
    db.query(`
      insert into flows (
        id, linearIssueId, linearIssueUrl, title, linearStatus, agentServiceTier,
        checkoutPath, branchName, baseSha, agentStatus, serving, createdAt, updatedAt
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      parsed.identifier,
      body.url?.trim() || linearIssue?.url || parsed.url,
      body.title?.trim() || linearIssue?.title || parsed.identifier,
      body.linearStatus?.trim() || body.state?.name?.trim() || linearIssue?.state?.name || "",
      "fast",
      target,
      branch,
      baseSha,
      "idle",
      0,
      createdAt,
      createdAt,
    );
    const flow = getFlow(id);
    if (!flow) return json({ error: "Failed to create flow" }, { status: 500 });
    insertLog(id, "flow", `Created worktree ${branch}\n`);
    broadcast("flows", listClientFlows());
    broadcast("checkouts", listWorktrees());
    return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
  }

  if (parts[0] === "api" && parts[1] === "flows" && parts[2]) {
    const id = parts[2];
    const flow = getFlow(id);
    if (!flow) return json({ error: "Flow not found" }, { status: 404 });

    if (parts.length === 3 && request.method === "GET") {
      return json({ flow: clientFlow(flow) });
    }

    if (parts[3] === "logs" && request.method === "DELETE") {
      let payload: { ids?: unknown };
      try {
        payload = await readJson<{ ids?: unknown }>(request);
      } catch (error) {
        return json({ error: String(error) }, { status: 400 });
      }
      try {
        const ids = deleteOutputLogs(id, Array.isArray(payload.ids) ? payload.ids.map(Number) : []);
        return json({ ok: true, ids });
      } catch (error) {
        return json({ error: String(error) }, { status: 400 });
      }
    }

    if (parts[3] === "shell-output" && parts[4] === "clear" && request.method === "POST") {
      const clearAfterLogId = setShellOutputClearAfterLogId(id, latestLogId(id));
      return json({ ok: true, clearAfterLogId, flow: clientFlow(getFlow(id) ?? flow) });
    }

    if (parts[3] === "context-images" && request.method === "POST") {
      try {
        const images = await saveFlowContextImages(assertFlowWorktree(flow), await request.formData());
        return json({ ok: true, images });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
      }
    }

    if (parts[3] === "context-images" && parts[4] === "preview" && request.method === "GET") {
      return await serveFlowContextImage(assertFlowWorktree(flow), url.searchParams.get("path") ?? "");
    }

    if (parts[3] === "diff" && request.method === "GET") {
      return json(await getDiff(flow, { patch: url.searchParams.get("patch") === "1" }));
    }

    if (parts[3] === "meta" && request.method === "POST") {
      let fields: Partial<Flow>;
      try {
        fields = flowMetaUpdate(await readJson<Record<string, unknown>>(request));
      } catch (error) {
        return json({ error: String(error) }, { status: 400 });
      }
      if (Object.keys(fields).length === 0) {
        return json({ error: "No supported flow metadata fields provided." }, { status: 400 });
      }
      updateFlow(id, fields);
      if (fields.prUrl !== undefined) {
        insertLog(id, "flow", fields.prUrl ? `PR set to ${fields.prUrl}\n` : "PR cleared\n");
        if (selectedGithubCiFlowId === id) void pollSelectedGithubCiStatus();
      }
      return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
    }

    if (parts[3] === "agent" && parts[4] === "interrupt" && request.method === "POST") {
      await interruptAgent(id);
      return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
    }

    if (parts[3] === "agent" && request.method === "POST") {
      const body = await readJson<{ message?: string }>(request);
      await startAgent(flow, body.message ?? "");
      return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
    }

    if (parts[3] === "agent" && request.method === "DELETE") {
      await interruptAgent(id);
      return json({ ok: true });
    }

    if (parts[3] === "queued-prompt" && (request.method === "POST" || request.method === "PUT") && parts.length === 4) {
      try {
        const body = await readJson<{ message?: unknown }>(request);
        setQueuedPrompt(id, normalizeQueuedPromptMessage(body.message));
        await startQueuedPromptIfReady(id);
        return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
      }
    }

    if (parts[3] === "queued-prompt" && request.method === "DELETE" && parts.length === 4) {
      clearQueuedPrompt(id);
      return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
    }

    if (parts[3] === "queued-prompt" && parts[4] === "flush" && request.method === "POST") {
      await startQueuedPromptIfReady(id);
      return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
    }

    if (parts[3] === "queued-prompt" && parts[4] === "steer" && request.method === "POST") {
      try {
        await steerQueuedPrompt(flow);
        return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
      }
    }

    if (parts[3] === "message" && request.method === "POST") {
      const body = await readJson<{ message: string }>(request);
      await startAgent(flow, body.message);
      return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
    }

    if (parts[3] === "command" && parts[4] === "interrupt" && request.method === "POST") {
      interruptShellCommand(id);
      return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
    }

    if (parts[3] === "command" && request.method === "POST") {
      const body = await readJson<{ command: string }>(request);
      startShellCommand(flow, body.command);
      return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
    }

    if (parts[3] === "serve" && request.method === "POST") {
      startServe(flow);
      return json({ ok: true });
    }

    if (parts[3] === "serve" && request.method === "DELETE") {
      if (serveProcess?.flowId === id) stopServe();
      return json({ ok: true });
    }

    if (parts[3] === "linear-sync" && request.method === "POST") {
      await syncLinearStatus(flow);
      broadcast("flows", listClientFlows());
      broadcast("checkouts", listWorktrees());
      return json({ ok: true, flow: clientFlow(getFlow(id) ?? flow) });
    }
  }

  if (url.pathname === "/api/linear/issues" && request.method === "GET") {
    const assigned = await listAssignedLinearIssues();
    if (!assigned.cached) setSetting("linearViewerName", assigned.viewer.name);
    return json(assigned);
  }

  return json({ error: "Not found" }, { status: 404 });
}

function serveStatic(url: URL) {
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  if (path.startsWith("/vendor/prismjs/")) {
    const vendorPath = path.slice("/vendor/prismjs/".length);
    const resolvedVendor = resolve(prismDir, `.${vendorPath.startsWith("/") ? vendorPath : `/${vendorPath}`}`);
    if (!resolvedVendor.startsWith(prismDir) || !resolvedVendor.endsWith(".js")) {
      return new Response("Not found", { status: 404 });
    }
    const file = Bun.file(resolvedVendor);
    return file.exists().then((exists) => {
      if (!exists) return new Response("Not found", { status: 404 });
      return new Response(file, { headers: { "content-type": "text/javascript; charset=utf-8" } });
    });
  }

  const resolved = resolve(publicDir, `.${path}`);
  if (!resolved.startsWith(publicDir)) return new Response("Not found", { status: 404 });
  const file = Bun.file(resolved);
  return file.exists().then((exists) => {
    if (!exists) return new Response("Not found", { status: 404 });
    return new Response(file);
  });
}

cleanupPersistedServeProcess();

Bun.serve({
  port,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (server.upgrade(request)) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, url);
      return await serveStatic(url);
    } catch (error) {
      if (error instanceof LinearUnavailableError) {
        logLinearUnavailable(error);
      } else {
        console.error(error);
      }
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: error instanceof LinearUnavailableError ? error.status : 500 },
      );
    }
  },
  websocket: {
    open(ws) {
      clients.add(ws as unknown as ServerWebSocket);
    },
    message(ws, message) {
      void handleWsRequest(ws as unknown as ServerWebSocket, message);
    },
    close(ws) {
      clients.delete(ws as unknown as ServerWebSocket);
      if (!clients.size) setSelectedGithubCiFlow("");
    },
  },
});

console.log(`Turbopump running at ${apiBaseUrl}`);
