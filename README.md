# Agentor

**See what your AI agent actually did, and why.**

Agentor turns AI coding-agent sessions into navigable, reviewable workflow trees — in your terminal. Instead of scrolling a transcript, you see the structure of what happened: turns, tool calls, file edits, errors and retries, context compactions, and the paths the agent tried and abandoned.

```
agentor · claude-code session fixture-
“divide-by-zero fix”
v2.1.186 · mathlib (main) · 2026-07-01 10:00→10:01 UTC · 1m 36s

● Turn 1 Fix the divide function so it handles zero
  ○ thinking (30 chars)
  ▪ I'll read the math module first.
  ✓ Read src/math.ts
  ✗ Bash Run unit tests — Error: 2 tests failed (6s)
  ✓ Edit src/math.ts
  ▪ Fixed: divide now throws on zero.
  ▼ context compacted — dropped 42k tokens (50k → 8.0k) · auto
● Turn 2 Now add tests for the zero case
  ✓ Write src/math.test.ts
    ╳ abandoned path · 0 prompts · 1 tool call · 1 event
● Turn 3 Wait, don't refactor — just run the new tests
  ✓ Bash Run the new tests (4s)
  ▪ All tests pass.

────────────────────────────────────────────────────────────
3 turns · 6 tool calls (Bash 3, Read 1, Edit 1, Write 1)
files changed 2 · errors 1 · compactions 1 (dropped 42k tokens) · abandoned paths 1
tokens in 15k (98% cached) · out 440 · active 45s
```

*(rendered from the [test fixture session](packages/adapter-claude-code/test/fixtures/basic-session.jsonl))*

## Why

Reviewing agent output costs more attention than it should — median code-review time has exploded since agent adoption, because agents produce reasoning and then discard it before the diff. The two questions developers can't answer cheaply today:

- **"Why did it do that?"** — what context the agent saw, what it tried and abandoned
- **"What exactly changed, in what order?"** — every file touched, every command run, every error hit

Agentor answers both, locally, from the transcripts your agent already writes. No cloud, no hooks to install, no agent switch.

## Install & use

Requires Node ≥ 20 and pnpm.

```bash
git clone https://github.com/GabrielDillenburg/agentor.git
cd agentor
pnpm install && pnpm build

# Interactive TUI: session dashboard for the current project
node packages/cli/dist/index.js

# Live monitor: auto-attach to the newest session and follow in real time.
# Start your agent in one terminal, run this in another — it hops to new
# sessions automatically as they start.
node packages/cli/dist/index.js watch

# Interactive TUI: open one transcript directly (live-tails running sessions)
node packages/cli/dist/index.js ui ~/.claude/projects/<project-slug>/<session>.jsonl

# Review queue: every file the agent changed, with per-change provenance
node packages/cli/dist/index.js review [file]

# Static tree of the most recent session (pipe-friendly)
node packages/cli/dist/index.js parse [file]
#   --full       don't truncate prompts/text
#   --json       normalized session + totals as JSON
#   --no-color   plain output
```

TUI keys: `j/k` move · `J/K` jump ×10 · `g/G` top/end · `↵` **why** (provenance for the selected tool call) · `v` review queue · `c` context inspector · `t` replay · `f` follow (auto-scroll on live updates) · `d` detail pane · `r` refresh · `h`/`esc` back · `q` quit. On the dashboard: `w` enters watch mode; sessions active in the last 2 minutes show a green ● and an `ACTIVE` badge.

### Why did it do that?

Select any tool call and press `↵` to get its provenance in one screen: the **triggering prompt**, the **reasoning** right before the change, **what the agent had read** this turn, the **error→retry chain** that led here, the **diff itself**, and the file's history across the session. `v` lists every file the agent touched as a review queue — mark changes reviewed (`space`, persisted across restarts in `~/.agentor/review/`), jump into provenance with `↵`. `c` shows per-turn context-window occupancy (gauge vs a ~200k window), files read, and compaction losses. `t` replays the session step by step.

### Monitor a live session

The core workflow: run your coding agent in one terminal and `agentor watch` in another. Agentor auto-attaches to the newest session (waiting if none exists yet), follows every decision in real time with a `● WATCHING` status, and **hops to new sessions automatically** when you start them. Tool icons (`⚡` bash · `✎` edit · `✚` write · `⊙` read · `⌕` search · `◇` subagent · `⚙` MCP), tree guide lines, and a bordered detail card keep the stream scannable at a glance.

## Status: v0.1 M3 — provenance, review, context, replay

- [x] `@agentor/schema` — normalized, agent-agnostic session model (turns, tool calls, file changes, compactions, subagent spans, usage) + shared display-item derivation + provenance/context computations
- [x] `@agentor/adapter-claude-code` — parses Claude Code JSONL transcripts, fail-soft (unknown events become opaque nodes, never crashes)
- [x] `agentor parse` — static workflow tree with decision-relevant detail: error→retry chains, abandoned branches, context compactions with dropped-token counts
- [x] `agentor` (TUI) — session dashboard for the current project + **live-tailing** workflow tree of a running session, keyboard navigation, detail pane
- [x] **Decision provenance** (`↵`) — why each change happened: prompt, reasoning, context read, prior errors, diff, file history
- [x] **Review queue** (`v` / `agentor review`) — every file change, per-change provenance, persistent reviewed-state
- [x] **Context inspector** (`c`) — per-turn window occupancy, files read, tools, compaction losses
- [x] **Replay** (`t`) — scrub through the session step by step
- [ ] v0.2: control layer (checkpoints incl. bash side effects, rollback, approval gates) + opencode adapter

See [docs/PLAN.md](docs/PLAN.md) for the full product plan and market research summary.

## Architecture

```
packages/
  schema/                 the normalized session-event model (the contract) + display items
  adapter-claude-code/    Claude Code JSONL → Session, session discovery
  tui/                    Ink (React) terminal UI: dashboard + live session view
  cli/                    agentor bin: TUI launcher + parse command (static renderer)
```

The session model is deliberately agent-agnostic: adapters for Codex CLI, Gemini CLI, and opencode are planned (v0.2). Transcript formats are not stable APIs, so adapters are isolated, contract-tested against fixtures, and required to fail soft.

## Development

```bash
pnpm install
pnpm build        # tsc -b, all packages
pnpm test         # vitest
```

## License

MIT
