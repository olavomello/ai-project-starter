# .agents/ — local runtime state (not the agent roster)

This folder is **git-ignored** (see root `.gitignore`) except for this file and the
`.gitkeep` placeholders. It holds state that is per-machine / per-worktree and must
never be committed:

| Path | What it is |
|---|---|
| `state/` | Session handoff notes (`<task-id>.md`) — resume context, not history |
| `locks/` | `claim` records — which agent declared intent on which paths |
| `worktrees/` | The actual git worktrees created by `scripts/agent-team.sh start` |
| `log/` | `executions.jsonl` — the raw append-only log `ai-log.mjs` writes to |
| `media/` | Pending image-generation requests for the `photo-generation` skill |
| `gate.conf` | Local overrides for `scripts/gate.sh` (copied from `gate.conf.example`) |

**Agent definitions are not here.** Each agent's identity — name, description,
status, scope and rules — is a committed file in `docs/agents/<name>.md`, created by
`bash scripts/agent-team.sh new`. That split is intentional: `docs/agents/` is the
team roster (part of the project, travels with the repo, reviewed like any other
doc); `.agents/` is scratch state (differs per machine, would just be noise in
git history, and in a worktree setup would conflict across worktrees if committed).

If you're looking for the list of agents: `bash scripts/agent-team.sh list`, or read
`docs/agents/*.md` directly. This folder only tells you what they're doing *right now*.
