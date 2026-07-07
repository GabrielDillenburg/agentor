# Agentor — Product & Development Plan

## Context

Developers using AI coding agents (Claude Code, Codex CLI, Gemini CLI, opencode…) have a legibility problem: the agent reads dozens of files, makes decisions, tries things, abandons them, and edits code — and the developer sees only a scrolling transcript. The two questions devs can't answer cheaply today are **"why did it do that?"** and **"what exactly did it change and in what order?"**. Reviewing agent output costs more attention than it should, and that cost is the ceiling on how much work devs delegate to agents.

**Agentor** is a visual, minimalist **terminal UI (TUI)** — "lazygit for AI coding sessions" — that attaches to existing coding agents and gives the developer observability over the session: a live **workflow tree**, **decision provenance** for every file change, and a **review queue** — without leaving the terminal or switching tools.

Decisions locked in with the founder:
- **Form factor:** CLI visual tool (TUI). Feasible and proven — lazygit, k9s, atuin; Claude Code itself is an Ink/React TUI.
- **Architecture:** companion layer on top of existing agents (not our own harness) — zero switching cost, rides the agents' growth.
- **MVP wedge:** observability first (read-only). Control features (checkpoints, gates) come in v0.2 on the same foundation.
- **Target user v1:** solo power devs running multiple agent sessions daily.
- **Business model:** OSS core (local-first) + paid team tier later.

## Answers to the strategic questions

**Is a CLI visual tool possible?** Yes. Modern TUI frameworks render trees, panes, diffs, live updates, and mouse/keyboard nav. Precedents at scale: lazygit (55k+ stars), k9s, gitui. Claude Code proves complex TUIs work in TypeScript/React (Ink).

**Is context/prompt/harness engineering important to this product?** Yes, in two distinct ways:
1. **It's the subject matter.** The product's core value is making the harness legible — what context the agent assembled (files read, CLAUDE.md, memory, MCP tools), what the prompt/system-prompt was, what the context window contained when a decision was made. "Decision provenance" *is* applied context engineering, surfaced visually.
2. **It's our engineering discipline.** We must deeply understand each agent's harness (hooks, session formats, telemetry) to instrument it. Later features monetize this knowledge directly: context-budget visualization, stale-context warnings, CLAUDE.md/skill effectiveness analysis.

**Does a workflow tree make sense?** Yes — it's the core navigation metaphor, and it's not invented: Claude Code session JSONL already stores messages with `parentUuid` links, subagent fan-outs, and retry chains. The session **is** a tree; today no tool renders it. Rule to keep us honest: every visual node must be *actionable* (inspect context, view diff, later: rollback/fork) — no visualization for its own sake.

## Product definition

> **Agentor** — see what your AI agent actually did, and why. A terminal UI that attaches to your coding-agent sessions and turns the scrolling transcript into a navigable, reviewable workflow tree.

### MVP feature set (v0.1 — "Session Explorer", read-only)

1. **Workflow tree (core view).** Live tree of the session: user turns → assistant reasoning → tool calls → file edits → subagent fan-outs → retries/errors. Collapsible nodes, vim-style navigation, live tail of a running session. Color-coded node types; errors and retry chains visually distinct.
2. **Decision provenance panel.** Select any file-edit node → right pane shows *why*: the assistant's reasoning immediately before, which files it had read, the triggering user instruction, the diff, and any error→retry chain that led here.
3. **Change review queue.** Flat list of every file touched in the session with per-hunk diffs; mark hunks reviewed/flagged; open file at line in `$EDITOR`. This is the "don't lose control" workflow: nothing the agent did escapes review.
4. **Context inspector.** Per turn: what was in the context window (files read, CLAUDE.md/memory injected, MCP tools), token usage and cost, context-window fill gauge. Answers "what did the model actually see?"
5. **Session dashboard.** k9s-style home screen: all projects, all sessions (running + historical), sortable by recency/cost/files-touched. Attach to any.
6. **Replay.** Scrub through a historical session step-by-step — onboarding devs onto "what happened while I was at lunch."

