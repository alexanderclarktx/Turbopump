# Turbopump 🔥

Turbopump is a local-first agent workflow app.

It accepts one repo, creates isolated Git worktrees for Linear tickets, runs Codex inside each worktree, and stores agent traces.

## Setup

```bash
# install dependencies
bun install

# run the server
bun run dev
```


then in settings:
- set your Linear API key
- set your repository URL

## How it works

- runs on `http://localhost:3999`
- pulls Linear tickets via API
- pulls your repo in the background, then on fresh sessions -> creates Git worktree-backed sessions
- does not provide any credentials for Codex (configure separately)
