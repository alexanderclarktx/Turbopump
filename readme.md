# Turbopump 🔥

Turbopump is a local-first agent workflow app.

It accepts one repo, creates isolated Git worktrees for Linear tickets, runs Codex/Claude inside each worktree, and stores agent traces.

## Setup

```bash
# install dependencies
bun install

# run the server
bun run dev
```


then in settings:
- set your Linear API key
- set a GitHub personal access token with Pull requests, Actions, and Commit statuses read access
- set your repository URL

## How it works

- runs on `http://localhost:3999`
- pulls Linear tickets via API
- keeps a warmed copy of your repo in `.flow/repo` and pulls it in the background
- creates each ticket session as an isolated Git worktree under `.flow/worktrees`
- starts prompts and shell commands from that ticket's worktree directory
- does not provide any credentials for Codex/Claude (configure separately)
