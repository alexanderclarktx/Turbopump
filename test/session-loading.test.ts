import { expect, test } from "bun:test";

const source = await Bun.file("public/js/logs.js").text();

test("prefetch prioritizes pins and skips completed and canceled history", () => {
  const body = source.slice(source.indexOf("export function ticketLogPrefetchCandidates()"), source.indexOf("export async function prefetchTicketLogs()"));
  const tickets = [
    { identifier: "done", state: { type: "completed" } },
    { identifier: "active", state: { type: "started" } },
    { identifier: "pinned-done", state: { type: "completed" } },
    { identifier: "canceled", state: { type: "canceled" } },
    { identifier: "pinned-active", state: { type: "started" } },
  ];
  const candidates = new Function("state", "sortedLinearTickets", "linearStatusIconKind", `${body.replace("export ", "")} return ticketLogPrefetchCandidates();`)(
    { linearTickets: tickets, pinnedLinearIssues: new Set(["pinned-active", "pinned-done"]) },
    (items: unknown[]) => [...items],
    (_name: string, type: string) => type === "completed" ? "done" : "started",
  );
  expect(candidates.map((ticket: { identifier: string }) => ticket.identifier)).toEqual(["pinned-active", "pinned-done", "active"]);
});

test("initial history stops after three pages even when a turn spans the full history", async () => {
  const body = source.slice(source.indexOf("export async function loadLogs("), source.indexOf("export function resetFlowLogWindow("));
  const state = {
    logs: new Map(), logBackfilledFlowIds: new Set(), lastLogId: new Map(), firstLogId: new Map(),
    logOlderCompleteFlowIds: new Set(), terminalVisibleTurnCounts: new Map(), flows: [],
  };
  let requests = 0;
  const dependencies = {
    state, LOG_PAGE_SIZE: 2, AGENT_TRACE_INITIAL_TURN_COUNT: 5,
    wsRequest: async () => { requests++; return { logs: [{ id: 100 - requests * 2 }, { id: 101 - requests * 2 }] }; },
    appendLogEntry: () => true, rememberLoadedLogBounds: () => {}, renderLogs: () => {},
    terminalGroups: () => [], terminalRowCount: () => 0, isShellOnlyRenderLog: () => false,
  };
  const load = new Function(...Object.keys(dependencies), `${body.replace("export ", "")} return loadLogs;`)(...Object.values(dependencies));
  await load("long-session");
  expect(requests).toBe(3);
  expect(state.logBackfilledFlowIds.has("long-session")).toBe(true);
  expect(state.logOlderCompleteFlowIds.has("long-session")).toBe(false);
});