### Explicitly out of scope for v0.1
Checkpoints/rollback, approval gates, forking/branching (v0.2 — "control"); session sharing, annotations, cloud sync, audit (v0.3 — "team"); non-Claude-Code agents (v0.2+, via adapter interface designed in from day one).

## Architecture & tech stack

- **Language/runtime:** TypeScript + **Ink** (React for TUIs) on Node 22. Rationale: founder's primary stack is TS; Ink is proven at exactly this complexity class (Claude Code); npm gives frictionless distribution (`npx agentor`). If perf ever demands it, the renderer can be swapped later — the asset is the data layer, not the widgets.
- **Data layer — the real moat:** a normalized **session-event schema** (turns, tool calls, edits, subagent spans, errors, token/cost) with per-agent **adapters**:
  - **Adapter #1 (MVP): Claude Code** — parse session JSONL from `~/.claude/projects/<slug>/*.jsonl` (messages carry `parentUuid` → tree for free), watch via fs events for live tail; hooks (PreToolUse/PostToolUse/Stop) for real-time signals; optional OTel.
  - Adapter interface published so Codex CLI / Gemini CLI / opencode adapters can be community-contributed.
- **Storage:** local SQLite index of parsed sessions (fast dashboard, search across sessions). No network calls in OSS core — local-first is the trust story.
- **Repo layout:** monorepo — `packages/schema` (event types), `packages/adapter-claude-code`, `packages/tui` (Ink app), `packages/cli` (entry, `agentor` bin).

## Market positioning (July 2026 scan — sourced research on file)

**Demand is quantified, not hypothetical.** Faros AI (22k devs, 4k teams, Mar 2026): median review duration up **441.5%**; PRs merged with zero review up 31.3%. Addy Osmani's "Agentic Code Review" (June 2026) names the cause — "review wasn't built to recover missing intent" — and calls for exactly our product: agent decision logs attached to PRs. GitHub issues + HN threads document the same pains: "no record of what was done" (claude-code#29684), "discover it went a completely different route than I expected" (HN), silent compaction destroying context.

