# AGENT_TEAM.md

How agents in this project create and coordinate other agents. Read by Main at plan time and by any agent considering a spawn.

**Agent definitions (identity, scope, rules) are committed files in `docs/agents/`.**
`.agents/` (git-ignored) is a different thing — local runtime state: worktrees, locks,
the execution log. It never holds an agent's identity. See `.agents/README.md` for
what lives there and why the two are split.

## CONFIGS

```
auto_agents: ask
main_merge:  ask
```

### auto_agents

| Value | Meaning |
|---|---|
| `true` | Any agent may create sub-agents without approval, within the limits below. |
| `false` | No spawning. When an agent spots a worthwhile one, it says so and asks the Administrator to flip to `true`. |
| `disabled` | No spawning, and agents stop raising the subject for this project. |
| `ask` | Not decided yet — Main asks at the start of the first plan. |

**At plan time**, if the value is `ask`, Main asks: *"Auto agents for this project: true or false?"* and writes the answer here.
If the answer is `false`, Main asks one follow-up: *"Disable auto agents completely for this project, so I stop asking?"* — a yes writes `disabled`.
While `false`, an agent that spots a worthwhile spawn names it once per opportunity — what it would own, what it would parallelize, the expected saving — and continues without it. It does not re-raise the same one.

### main_merge

| Value | Meaning |
|---|---|
| `true` | Main may merge PRs that `agent-team.sh classify` rates **mechanical**. Everything else still waits for the Administrator. |
| `false` | Every PR waits for the Administrator, mechanical or not. |
| `ask` | Not decided yet — Main asks at the start of the first plan. |

**At plan time**, if the value is `ask`, Main asks: *"May Main merge the PRs it classifies as safe — docs, tests and formatting only — without waiting for you?"* and writes `true` or `false` here.

A PR is **mechanical** only when every changed path is documentation, a test, or a formatting-only change, **and** none of them is a sensitive path (list below), **and** the diff is under 400 changed lines. Anything else is **administrator**. The classification is produced by the script, not by an agent's judgement, and Main never overrides it upward.

Sensitive paths, always administrator regardless of size: dependency manifests and lockfiles, `.github/`, CI and deploy config, Dockerfiles and infra, database migrations and schema, anything under an `auth`, `security`, `payment` or `billing` path, `VERSION`, `CHANGELOG.md`, `AGENTS.md`, `AGENT_TEAM.md`, `scripts/gate.sh`, `scripts/agent-team.sh`, `.claude/`.

## The starter agent

A new project ships with one agent, `docs/agents/sys-init-starter.md`: the **Starter**. It runs the project's first prompt and prepares the structure so everything else works. Start it from Claude Code at the project root:

> Run the starter agent: read `docs/agents/sys-init-starter.md` and follow it end to end.

- **Hierarchy:** the highest among agents, below the Administrator. Until its setup is finished it acts with Main's authority over `AGENTS.md` section 0, the CONFIGS block above, `docs/agents/`, `docs/repo-map.md`, `docs/decisions.md`, `README.md` and `.agents/gate.conf`. It never edits `VERSION`, creates tags, changes CI or dependencies, touches billing or usage limits, or force-pushes.
- **What it does, in order:** fills in project identity and the README, asks `auto_agents` and `main_merge`, sets up and runs the gate, writes the first repo map and decision, proposes the agent team for the Administrator's approval and creates it, commits, and reports.
- **Retirement:** it runs once. After reporting it asks whether to remove itself; on yes it deletes its own file in a separate commit. `docs/agents/` is never auto-applied by `ai-project-starter update`, so it does not come back. If kept, it is set to `Status : OFF`.

## When to spawn

Spawn only when **all** of these hold:

1. **Real parallelism.** The work can run at the same time as the caller's, not merely instead of it. A step that must finish before the caller continues is not a spawn; it's the caller's next step.
2. **Declared ownership.** The candidate can name the files it will change. Overlap with a live agent isn't fatal — every agent gets its own worktree — but it predicts a merge conflict, so prefer splitting the work differently.
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

