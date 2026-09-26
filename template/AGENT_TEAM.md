# AGENT_TEAM.md

How agents in this project create and coordinate other agents. Read by Main at plan time and by any agent considering a spawn. Agent definitions live in `docs/agents/`.

## CONFIGS

```
auto_agents: ask
```

| Value | Meaning |
|---|---|
| `true` | Any agent may create sub-agents without approval, within the limits below. |
| `false` | No spawning. When an agent spots a worthwhile one, it says so and asks the Administrator to flip to `true`. |
| `disabled` | No spawning, and agents stop raising the subject for this project. |
| `ask` | Not decided yet — Main asks at the start of the first plan. |

**At plan time**, if the value is `ask`, Main asks: *"Auto agents for this project: true or false?"* and writes the answer here.
If the answer is `false`, Main asks one follow-up: *"Disable auto agents completely for this project, so I stop asking?"* — a yes writes `disabled`.
While `false`, an agent that spots a worthwhile spawn names it once per opportunity — what it would own, what it would parallelize, the expected saving — and continues without it. It does not re-raise the same one.

## When to spawn

Spawn only when **all** of these hold:

1. **Real parallelism.** The work can run at the same time as the caller's, not merely instead of it. A step that must finish before the caller continues is not a spawn; it's the caller's next step.
2. **Disjoint ownership.** The candidate can own a set of files nothing else is touching. Overlap means no spawn — or a worktree (see below).
3. **Worth the setup.** More than ~3 tool calls of real work, and the spawn plus its report costs less than doing it inline.
4. **A narrow purpose.** One area, one function. "Help with the backend" is not an agent; "write and run contract tests for the orders API" is.

Deciding this during the **plan** phase is the ideal — the team is designed once, before anything is written. Discovering the need mid-flight is fine and needs no re-plan; the same four tests apply.

**Never spawn for:** work already in the caller's context, a task under ~3 tool calls, a second opinion on something already reviewed, or "to be thorough."

## Limits

| Limit | Value | Why |
|---|---|---|
| Spawn depth | 3 (Main = 0) | Agents create agents; without a ceiling this is unbounded. |
| Concurrent agents per project | 4 | Beyond this, coordination costs more than the parallelism returns. |
| Agents per parent | 3 | A parent that needs more has a scoping problem, not a staffing problem. |

Limits are hard. An agent at the ceiling reports the need to its parent instead of spawning. Main reports it to the Administrator. Raising a limit is an Administrator decision.

## Creating one

Name: `<3-letter function>-<area>-<role>` — lowercase, exactly three hyphenated parts.
Examples: `dev-api-tester`, `dev-auth-builder`, `sec-payments-auditor`, `doc-sdk-writer`, `ops-ci-fixer`.

```bash
bash scripts/agent-team.sh new dev-api-tester "Writes and runs contract tests for the orders API" "tests/api/**,src/orders/**"
```

This writes `docs/agents/dev-api-tester.md` from the template, with `Status: ON` and the declared ownership. Fill in SCOPE AND RULES before dispatching it. The file is committed — the team is part of the project, not of one session.

Each agent file contains only what is specific to it. Project-wide rules live in `AGENTS.md` and are never copied into an agent file. An agent rule may narrow a project rule; it may never relax one.

## Working without clobbering

Parallel agents on one working tree will overwrite each other unless ownership is explicit. The protocol:

1. **Claim before writing.** `bash scripts/agent-team.sh claim <name>` takes the globs declared in the agent's file. The claim is atomic — if another agent holds an overlapping path, the claim fails and prints who holds it. A refused claim means wait or renegotiate scope, never force.
2. **Sync before each unit of work.** `bash scripts/agent-team.sh sync` fetches and reports what changed since the agent's last checkpoint. Re-read any file before editing it; never write from a read taken before the last sync.
3. **Edit narrowly.** Targeted replacements inside owned paths. Never a full-file rewrite of a file another agent may hold.
4. **Release when done.** `bash scripts/agent-team.sh release <name>` — followed by a report to the parent: what changed, how it was verified, what's still open.
5. **Shared files** — `package.json`, lockfiles, CI config, `CHANGELOG.md` — are claimed for the shortest possible window, by one agent at a time.

When two agents genuinely need the same files, don't interleave them. Give one a git worktree (`isolation: "worktree"` in Claude Code, or `git worktree add`) and merge the branch back. Slower to set up, but it cannot lose work.

Stale claims older than 60 minutes are reported by `scripts/agent-team.sh check` and may be released by Main after confirming the holder is gone.

## Lifecycle

- `Status: ON` — dispatchable. `Status: OFF` — kept for the record, not dispatched. Agents set their own status; deleting an agent file is an Administrator decision.
- An agent whose area disappears goes `OFF` with a one-line reason appended to its SCOPE AND RULES.
- Before spawning, check `docs/agents/` for an existing agent that already covers the area. Reuse beats creating a near-duplicate.
- `bash scripts/agent-team.sh list` prints the roster with status, owner globs, and live claims.

## Boundaries

Sub-agents inherit every rule in `AGENTS.md`, including the budget guardrails. In addition, no agent other than Main may: edit `VERSION`, create tags, promote `[Unreleased]`, change CI, add dependencies, or alter this file. Those go up the chain to Main, and from Main to the Administrator.