**The landscape splits into two camps, neither of which does what we do:**
- *Parallel-agent orchestrators* — Conductor (Mac), Nimbalyst (ex-Crystal), Sculptor (Imbue), Vibe Kanban, Cursor's Agents Window: manage parallel worktrees and show **final diffs**. No decision-level session legibility, no replay of reasoning. Terragon (cloud orchestration) **shut down Feb 2026** — orchestration alone is not a moat.
- *Transcript viewers* — a long tail of single-agent OSS (claude-code-trace, agent-flow, AgentMemory…). They replay **events**, not **decisions**. Closest competitor: **AgentsView** (OSS, reads 20+ agents' session files) — but it is analytics/search-first, not decision-tree + review-first.

**LLM-observability platforms (LangSmith, Langfuse, Braintrust, Phoenix…)** still target the AI-app-builder persona; Langfuse's Claude Code integration exists but renders into a generic trace UI requiring hook scripts + hosted backend. The "developer reviewing their own agent's work, local-first, in the terminal" persona is unserved.

**Native features set the bar we must clear:** Claude Code now has checkpointing + /rewind and a native **Agent View** dashboard (May 2026). Implication: a session *dashboard* is table stakes, not a differentiator — **decision provenance + the review queue are the headline**. Two native blind spots we exploit: /rewind doesn't track bash side effects (rm/mv/cp invisible), and compaction silently drops context — Agentor's provenance and context inspector surface both.

**Confirmed extension points:** Claude Code (JSONL w/ `parentUuid`, hooks, OTel, Agent SDK); Codex CLI (rollout JSONL + new App Server bidirectional protocol — even permits control); Gemini CLI (chat files + shadow-git checkpoints); opencode (cleanest: OpenAPI spec + SSE event stream). No cross-agent standard exists — the normalized schema is genuinely novel unification work.

**Top market gaps we align to (from the scan):** (1) cross-agent session normalization + visualization, (2) decision-level legibility vs transcript replay, (3) session-as-review-artifact ("PR for the session"), (4) unified control plane across agents, (5) team layer for local CLI agents. Agentor's roadmap maps v0.1 → gaps 1-2, v0.2 → gap 4, v0.3 → gaps 3+5.

## Roadmap

- **v0.1 (weeks 1–6):** Session Explorer as above, Claude Code only. OSS launch (MIT), Show HN + r/ClaudeAI. Positioning line: *not* another dashboard (Claude Code has Agent View natively) — the pitch is decision provenance + review queue.
- **v0.2 (months 2–4):** Control layer — git-snapshot checkpoints at turn boundaries (via hooks) **including bash side effects that native /rewind misses**, per-node rollback, approval gates on risky tool calls (PreToolUse), fork-a-turn into a worktree. Second adapter: **opencode** (cleanest surface — OpenAPI + SSE) to prove the schema; Codex CLI third (rollout JSONL + App Server, which even allows control).
- **v0.3 (months 4–8):** Team tier (paid) — "PR for the session": export/share a session as a sanitized static bundle or hosted link, annotations, approve/annotate workflow, org audit trail. Directly validated by Osmani/Propel essays calling for exactly this; only Amp ships it today and only for its own agent. OSS core stays fully useful solo.

## Business model & GTM

- OSS core (MIT), npm + Homebrew distribution. Bottom-up: the tool is demo-able in a 30-second GIF (tree animating live next to a Claude Code session) — built for HN/X virality.
- Paid team tier at v0.3 (per-seat): sharing, review workflows, audit, org metrics (acceptance rate of agent edits, rework rate, cost per merged change).
- Moat trajectory: adapter breadth + the normalized session schema becoming the de-facto interchange format ("the LSP of agent sessions").

## Risks

1. **Platform absorption** — already partially happening: Claude Code shipped Agent View (May 2026), Cursor shipped its Agents Window. Mitigation: go *deeper* than any native viewer (decision provenance, not status dashboards) and *wider* (multi-agent normalization; single-vendor UIs won't cover a mixed Claude Code + Codex + opencode fleet). The review/team workflow (v0.3) is a product surface vendors have left open — only Amp does it, single-vendor.
2. **Session format drift** — JSONL formats are not stable APIs (open Codex data-loss bugs around rollout files prove it). Mitigation: adapter isolation, contract tests against recorded fixture sessions per agent version, fail-soft parsing (unknown events render as opaque nodes, never crash).
3. **"Nice demo, unused tool"** — devs watch the transcript instead; a crowded field of abandoned OSS viewers shows a tree alone doesn't retain. Mitigation: the review queue must save real review time (the 441% review-inflation stat is the pain to sell against); dogfood ruthlessly; success metric below.
4. **Crowded low end** — dozens of free single-agent viewers (AgentsView et al.). Mitigation: polish + decision-level depth + control roadmap; the OSS long tail validates demand while none has product velocity toward review/control/team.

## Verification / first milestones

- **M1 (week 1):** `agentor parse <session.jsonl>` prints a correct static tree of a real Claude Code session to stdout. Validates the adapter + schema on real data before any UI exists.
- **M2 (week 3):** Interactive TUI: dashboard + live-tailing workflow tree of a running session.
- **M3 (week 5):** Provenance panel + review queue + context inspector; replay.
- **Validation loop:** dogfood on the founder's own sessions daily from M2; 10 external design partners from the Claude Code community at M3.
- **Success metric for v0.1:** the founder (then design partners) opens Agentor for >50% of agent sessions in week 4 of usage; review queue used on real merges.
