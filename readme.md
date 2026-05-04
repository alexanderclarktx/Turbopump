# Turbopump 🔥

Turbopump is a local-first agent workflow app.

It accepts one repo, creates isolated filesystem checkouts for Linear tickets, runs Codex inside checkouts, and stores agent traces.

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
- pulls your repo once, then on fresh sessions -> pulls main & copies all files
- does not provide any credentials for Codex (configure separately)
