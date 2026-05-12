import { Database } from "bun:sqlite";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
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

type Stage = "planning" | "working" | "reviewing" | "done";
type ThreadStartSource = "startup" | "clear";
type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
type ServiceTier = "fast" | "flex";

type Flow = {
  id: string;
  linearIssueId: string;
  linearIssueUrl: string;
  title: string;
  stage: Stage;
  linearStatus: string;
  checkoutPath: string;
  branchName: string;
  prUrl: string;
  baseSha: string;
  agentStatus: string;
  agentModel: string;
  agentReasoningEffort: string;
  agentServiceTier: string;
  agentContextTokensUsed: number;
  agentContextWindow: number;
  serving: number;
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

type UploadedImage = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority?: number;
  estimate?: number | null;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  state?: { id?: string; name: string; color?: string; type?: string };
  team?: { key: string; name: string };
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
    }[];
  };
};

const stages: Stage[] = ["planning", "working", "reviewing", "done"];
const rootDir = process.cwd();
const agentHeartbeatSweepIntervalMs = 5000;
const agentRuntimeStartGraceMs = 30000;
const agentRuntimeStaleMs = 120000;
const dataDir = join(rootDir, ".flow");
const legacyDataDir = join(rootDir, `.${"water"}${"flow"}`);
const checkoutDir = join(dataDir, "checkouts");
const repoCheckoutDir = join(dataDir, "repo");
const publicDir = join(rootDir, "public");
const prismDir = join(rootDir, "node_modules", "prismjs");
const envPath = join(dataDir, ".env");
const legacyEnvPath = join(legacyDataDir, ".env");
const dbPath = join(dataDir, "flow.sqlite");
const legacyDbPath = join(legacyDataDir, `${"water"}flow.sqlite`);
const port = Number(process.env.PORT ?? 3999);
const apiBaseUrl = `http://localhost:${port}`;
const defaultCodexAppServerCommand = "codex app-server --listen stdio://";
const serviceTiers = new Set<ServiceTier>(["fast", "flex"]);
const reasoningEfforts = new Set<ReasoningEffort>(["low", "medium", "high", "xhigh"]);
const agentModels = new Set(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"]);
const defaultAgentDeveloperInstructions = [
  "You are running inside Turbopump, a local coding-agent workflow system.",
  "",
  "Work only in the checkout directory supplied as the current working directory.",
  "",
  "Update flow metadata when appropriate by POSTing JSON to:",
  "{flowMetaApiUrl}",
  'Example body: {"prUrl":"https://github.com/org/repo/pull/123"}',
  'Each field in the body is optional.',
  "",
  "Flow ID: {flowId}",
  "Linear issue: {linearIssueId}",
  "Issue title: {title}",
  "Checkout path: {checkoutPath}",
  "",
  "working guidelines:",
  "- use short PR titles",
  "- do not capitalize the first word of PR titles"
].join("\n");

mkdirSync(dataDir, { recursive: true });
mkdirSync(checkoutDir, { recursive: true });
if (!existsSync(envPath) && existsSync(legacyEnvPath)) copyFileSync(legacyEnvPath, envPath);
if (!existsSync(envPath)) writeFileSync(envPath, "", "utf8");
if (!existsSync(dbPath) && existsSync(legacyDbPath)) copyFileSync(legacyDbPath, dbPath);

const db = new Database(dbPath);

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

  create table if not exists flows (
    id text primary key,
    linearIssueId text not null,
    linearIssueUrl text not null,
    title text not null,
    stage text not null,
    linearStatus text not null default '',
    checkoutPath text not null,
    branchName text not null,
    prUrl text not null default '',
    baseSha text not null default '',
    agentStatus text not null default 'idle',
    agentModel text not null default '',
    agentReasoningEffort text not null default '',
    agentServiceTier text not null default '',
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
`);
tryMigration("update flows set stage = 'planning' where stage = 'not_started'");
tryMigration("alter table flows add column agentModel text not null default ''");
tryMigration("alter table flows add column agentReasoningEffort text not null default ''");
tryMigration("alter table flows add column agentServiceTier text not null default ''");
tryMigration("alter table flows add column agentContextTokensUsed integer not null default 0");
tryMigration("alter table flows add column agentContextWindow integer not null default 0");
tryMigration("alter table flows add column prUrl text not null default ''");
tryMigration("update flows set agentContextTokensUsed = 0 where agentContextWindow > 0 and agentContextTokensUsed > agentContextWindow");

const clients = new Set<ServerWebSocket>();
const agentProcesses = new Map<string, RuntimeProcess>();
const shellProcesses = new Map<string, RuntimeProcess>();
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

const getSettingStmt = db.query("select value from settings where key = ?");
const setSettingStmt = db.query(`
  insert into settings (key, value) values (?, ?)
  on conflict(key) do update set value = excluded.value
`);
const insertLogStmt = db.query(`
  insert into logs (flowId, source, message, createdAt) values (?, ?, ?, ?)
`);
const logByIdStmt = db.query("select * from logs where id = ?");
const deleteLogByIdStmt = db.query("delete from logs where id = ?");
const latestUserLogStmt = db.query("select id from logs where flowId = ? and source = 'user' order by id desc limit 1");
const latestUserLogBeforeStmt = db.query(
  "select id from logs where flowId = ? and source = 'user' and id < ? order by id desc limit 1",
);
const logsAfterStmt = db.query("select * from logs where flowId = ? and id > ? order by id asc");
const flowByIdStmt = db.query("select * from flows where id = ?");
const flowByIssueStmt = db.query("select * from flows where linearIssueId = ? limit 1");
const allFlowsStmt = db.query("select * from flows order by createdAt asc");
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

let sessionEnvContents = readFileSync(envPath, "utf8");

function readEnvFile() {
  return sessionEnvContents;
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
    ...parseEnv(readEnvFile()),
    FLOW_API_URL: apiBaseUrl,
    FLOW_RUN_ID: flow?.id ?? "",
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

function insertLog(flowId: string, source: string, message: string) {
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
  const allowedSources = new Set(["agent:output", "agent:cmd"]);
  if (rows.some((row) => !row || row.flowId !== flowId || !allowedSources.has(row.source))) {
    throw new Error("Only output logs for this flow can be deleted.");
  }

  for (const id of uniqueIds) deleteLogByIdStmt.run(id);
  broadcast("logs-deleted", { flowId, ids: uniqueIds });
  return uniqueIds;
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

function runtimeAdjustedFlow(flow: Flow) {
  const shellRuntime = shellProcesses.get(flow.id);
  if (shellRuntime) {
    return {
      ...flow,
      agentStatus: shellRuntime.stopping ? "interrupting" : "running",
      agentRuntimeKind: "shell",
    };
  }

  const agentRuntime = agentProcesses.get(flow.id);
  if (agentRuntime?.activeTurnId) {
    return {
      ...flow,
      agentStatus: flow.agentStatus === "interrupting" ? "interrupting" : "running",
      agentRuntimeKind: "agent",
    };
  }

  return flow;
}

function listClientFlows() {
  return listFlows().map((flow) => runtimeAdjustedFlow(flow));
}

function checkoutNameFromPath(path: string) {
  return basename(resolve(path));
}

function checkoutFlowMap() {
  const map = new Map<string, Flow>();
  for (const flow of listFlows()) {
    if (!flow.checkoutPath) continue;
    map.set(checkoutNameFromPath(flow.checkoutPath), flow);
  }
  return map;
}

function latestPromptTimestamp(flowId: string) {
  const row = latestPromptTimestampStmt.get(flowId) as { createdAt: string } | null;
  return row?.createdAt ?? "";
}

function listCheckouts() {
  const flowsByCheckout = checkoutFlowMap();
  return readdirSync(checkoutDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(checkoutDir, entry.name);
      const stats = statSync(path);
      const flow = flowsByCheckout.get(entry.name) ?? null;
      const createdAtMs = stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs;
      return {
        name: entry.name,
        path,
        createdAt: new Date(createdAtMs).toISOString(),
        updatedAt: stats.mtime.toISOString(),
        ticketId: flow?.linearIssueId ?? entry.name.match(/[a-z]+-\d+/i)?.[0]?.toUpperCase() ?? "",
        ticketName: flow?.title ?? "",
        linearStatus: flow?.linearStatus ?? "",
        flowPhase: flow?.stage ?? "",
        lastPromptAt: flow ? latestPromptTimestamp(flow.id) : "",
      };
    })
    .sort((a, b) => {
      const aTime = Date.parse(a.lastPromptAt || a.createdAt || "");
      const bTime = Date.parse(b.lastPromptAt || b.createdAt || "");
      return bTime - aTime || a.name.localeCompare(b.name);
    });
}

async function refreshCheckoutLinearStatuses() {
  if (!linearAuthHeader()) return;
  const flowsByCheckout = checkoutFlowMap();
  const checkoutNames = new Set(
    readdirSync(checkoutDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const flows = [...flowsByCheckout.entries()]
    .filter(([name]) => checkoutNames.has(name))
    .map(([, flow]) => flow);
  await Promise.allSettled(flows.map((flow) => syncLinearStatus(flow)));
}

function checkoutPathForName(name: string) {
  const safeName = basename(name);
  if (!safeName || safeName !== name || safeName === "." || safeName === "..") {
    throw new Error("Invalid checkout name.");
  }
  const target = resolve(checkoutDir, safeName);
  const checkoutRoot = resolve(checkoutDir);
  if (!target.startsWith(`${checkoutRoot}/`)) throw new Error("Invalid checkout path.");
  return target;
}

function deleteCheckout(name: string) {
  const target = checkoutPathForName(name);
  if (!existsSync(target)) throw new Error("Checkout not found.");
  const stats = statSync(target);
  if (!stats.isDirectory()) throw new Error("Checkout is not a directory.");
  rmSync(target, { recursive: true, force: true });
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

function assertStage(stage: string): asserts stage is Stage {
  if (!stages.includes(stage as Stage)) {
    throw new Error(`Unknown stage: ${stage}`);
  }
}

function normalizeStage(stage: string) {
  return stage.trim().toLowerCase().replaceAll("-", "_");
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
  if ("stage" in body) {
    if (typeof body.stage !== "string") throw new Error("stage must be a string.");
    const stage = normalizeStage(body.stage);
    assertStage(stage);
    fields.stage = stage;
  }
  if ("prUrl" in body) fields.prUrl = normalizePrUrl(body.prUrl);
  return fields;
}

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

function repairFlowCheckoutPath(flow: Flow) {
  if (flow.checkoutPath && existsSync(flow.checkoutPath)) return flow;

  const checkoutName = basename(flow.checkoutPath || "");
  const relocatedPath = checkoutName ? join(checkoutDir, checkoutName) : "";
  if (relocatedPath && existsSync(relocatedPath)) {
    updateFlow(flow.id, { checkoutPath: relocatedPath });
    insertLog(flow.id, "agent:status", `repaired checkout path: ${relocatedPath}`);
    return getFlow(flow.id) ?? { ...flow, checkoutPath: relocatedPath };
  }

  throw new Error(`Checkout does not exist: ${flow.checkoutPath}`);
}

function flowStatusAgeMs(flow: Flow, nowMs = Date.now()) {
  const updatedAt = Date.parse(flow.updatedAt);
  return Number.isFinite(updatedAt) ? nowMs - updatedAt : Number.POSITIVE_INFINITY;
}

function reconcileAgentHeartbeat(flow: Flow, nowMs = Date.now()) {
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
    if (statusAge < agentRuntimeStartGraceMs) return flow;
    const errorLogId = insertLog(flow.id, "agent:error", "agent runtime disappeared while status was running\n");
    createTurnTraceGroup(flow.id, errorLogId);
    updateFlow(flow.id, { agentStatus: "failed" });
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
  insertLog(flow.id, "agent:error", `agent heartbeat timed out after ${Math.round(agentRuntimeStaleMs / 1000)}s\n`);
  updateFlow(flow.id, { agentStatus: "failed" });
  return getFlow(flow.id) ?? flow;
}

function sweepAgentHeartbeats() {
  const nowMs = Date.now();
  for (const flow of listFlows()) reconcileAgentHeartbeat(flow, nowMs);
}

setInterval(sweepAgentHeartbeats, agentHeartbeatSweepIntervalMs);

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
  const codexEnv = parseEnv(readEnvFile());
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
    throw new Error(stderr || stdout || `git ${args.join(" ")} failed`);
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

function linearAuthHeader(apiKey = getSetting("linearApiKey")) {
  return apiKey;
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

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "public-file-urls-expire-in": "3600",
    },
    body: JSON.stringify({ query, variables }),
  });
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
    return;
  }

  const configuredUrl = runGit(["remote", "get-url", "origin"], repoCheckoutDir);
  if (configuredUrl !== repoUrl) {
    rmSync(repoCheckoutDir, { recursive: true, force: true });
    runGit(["clone", repoUrl, repoCheckoutDir]);
    return;
  }

  runGit(["pull", "--ff-only"], repoCheckoutDir);
}

function createCheckout(flowId: string, issueId: string) {
  const repoUrl = getSetting("repoUrl");
  if (!repoUrl) throw new Error("Configure a repo before creating a flow.");

  const target = join(checkoutDir, `${safeSlug(issueId)}-${flowId.slice(0, 8)}`);
  if (existsSync(target)) throw new Error(`Checkout already exists: ${target}`);

  ensureRepoCheckout(repoUrl);
  cpSync(repoCheckoutDir, target, { recursive: true, force: false, errorOnExist: true });
  const baseSha = runGit(["rev-parse", "HEAD"], target);
  const branch = `turbo/${safeSlug(issueId)}`;
  runGit(["checkout", "-b", branch], target);
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

function signalRuntimeProcess(runtime: RuntimeProcess, signal: RuntimeSignal) {
  let signaled = false;
  try {
    process.kill(-runtime.proc.pid, signal);
    signaled = true;
  } catch {
    // The process may not be a process-group leader, or it may already be gone.
  }
  try {
    runtime.proc.kill(signal);
    signaled = true;
  } catch {
    // The group signal above may already have handled it.
  }
  return signaled;
}

function scheduleShellInterruptEscalation(flowId: string, runtime: RuntimeProcess) {
  setTimeout(() => {
    if (shellProcesses.get(flowId) !== runtime) return;
    insertLog(flowId, "agent:status", "shell interrupt escalated");
    signalRuntimeProcess(runtime, "SIGTERM");
  }, 1500);
  setTimeout(() => {
    if (shellProcesses.get(flowId) !== runtime) return;
    insertLog(flowId, "agent:status", "shell interrupt forced cleanup");
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
    stageApiUrl: `${apiBaseUrl}/api/flows/${flow.id}/stage`,
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
  };
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
    sandbox: "danger-full-access",
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
    sandbox: "danger-full-access",
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
    sandboxPolicy: { type: "dangerFullAccess" },
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
    return { source: "agent:tool", message: `web search: ${String(item.query ?? "")}` };
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

function isAgentMessageSource(source: string) {
  return source === "agent:message" || source === "agent";
}

function createTraceGroupBetweenLogs(flowId: string, afterId: number, beforeId: number, kind = "") {
  if (beforeId <= afterId) return;

  const logs = (logsAfterStmt.all(flowId, afterId) as LogRow[]).filter((log) => log.id < beforeId);
  const traceCount = logs.length;
  if (!traceCount) return;

  insertLog(
    flowId,
    "agent:trace-group",
    JSON.stringify({
      afterId,
      beforeId,
      count: traceCount,
      ...(kind ? { kind } : {}),
    }),
  );
}

function createTraceGroupAfterPrompt(flowId: string, promptId: number, beforeId: number) {
  createTraceGroupBetweenLogs(flowId, promptId, beforeId);
}

function createTurnTraceGroup(flowId: string, beforeId: number) {
  const prompt = latestUserLogBeforeStmt.get(flowId, beforeId) as { id: number } | null;
  if (!prompt) return;
  createTraceGroupAfterPrompt(flowId, prompt.id, beforeId);
}

function createCompletedTurnTraceGroup(flowId: string) {
  const prompt = latestUserLogStmt.get(flowId) as { id: number } | null;
  if (!prompt) return;

  const logs = logsAfterStmt.all(flowId, prompt.id) as LogRow[];
  let finalMessageIndex = -1;
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    if (isAgentMessageSource(logs[index].source)) {
      finalMessageIndex = index;
      break;
    }
  }
  if (finalMessageIndex <= 0) return;

  const finalSource = logs[finalMessageIndex].source;
  let finalMessageStartIndex = finalMessageIndex;
  while (finalMessageStartIndex > 0 && logs[finalMessageStartIndex - 1].source === finalSource) {
    finalMessageStartIndex -= 1;
  }
  if (finalMessageStartIndex <= 0) return;

  const beforeId = logs[finalMessageStartIndex].id;
  createTurnTraceGroup(flowId, beforeId);
}

function checkoutBranchUpdate(flowId: string): Partial<Flow> {
  const existing = getFlow(flowId);
  if (!existing?.checkoutPath) return {};
  try {
    const flow = repairFlowCheckoutPath(existing);
    const branchName = runGit(["rev-parse", "--abbrev-ref", "HEAD"], flow.checkoutPath);
    return branchName && branchName !== flow.branchName ? { branchName } : {};
  } catch (error) {
    insertLog(flowId, "agent:status", `could not read checkout branch: ${String(error)}`);
    return {};
  }
}

function handleCodexNotification(runtime: RuntimeProcess, message: Record<string, unknown>) {
  const method = String(message.method ?? "");
  const params = (message.params ?? {}) as Record<string, unknown>;
  const threadId = typeof params.threadId === "string" ? params.threadId : "";
  if (threadId && runtime.threadId && threadId !== runtime.threadId) return;

  if (method === "turn/started") {
    const turn = params.turn as { id?: string } | undefined;
    runtime.activeTurnId = turn?.id;
    insertLog(runtime.flowId, "agent:status", `turn started ${runtime.activeTurnId ?? ""}`);
    updateFlow(runtime.flowId, { agentStatus: "running" });
    return;
  }

  if (method === "turn/completed") {
    const turn = params.turn as { id?: string; status?: string; error?: { message?: string } | null } | undefined;
    if (!turn?.id || turn.id === runtime.activeTurnId) runtime.activeTurnId = undefined;
    createCompletedTurnTraceGroup(runtime.flowId);
    if (turn?.error?.message) insertLog(runtime.flowId, "agent:error", `${turn.error.message}\n`);
    insertLog(runtime.flowId, "agent:status", `turn ${turn?.status ?? "completed"}`);
    updateFlow(runtime.flowId, {
      ...checkoutBranchUpdate(runtime.flowId),
      agentStatus: turn?.status === "failed" ? "failed" : "idle",
    });
    return;
  }

  if (method === "thread/compacted") {
    runtime.activeTurnId = undefined;
    insertLog(runtime.flowId, "agent:status", "context compacted");
    updateFlow(runtime.flowId, { agentStatus: "idle" });
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
    insertLog(runtime.flowId, "agent:error", `${error?.message ?? JSON.stringify(params)}\n`);
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
    if (kind === "serve" && serveProcess?.proc === proc) {
      serveProcess = null;
      updateFlow(flow.id, { serving: 0 });
    }
  });

  return runtime;
}

async function startCodexAppServer(flow: Flow) {
  const activeFlow = repairFlowCheckoutPath(flow);
  const command = normalizeAgentCommand(getSetting("agentCommand", defaultCodexAppServerCommand));
  const env = runtimeEnv(activeFlow);
  try {
    ensureCodexProjectTrusted(activeFlow.checkoutPath);
  } catch (error) {
    insertLog(activeFlow.id, "agent:status", `could not trust Codex checkout: ${String(error)}`);
  }

  const proc = Bun.spawn(["/bin/zsh", "-lc", command], {
    cwd: activeFlow.checkoutPath,
    env,
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
  setSetting(codexThreadSettingKey(activeFlow.id), thread.id);
  updateFlow(activeFlow.id, { ...codexThreadMetadata(threadPayload), ...configuredAgentMetadata(activeFlow) });
  insertLog(activeFlow.id, "agent:status", `Codex thread ${thread.id} ready`);
  return runtime;
}

async function sendAgentTurn(runtime: RuntimeProcess, flow: Flow, message: string) {
  if (!runtime.threadId) throw new Error("Codex thread is not ready.");
  runtime.lastSeenAt = Date.now();
  if (runtime.activeTurnId) {
    await sendCodexRequest(runtime, "turn/steer", {
      threadId: runtime.threadId,
      input: textInput(message),
      expectedTurnId: runtime.activeTurnId,
    });
    return;
  }
  const response = (await sendCodexRequest(runtime, "turn/start", codexTurnParams(runtime, flow, message))) as {
    turn?: { id?: string };
  };
  runtime.activeTurnId = response.turn?.id;
}

function parseSlashCommand(message: string) {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return null;
  const [command] = trimmed.split(/\s+/, 1);
  return command.toLowerCase();
}

function slashCommandArgs(message: string) {
  const trimmed = message.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return "";
  return trimmed.slice(firstSpace).trim();
}

async function ensureCodexRuntime(flow: Flow) {
  return agentProcesses.get(flow.id) ?? (await startCodexAppServer(flow));
}

async function startFreshCodexThread(runtime: RuntimeProcess, flow: Flow) {
  if (runtime.activeTurnId) throw new Error("Cannot clear while a Codex turn is running.");
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
  setSetting(codexThreadSettingKey(flow.id), thread.id);
  updateFlow(flow.id, { ...codexThreadMetadata(threadResponse), ...configuredAgentMetadata(flow) });
  insertLog(flow.id, "agent:status", "context cleared");
  updateFlow(flow.id, { agentStatus: "idle" });
}

async function compactCodexThread(runtime: RuntimeProcess, flow: Flow) {
  if (!runtime.threadId) throw new Error("Codex thread is not ready.");
  if (runtime.activeTurnId) throw new Error("Cannot compact while a Codex turn is running.");
  insertLog(flow.id, "agent:status", "compact requested");
  updateFlow(flow.id, { agentStatus: "running" });
  await sendCodexRequest(runtime, "thread/compact/start", { threadId: runtime.threadId });
}

async function handleSlashCommand(flow: Flow, message: string) {
  flow = repairFlowCheckoutPath(flow);
  const command = parseSlashCommand(message);
  if (!command) return false;
  insertLog(flow.id, "user", `${message.trim()}\n`);

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

  const runtime = await ensureCodexRuntime(flow);
  if (command === "/clear") {
    await startFreshCodexThread(runtime, flow);
    return true;
  }
  if (command === "/compact") {
    await compactCodexThread(runtime, flow);
    return true;
  }
  throw new Error(`Unknown slash command: ${command}`);
}

async function startAgent(flow: Flow, userMessage = "") {
  flow = repairFlowCheckoutPath(flow);
  if (userMessage && (await handleSlashCommand(flow, userMessage))) return;
  const message = userMessage.trim();
  updateFlow(flow.id, {
    agentStatus: message ? "running" : "idle",
  });
  const updated = getFlow(flow.id);
  if (!updated) throw new Error("Flow disappeared while starting agent.");

  const existingRuntime = agentProcesses.get(flow.id);
  const isSteerMessage = Boolean(message && existingRuntime?.activeTurnId);
  const userLogId = message ? insertLog(flow.id, "user", `${userMessage}\n`) : 0;
  if (isSteerMessage) createTurnTraceGroup(flow.id, userLogId);
  try {
    const runtime = existingRuntime ?? (await startCodexAppServer(updated));
    if (!message) return;
    await sendAgentTurn(runtime, updated, userMessage);
  } catch (error) {
    updateFlow(flow.id, { agentStatus: "failed" });
    insertLog(flow.id, "agent:error", `${String(error)}\n`);
    throw error;
  }
}

async function runShellCommand(flow: Flow, userCommand: string) {
  flow = repairFlowCheckoutPath(flow);
  const command = userCommand.trim();
  if (!command) throw new Error("Type a shell command after $.");
  if (shellProcesses.has(flow.id)) throw new Error("A shell command is already running.");

  const proc = Bun.spawn(["/bin/zsh", "-lc", command], {
    cwd: flow.checkoutPath,
    env: runtimeEnv(flow),
    detached: true,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const runtime: RuntimeProcess = { flowId: flow.id, kind: "shell", proc, command };
  shellProcesses.set(flow.id, runtime);
  updateFlow(flow.id, { agentStatus: "running" });
  const commandLogId = insertLog(flow.id, "shell:command", command);

  const stdoutDone = streamProcessOutput(flow.id, "agent:cmd", proc.stdout).catch((error) =>
    insertLog(flow.id, "agent:stderr", `stdout read failed: ${String(error)}\n`),
  );
  const stderrDone = streamProcessOutput(flow.id, "agent:stderr", proc.stderr).catch((error) =>
    insertLog(flow.id, "agent:stderr", `stderr read failed: ${String(error)}\n`),
  );
  void Promise.all([stdoutDone, stderrDone]);

  try {
    const code = await proc.exited;
    await Promise.all([stdoutDone, stderrDone]);
    const resultLogId = insertLog(flow.id, "agent:tool-result", `${code === 0 ? "completed" : runtime.stopping ? "interrupted" : "failed"} exit ${code}`);
    createTraceGroupBetweenLogs(flow.id, commandLogId, resultLogId + 1, "shell");
    updateFlow(flow.id, { agentStatus: code === 0 || runtime.stopping ? "idle" : "failed" });
  } finally {
    if (shellProcesses.get(flow.id)?.proc === proc) shellProcesses.delete(flow.id);
  }
}

function interruptShellCommand(flowId: string) {
  const runtime = shellProcesses.get(flowId);
  if (!runtime) return false;
  updateFlow(flowId, { agentStatus: "interrupting" });
  insertLog(flowId, "agent:status", "shell interrupt requested");
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
  if (interruptShellCommand(flowId)) return;
  const runtime = agentProcesses.get(flowId);
  if (!runtime) return;
  if (!runtime.threadId || !runtime.activeTurnId) {
    updateFlow(flowId, { agentStatus: "idle" });
    return;
  }
  const turnId = runtime.activeTurnId;
  updateFlow(flowId, { agentStatus: "interrupting" });
  insertLog(flowId, "agent:status", `interrupt requested ${turnId}`);
  await sendCodexRequest(runtime, "turn/interrupt", {
    threadId: runtime.threadId,
    turnId,
  });
}

function stopIdleAgentRuntimesForEnvUpdate() {
  for (const runtime of agentProcesses.values()) {
    if (runtime.activeTurnId) continue;
    runtime.stopping = true;
    agentProcesses.delete(runtime.flowId);
    runtime.proc.kill();
    updateFlow(runtime.flowId, { agentStatus: "idle" });
    insertLog(runtime.flowId, "agent:status", "agent environment updated");
  }
}

function stopServe() {
  if (!serveProcess) return;
  const previous = serveProcess;
  serveProcess = null;
  previous.proc.kill();
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
}

async function fetchLinearIssue(identifier: string) {
  if (!linearAuthHeader()) return null;
  const body = await linearGraphql<{ issue?: LinearIssue }>(
    `
      query Issue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          url
          state { id name color type }
        }
      }
    `,
    { id: identifier },
  );
  return body.issue ?? null;
}

async function fetchLinearIssueDetail(identifier: string) {
  if (!linearAuthHeader()) return null;
  const body = await linearGraphql<{ issue?: LinearIssue }>(
    `
      query IssueDetail($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          url
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
            }
          }
        }
      }
    `,
    { id: identifier },
  );
  return body.issue ?? null;
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

function isDoneLinearIssue(issue: LinearIssue) {
  const stateName = issue.state?.name.trim().toLowerCase();
  const stateType = issue.state?.type?.trim().toLowerCase();
  return stateName === "done" || stateType === "completed";
}

async function listAssignedLinearIssues(apiKey?: string) {
  const data = await linearGraphql<{
    viewer: {
      id: string;
      name: string;
      assignedIssues: {
        nodes: LinearIssue[];
      };
    };
  }>(`
    query AssignedToMe {
      viewer {
        id
        name
        assignedIssues(first: 100) {
          nodes {
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
    }
  `, {}, apiKey);
  const flowsByIssue = new Map(listFlows().map((flow) => [flow.linearIssueId, flow]));
  return {
    viewer: { id: data.viewer.id, name: data.viewer.name },
    issues: data.viewer.assignedIssues.nodes.flatMap((issue) => {
      const flow = flowsByIssue.get(issue.identifier);
      if (isDoneLinearIssue(issue) && !flow) return [];
      return [
        {
          ...issue,
          flowId: flow?.id ?? "",
          flowStage: flow?.stage ?? "",
        },
      ];
    }),
  };
}

async function getDiff(flow: Flow, options: { patch?: boolean } = {}) {
  try {
    flow = repairFlowCheckoutPath(flow);
  } catch (error) {
    return { status: "", stat: "", names: "", patch: String(error), count: 0, additions: 0, deletions: 0, baseRef: "" };
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
  const numstatResult = await run(["diff", "--numstat", baseRef], { trim: false });
  const names = namesResult.ok ? namesResult.text : "";
  let additions = 0;
  let deletions = 0;
  if (numstatResult.ok) {
    for (const line of numstatResult.text.split("\n")) {
      const [added, deleted] = line.split("\t");
      const addedCount = Number(added);
      const deletedCount = Number(deleted);
      if (Number.isFinite(addedCount)) additions += addedCount;
      if (Number.isFinite(deletedCount)) deletions += deletedCount;
    }
  }
  const diff = {
    status: names.replaceAll("\0", "\n").trim(),
    names,
    count: names.split("\0").filter(Boolean).length,
    additions,
    deletions,
    baseRef,
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
      stages,
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
    await refreshCheckoutLinearStatuses();
    return json({ checkouts: listCheckouts() });
  }

  if (parts[0] === "api" && parts[1] === "checkouts" && parts[2] && request.method === "DELETE") {
    try {
      deleteCheckout(decodeURIComponent(parts[2]));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
    broadcast("checkouts", listCheckouts());
    return json({ ok: true, checkouts: listCheckouts() });
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
    return json({ contents: readEnvFile() });
  }

  if (url.pathname === "/api/env" && request.method === "PUT") {
    const body = await readJson<{ contents: string }>(request);
    sessionEnvContents = body.contents ?? "";
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
      broadcast("checkouts", listCheckouts());
    }
    return json({ ok: true, ...result });
  }

  if (url.pathname === "/api/flows" && request.method === "POST") {
    const body = await readJson<{ issue: string; title?: string }>(request);
    const parsed = parseLinearIssue(body.issue || "");
    if (!parsed.identifier) return json({ error: "Linear issue URL or key is required" }, { status: 400 });
    const existing = getFlowByIssue(parsed.identifier);
    if (existing) return json({ ok: true, alreadyExists: true, flow: existing });

    const id = crypto.randomUUID();
    const linearIssue = await fetchLinearIssue(parsed.identifier).catch(() => null);
    const { target, branch, baseSha } = createCheckout(id, parsed.identifier);
    const createdAt = now();
    db.query(`
      insert into flows (
        id, linearIssueId, linearIssueUrl, title, stage, linearStatus,
        checkoutPath, branchName, baseSha, agentStatus, serving, createdAt, updatedAt
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      parsed.identifier,
      linearIssue?.url || parsed.url,
      body.title?.trim() || linearIssue?.title || parsed.identifier,
      "planning",
      linearIssue?.state?.name || "",
      target,
      branch,
      baseSha,
      "idle",
      0,
      createdAt,
      createdAt,
    );
    const flow = getFlow(id);
    if (flow) {
      insertLog(id, "flow", `Created checkout ${target}\nBranch ${branch}\n`);
      await syncLinearStatus(flow);
    }
    broadcast("flows", listClientFlows());
    broadcast("checkouts", listCheckouts());
    return json({ ok: true, flow: getFlow(id) });
  }

  if (parts[0] === "api" && parts[1] === "flows" && parts[2]) {
    const id = parts[2];
    const flow = getFlow(id);
    if (!flow) return json({ error: "Flow not found" }, { status: 404 });

    if (parts.length === 3 && request.method === "GET") {
      return json({ flow });
    }

    if (parts[3] === "logs" && request.method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0);
      const logs = db
        .query("select * from logs where flowId = ? and id > ? order by id asc limit 1000")
        .all(id, after);
      return json({ logs });
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

    if (parts[3] === "context-images" && request.method === "POST") {
      try {
        const images = await saveFlowContextImages(repairFlowCheckoutPath(flow), await request.formData());
        return json({ ok: true, images });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
      }
    }

    if (parts[3] === "diff" && request.method === "GET") {
      return json(await getDiff(flow, { patch: url.searchParams.get("patch") === "1" }));
    }

    if ((parts[3] === "meta" || parts[3] === "stage") && request.method === "POST") {
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
      if (fields.stage) insertLog(id, "flow", `Stage changed to ${fields.stage}\n`);
      if (fields.prUrl !== undefined) {
        insertLog(id, "flow", fields.prUrl ? `PR set to ${fields.prUrl}\n` : "PR cleared\n");
      }
      return json({ ok: true, flow: getFlow(id) });
    }

    if (parts[3] === "agent" && parts[4] === "status" && request.method === "GET") {
      const reconciled = reconcileAgentHeartbeat(flow);
      return json({
        flow: runtimeAdjustedFlow(reconciled),
        turnRunning: Boolean(agentProcesses.get(id)?.activeTurnId),
      });
    }

    if (parts[3] === "agent" && parts[4] === "interrupt" && request.method === "POST") {
      await interruptAgent(id);
      return json({ ok: true });
    }

    if (parts[3] === "agent" && request.method === "POST") {
      const body = await readJson<{ message?: string }>(request);
      await startAgent(flow, body.message ?? "");
      return json({ ok: true });
    }

    if (parts[3] === "agent" && request.method === "DELETE") {
      await interruptAgent(id);
      return json({ ok: true });
    }

    if (parts[3] === "message" && request.method === "POST") {
      const body = await readJson<{ message: string }>(request);
      await startAgent(flow, body.message);
      return json({ ok: true });
    }

    if (parts[3] === "command" && request.method === "POST") {
      const body = await readJson<{ command: string }>(request);
      await runShellCommand(flow, body.command);
      return json({ ok: true });
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
      broadcast("checkouts", listCheckouts());
      return json({ ok: true, flow: getFlow(id) });
    }
  }

  if (url.pathname === "/api/linear/issues" && request.method === "GET") {
    const assigned = await listAssignedLinearIssues();
    setSetting("linearViewerName", assigned.viewer.name);
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
      console.error(error);
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  },
  websocket: {
    open(ws) {
      clients.add(ws as unknown as ServerWebSocket);
    },
    message() { },
    close(ws) {
      clients.delete(ws as unknown as ServerWebSocket);
    },
  },
});

console.log(`Turbopump running at ${apiBaseUrl}`);
