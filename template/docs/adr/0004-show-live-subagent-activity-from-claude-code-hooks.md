# 4. Show live subagent activity from Claude Code hooks

## Status

Accepted

## Context

`ai-dash` only showed history: `data.json` is rebuilt from `executions.jsonl` when the gate runs, so nothing in it said which agents were working *right now*. For a team of agents run in parallel, "what is running, since when" is the first question, and the gate cannot answer it.

Claude Code already announces this: it fires a `SubagentStart` and a `SubagentStop` hook around every subagent run, with an `agent_id` and the `agent_type` (the agent's name). Agents are also claimed through `agent-team.sh claim`, but a claim is advisory and says nothing about whether the agent is running.

## Decision

- Register both hooks in `.claude/settings.json`, pointing at one dependency-free Node script, `scripts/agent-live.mjs`, so it runs the same on Windows, macOS and Linux.
- The script appends one line per event to `.agents/log/live.jsonl` (local, git-ignored, shared by every worktree through the git common dir, like the usage log). A line holds a timestamp, event, `agent_id`, agent name and session id, and it always exits 0 so a monitoring hook cannot break a session.
- A third hook, `PreToolUse` with no matcher, records each tool call a subagent makes (calls from the main thread have no `agent_id` and are skipped), so each running agent can show what it is doing. A tool line adds the tool name and a short target: a project-relative file path, the first 160 characters of a command, a search pattern, or a URL's host. Credential-looking text (`token=...`, `Bearer ...`, long opaque strings) is masked before it is written. Prompts and tool output are never stored.
- `scripts/ai-dash.mjs` serves `GET /api/live` (same `Host`/`Origin` check as the other endpoints): running agents with elapsed time, recent finished runs, and advisory claims, each enriched with the roster description and owned paths.
- The dashboard polls it every two seconds while the tab is visible and shows a Live panel. On a static host there is no endpoint, so the panel stays hidden; the rest of the dashboard is unchanged.
- An Activity card charts tool calls per hour, day, week or month. The raw log is kept short on purpose, so lines trimmed from it are first rolled into hourly counters (`.agents/log/activity.json`: counts per UTC hour, no names, paths or commands); the page regroups those hours in the reader's time zone.
- A start with no stop for 30 minutes is treated as gone, so a crashed session does not show an agent as running forever.

## Consequences

- Tool targets are more revealing than the start/stop times (a command can name a file or a host). The log stays local and git-ignored, is served only to `127.0.0.1` behind the same Host check as the other endpoints, and never goes into the counts-only `data.json`. Masking is a best effort, not a guarantee; do not run secrets through command lines.
- `PreToolUse` fires on every tool call, so each one starts a short Node process; the cost is small but not zero.
- Live view works only where `scripts/ai-dash.mjs` runs; the deployed, counts-only dashboard stays static on purpose.
- Built-in subagents (`Explore`, `Plan`, `general-purpose`) show up as well as roster agents; only roster agents get a description.
- Existing projects need the two hooks in their `.claude/settings.json`. `ai-project-starter update` applies them only if the project never customized that file; otherwise it writes `settings.json.incoming` to merge by hand.
- The main conversation of a session has no `agent_id`, so it is tracked separately as "Main session", labelled with the session's folder (a Claude Desktop worktree shows up by its name). Each turn is a run: `UserPromptSubmit` starts it, `Stop` and `StopFailure` end it. Claude Code does not fire `Stop` when the user interrupts, so a main session with no activity for 10 minutes counts as gone, and a new turn closes an interrupted one. Prompts and replies are not read from the payload or stored.
- The hooks have to exist where the session runs. A session in a git worktree only has them once `.claude/settings.json` and `scripts/agent-live.mjs` are committed and the worktree's branch has that commit; uncommitted changes in the main checkout are invisible to it.
- If Claude Code changes or renames these hook events, the panel goes quiet rather than failing; the script and the log format are the only things to adjust.
