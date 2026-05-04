# Turbopump

Turbopump is a local-first coding-agent workflow server. It accepts one repo, creates isolated filesystem checkouts for Linear tickets, runs agent harnesses inside those checkouts, stores logs, exposes a server-owned `.env` in the UI, and keeps a single active serve slot.

## Run

```sh
bun run dev
```

Then open `http://localhost:3999`.

## First-Iteration Scope

- One configured repo URL or local path.
- One full `git clone` per flow for filesystem isolation.
- Fixed stages: `not_started`, `working`, `reviewing`, `validating`, `done`.
- Agent harness command is configurable. The default is `codex app-server --listen stdio://`.
- The agent receives Turbopump flow context through its prompt and these environment variables:
  - `FLOW_RUN_ID`
  - `FLOW_API_URL`
  - `FLOW_STAGE`
  - all variables from `.flow/.env`
- The server stores all run logs in `.flow/flow.sqlite`.
- The serve command is repo-level and singleton. Updating env restarts the active serve process.
- Linear is configured with a separate API key field in the top-right UI. The key is stored in Turbopump settings, not injected into flow runtimes through `.flow/.env`.

## Agent Integration

Agents can move the workflow by calling:

```sh
curl -X POST http://localhost:3999/api/flows/$FLOW_RUN_ID/stage \
  -H 'content-type: application/json' \
  -d '{"stage":"reviewing"}'
```

Agents can add logs or status notes by writing to stdout/stderr. Turbopump captures both.

## Notes

Environment changes apply to newly spawned agent commands. If a flow is currently serving, Turbopump restarts the serve process immediately with the new environment.
