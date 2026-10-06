# 4. Show live subagent activity from Claude Code hooks

## Status

Accepted

## Context

`ai-dash` only showed history: `data.json` is rebuilt from `executions.jsonl` when the gate runs, so nothing in it said which agents were working *right now*. For a team of agents run in parallel, "what is running, since when" is the first question, and the gate cannot answer it.

Claude Code already announces this: it fires a `SubagentStart` and a `SubagentStop` hook around every subagent run, with an `agent_id` and the `agent_type` (the agent's name). Agents are also claimed through `agent-team.sh claim`, but a claim is advisory and says nothing about whether the agent is running.

## Decision

- Register both hooks in `.claude/settings.json`, pointing at one dependency-free Node script, `scripts/agent-live.mjs`, so it runs the same on Windows, macOS and Linux.
- The script appends one line per event to `.agents/log/live.jsonl` (local, git-ignored, shared by every worktree through the git common dir, like the usage log). A line holds a timestamp, event, `agent_id`, agent name and session id. It never holds prompts, paths or output, and it always exits 0 so a monitoring hook cannot break a session.
- `scripts/ai-dash.mjs` serves `GET /api/live` (same `Host`/`Origin` check as the other endpoints): running agents with elapsed time, recent finished runs, and advisory claims, each enriched with the roster description and owned paths.
- The dashboard polls it every two seconds while the tab is visible and shows a Live panel. On a static host there is no endpoint, so the panel stays hidden; the rest of the dashboard is unchanged.
- A start with no stop for 30 minutes is treated as gone, so a crashed session does not show an agent as running forever.

## Consequences

- Live view works only where `scripts/ai-dash.mjs` runs; the deployed, counts-only dashboard stays static on purpose.
- Built-in subagents (`Explore`, `Plan`, `general-purpose`) show up as well as roster agents; only roster agents get a description.
- Existing projects need the two hooks in their `.claude/settings.json`. `ai-project-starter update` applies them only if the project never customized that file; otherwise it writes `settings.json.incoming` to merge by hand.
- The main conversation is not an agent here (it has no `agent_id`), so it is not listed.
- If Claude Code changes or renames these hook events, the panel goes quiet rather than failing; the script and the log format are the only things to adjust.
