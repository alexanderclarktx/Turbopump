import { expect, test } from "bun:test";

const source = await Bun.file("public/js/notifications.js").text();
const body = source.slice(source.indexOf("export function normalizeLinearIssueNotifications()"), source.indexOf("export function clearLinearIssueNotification("));

function normalize(identifiers: string[], focused = true) {
  const state = {
    flows: [{ id: "flow-a" }, { id: "flow-b" }, { id: "split-b" }],
    notifiedLinearIssueIds: new Set(identifiers), selectedLinearIssueId: "ISSUE-A",
  };
  const mapping: Record<string, string> = { "flow-a": "ISSUE-A", "flow-b": "ISSUE-B", "split-b": "ISSUE-B" };
  let persisted = 0;
  let updated = 0;
  new Function("state", "flowSelectionIdForFlowId", "canAcknowledgeSelectedNotification", "persistLinearIssueNotifications", "updateBrowserTabNotification", `${body.replace("export ", "")} normalizeLinearIssueNotifications();`)(
    state, (id: string) => mapping[id] || "", () => focused, () => persisted++, () => updated++,
  );
  return { identifiers: [...state.notifiedLinearIssueIds], persisted, updated };
}

test("removes orphaned saved notifications and updates the tab", () => {
  expect(normalize(["deleted-session", "OLD-123"])).toEqual({ identifiers: [], persisted: 1, updated: 1 });
});

test("acknowledges the already-open session after reload", () => {
  expect(normalize(["ISSUE-A", "ISSUE-B"]).identifiers).toEqual(["ISSUE-B"]);
});

test("preserves unread notifications while the tab is unfocused", () => {
  expect(normalize(["ISSUE-A", "ISSUE-B"], false)).toEqual({ identifiers: ["ISSUE-A", "ISSUE-B"], persisted: 0, updated: 0 });
});

test("maps legacy and split session notifications to their parent ticket", () => {
  expect(normalize(["flow-a", "flow-b", "split-b"]).identifiers).toEqual(["ISSUE-B"]);
});

test("section notification indicators update without rebuilding cards and clear on acknowledgement", async () => {
  const ticketsSource = await Bun.file("public/js/tickets.js").text();
  const body = ticketsSource.slice(ticketsSource.indexOf("export function updateTicketStatusGroupShellStates()"), ticketsSource.indexOf("export function ticketInCollapsedStatusGroup("));
  const classes = new Set<string>();
  const section = {
    dataset: { status: "done" },
    classList: {
      contains: (name: string) => classes.has(name),
      toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
    },
  };
  const state = {
    linearTickets: [{ identifier: "AND-7141", status: "done" }, { identifier: "PINNED", status: "done" }],
    notifiedLinearIssueIds: new Set(["AND-7141"]),
  };
  const update = new Function("els", "state", "isLinearIssuePinned", "linearStatusKey", "linearStatusName", "ticketShellRunning", `${body.replace("export ", "")} return updateTicketStatusGroupShellStates;`)(
    { ticketGrid: { querySelectorAll: () => [section] } }, state,
    (id: string) => id === "PINNED", (status: string) => status, (ticket: { status: string }) => ticket.status, () => true,
  );
  update();
  expect(classes.has("agent-turn-notified")).toBe(true);
  expect(classes.has("shell-command-active")).toBe(true);
  state.notifiedLinearIssueIds.clear();
  update();
  expect(classes.has("agent-turn-notified")).toBe(false);
  state.notifiedLinearIssueIds.add("PINNED");
  update();
  expect(classes.has("agent-turn-notified")).toBe(false);
});