`new` also generates `.claude/agents/<name>.md`, a thin pointer with the agent's `name` and `description` that tells Claude Code's subagent to read the roster file. That is what makes the agent available to Claude Code: type `@` and it appears as `@agent-<name>`. Never edit the pointer: change the roster file and run `bash scripts/agent-team.sh sync-claude` (or `node scripts/agents-sync.mjs`). Agents set to `OFF`, or deleted from `docs/agents/`, lose their pointer on the next sync, and `agent-team.sh check` fails if the two drift apart. Hand-written subagents in `.claude/agents/` are never touched.

Each agent file contains only what is specific to it. Project-wide rules live in `AGENTS.md` and are never copied into an agent file. An agent rule may narrow a project rule; it may never relax one.

## Isolation: every agent gets a worktree

No agent writes in the main working tree. Ever. A shared tree loses work the moment two agents write at once, and no protocol run by agents that can forget will reliably prevent it. Isolation is structural instead.

```bash
bash scripts/agent-team.sh start dev-api-tester
```

This creates branch `agent/dev-api-tester` and a worktree at `.agents/worktrees/dev-api-tester/`, branched from the current `main`. In Claude Code, `isolation: "worktree"` on the Agent tool does the same thing — either is fine, as long as the agent is not in the main tree.

Inside its worktree the agent works normally: no claiming, no waiting, no risk of clobbering. If it produces something wrong, the branch is deleted and nothing else is affected.

**`claim` still exists, with a different job.** It now declares intent — which paths an agent expects to touch — so overlaps surface at planning time instead of at merge time. A refused claim is a warning, not a lock: it means two agents are heading for the same files and the work should probably be split differently. Main decides.

**Sync before starting and before finishing:** `bash scripts/agent-team.sh sync <name>` fetches and rebases the agent's branch onto the current `main`. An agent that has been running a while rebases again before opening its PR, so the PR is reviewed against what `main` actually is now.

Shared files — dependency manifests, lockfiles, CI config, `CHANGELOG.md` — are still best touched by one agent at a time, because a lockfile conflict is painful to resolve whether or not the trees were isolated.

## Finishing: PR, then merge

```bash
bash scripts/agent-team.sh finish dev-api-tester
```

The script, in order: rebases onto `main`, runs `scripts/gate.sh`, refuses to continue if the gate fails, commits anything outstanding, pushes the branch, opens a PR (via `gh` when available, otherwise prints the URL to open), and prints the classification.

The PR body states what changed, how it was verified, and what is still open. Title is Conventional Commits, so the release scope can be read off the merged history.

**Merging:**

- **Main reviews every PR** — the agent that wrote the code never merges its own work.
- If `main_merge: true` and the classification is `mechanical`, Main merges it.
- Otherwise the PR waits for the Administrator. Main says which PRs are waiting and why.
- **One at a time.** Before each merge, rebase onto the current `main` and re-run the gate. Two PRs that each passed alone can still break together — a rename in one, a call to the old name in the other — and only a post-rebase gate catches it.
- After merge: `bash scripts/agent-team.sh cleanup <name>` removes the worktree and the local branch.

**A failing gate is never merged and never "fixed" by weakening the gate.** The agent fixes its branch, or reports the blocker to Main.

## Lifecycle

- `Status: ON` — dispatchable. `Status: OFF` — kept for the record, not dispatched. Agents set their own status; deleting an agent file is an Administrator decision.
- An agent whose area disappears goes `OFF` with a one-line reason appended to its SCOPE AND RULES.
- Before spawning, check `docs/agents/` for an existing agent that already covers the area. Reuse beats creating a near-duplicate.
- `bash scripts/agent-team.sh list` prints the roster with status, declared paths, live worktrees and open branches.

## Boundaries

Sub-agents inherit every rule in `AGENTS.md`, including the budget guardrails. In addition, no agent other than Main may: merge a PR, edit `VERSION`, create tags, promote `[Unreleased]`, change CI, add dependencies, or alter this file. An agent that needs one of these proposes it in its PR and stops. Those go up the chain to Main, and from Main to the Administrator.
