<div align="center">

# ai-project-starter

**The base every new project is bootstrapped from — agent rules, SemVer, a worktree-isolated agent team, one verification gate, and a self-hosted monitoring dashboard.**

![version](https://img.shields.io/badge/version-0.1.0-blue)
![semver](https://img.shields.io/badge/semver-2.0.0-informational)
![keep a changelog](https://img.shields.io/badge/changelog-Keep%20a%20Changelog-orange)
![primary](https://img.shields.io/badge/primary-Claude%20Code-6b4fbb)
![node](https://img.shields.io/badge/scripts-cross--platform%20Node-339933)

</div>

---

Every new project starts the same way: copy this repo, fill in a handful of knobs, and every agent — human-directed or autonomous — inherits the same rules, the same quality gate, and the same way of spawning and coordinating sub-agents. No project reinvents its own conventions from scratch.

Primary target is **Claude Code**. Also usable by Codex and other agents, since the rules live in a tool-agnostic `AGENTS.md`.

## Contents

- [Quick start](#quick-start)
- [The CLI](#the-cli)
- [PROMPTS.md — bootstrapping via an agent instead of the CLI](#promptsmd--bootstrapping-via-an-agent-instead-of-the-cli)
- [What you get](#what-you-get)
- [How it works](#how-it-works)
  - [The gate](#the-gate)
  - [The agent team](#the-agent-team)
  - [Releases (SemVer)](#releases-semver)
  - [Architecture Decision Records (ADRs)](#architecture-decision-records-adrs)
  - [Monitoring dashboard](#monitoring-dashboard)
  - [Skills](#skills)
- [Command reference](#command-reference)
- [Configuration](#configuration)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Repo layout (this repo itself)](#repo-layout-this-repo-itself)

---

## Quick start

### 1. Create the project

Two ways to do this — same result, pick based on what you have installed.

**CLI (Node + git only — works the same on Windows, macOS, Linux):**

```bash
npx github:olavomello/ai-project-starter#main cli init my-project
cd my-project
```

**Bash script (needs a real `bash` — Git Bash or WSL on Windows):**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/olavomello/ai-project-starter/main/init-project.sh) my-project
cd my-project
```

Either way: it clones the starter, copies `template/` into `my-project`, runs `git init`, makes the first commit, and validates it with the version gate. Pin a specific starter release instead of `main` by adding it as an argument (`... init my-project --ref v0.1.0` for the CLI, `... my-project v0.1.0` for the script).

The CLI additionally asks a few questions right there in the terminal — name, purpose, stack, administrator, the knobs — and writes the answers into `AGENTS.md` before the first commit, so step 2 below is already done. Pass `--no-prompt` to skip that and fill it in yourself later (it's also skipped automatically when there's no terminal to prompt in, e.g. piped input or CI).

If the starter repo is private, neither form above can authenticate — clone it first and run locally instead:

```bash
git clone https://github.com/olavomello/ai-project-starter.git
node ai-project-starter/cli/bin.js init my-project        # or:
bash ai-project-starter/init-project.sh my-project
```

> **Windows and the bash script:** `init-project.sh` needs a real `bash`. If yours is broken, use the CLI above instead — it only needs `git` and `node`, both of which run natively on Windows. `bash .claude/skills/semver-release/scripts/check-version.sh` inside a generated project still needs bash either way, but everything else (`gate.sh`'s Node steps, `ai-log.mjs`, `ai-report.mjs`) is plain Node.

### 2. Fill in section 0 of `AGENTS.md`

Name, purpose, stack, administrator, and the knobs (coverage floor, file-size limits, branch model). Agents read these instead of assuming defaults — a wrong value here becomes a wrong rule everywhere else. Skip this step if you used the CLI interactively (step 1 already did it) or used the [PROMPTS.md bootstrap prompt](#promptsmd--bootstrapping-via-an-agent-instead-of-the-cli) with an agent.

### 3. Point the gate at your stack

```bash
bash scripts/gate.sh
```

It auto-detects npm, Deno, pyproject and Cargo scripts for format/lint/types/test. Steps it can't detect are **skipped**, not failed. To correct or disable a step:

```bash
cp .agents/gate.conf.example .agents/gate.conf
# FORMAT="npm run format"
# TYPES="skip"
```

`scripts/gate.sh` is the **only** verification command agents should run. Add your stack's setup steps (install, build, etc.) to `.github/workflows/gate.yml` before the gate step.

### 4. Add the remote and push

```bash
git remote add origin git@github.com:<you>/my-project.git
git push -u origin main
```

### 5. Work

Open the project in Claude Code. `CLAUDE.md` imports `AGENTS.md`, so every session starts with the rules and the vendored skills in `.claude/skills/` already loaded.

At the start of the first plan, Main asks two questions once and records the answers in `AGENT_TEAM.md`:

- **`auto_agents`** — may agents create other agents to parallelize work?
- **`main_merge`** — may Main merge the PRs it classifies as safe (docs/tests/formatting only), or does every PR wait for you?

Agents never bump `VERSION` or create tags on their own — they report a `version-impact` line and you decide.

### 6. Keep the project current (optional)

A project created with the CLI carries a `.ai-project-starter.json` manifest. Later, pull starter improvements in without hand-copying files:

```bash
npx github:olavomello/ai-project-starter#main cli update --dry-run   # see what would change
npx github:olavomello/ai-project-starter#main cli update             # apply it
```

It only ever touches a file the project hasn't customized since the last sync — anything else is flagged, never silently overwritten (see the CLI's own [README](cli/README.md) for exactly how). A project created with `init-project.sh` (no manifest yet) can opt in with `cli adopt` first.

---

## The CLI

`cli/` is a small, zero-dependency Node package with four commands — it exists specifically so bootstrapping and updating a project never require `bash` (only `node` and `git`, both native on Windows):

| Command | Does |
|---|---|
| `init <dir>` | Same as `init-project.sh`, without the bash requirement. Interactively fills `AGENTS.md` section 0 when run in a terminal (`--no-prompt` to skip) |
| `update [dir]` | Pulls starter improvements into an already-created project — conservatively, see above |
| `adopt [dir]` | Registers a project made with `init-project.sh` (or by hand) so `update` can track it |
| `doctor [dir]` | Structural health check — required files, valid `VERSION`, changelog shape, each `docs/agents/*.md` well-formed |

Not published to npm yet — run it via `npx github:olavomello/ai-project-starter#main cli <command>` or clone and run `node ai-project-starter/cli/bin.js <command>` directly. Full command flags and the exact three-way sync rules `update` follows: [`cli/README.md`](cli/README.md).

The `template/` repo stays the source of truth either way — the CLI only wraps it. Publishing to npm needs a real `LICENSE` file first (there isn't one yet, so `cli/package.json` currently marks it `UNLICENSED` as a placeholder).

---

## PROMPTS.md — bootstrapping via an agent instead of the CLI

Some people never leave their agent's chat to run a CLI command. [`PROMPTS.md`](PROMPTS.md) at the repo root is the prompt-based equivalent of the CLI: a maintained, copy-pasteable library of prompts for working with a project built on this starter, starting with one that bootstraps a brand-new project — clone the starter, fill in `AGENTS.md` section 0 by asking you the same questions the CLI's guided `init` asks, and get the project ready to work on — entirely by pasting a prompt into an agent instead of running `node`.

It grows over time: as the framework gains capabilities, useful prompts for driving them get added here too, each dated so you can tell what's current. Always Markdown, one prompt per entry, following a fixed template so entries stay easy to scan and diff.

---

## What you get

```text
AGENTS.md                         rules for all agents (tool-agnostic, ~130 lines, always loaded)
AGENT_TEAM.md                     how agents create and coordinate other agents
CLAUDE.md                         imports AGENTS.md for Claude Code
VERSION                           0.0.1
CHANGELOG.md                      Keep a Changelog, starts with [Unreleased]
PROMPTS.md                        library of prompts for bootstrapping/working via an agent instead of the CLI

scripts/gate.sh                   one command: format, lint, types, tests, agent team, version gate
scripts/agent-team.sh             create agents, worktrees, PRs; classify and check
scripts/ai-log.mjs                record one execution (Node, cross-platform)
scripts/ai-report.mjs             aggregate the log into ai-dash/data.json
scripts/adr.mjs                   create/list/link Architecture Decision Records (Node, cross-platform)

ai-dash/                          static monitoring page, deployable to Vercel with zero config
docs/tasks.md                     fixed task taxonomy used by the log
docs/model-prices.json            you fill this in — cost stays blank until you do
docs/agents/                      one committed file per agent (dev-api-tester.md, ...)
docs/guides/                      loaded on demand: security, efficiency, delegation
docs/repo-map.md, decisions.md    agent cache, committed
docs/adr/                         Architecture Decision Records — template.md + 0001-..., 0002-..., ...

.claude/skills/semver-release/    release workflow: bump.sh + check-version.sh
.claude/skills/photo-generation/  photorealistic images via OpenAI image generation

.agents/                          local runtime state (git-ignored): worktrees, locks, raw log
.agents/README.md                 what actually lives here, and why it's separate from docs/agents/
.github/workflows/gate.yml        CI: runs the gate on every push/PR
```

`AGENTS.md` stays short on purpose — it's loaded into **every** session. Everything else is read only when the task actually touches it, which is the whole point of the layered-context design (see `docs/guides/efficiency.md`).

**Two folders both mention agents and are easy to confuse:**

| | `docs/agents/` | `.agents/` |
|---|---|---|
| Committed? | Yes | No (git-ignored, except `README.md`) |
| Holds | Each agent's identity — name, scope, rules | Runtime state — worktrees, locks, the raw execution log, local gate overrides |
| Changes when | You create/edit an agent | Any agent runs, syncs, or logs |

---

## How it works

### The gate

`scripts/gate.sh` is the single entrypoint every agent runs instead of reasoning about whether the code is correct:

```
format → lint → types → test → agent-team check → version gate
```

Each step auto-detects your stack and is skipped (not failed) if nothing matches. A failing gate blocks the commit — agents fix the cause, never the gate itself. Add `--release` before tagging to also enforce the changelog/tag rules.

### The agent team

Main has autonomy to spawn sub-agents for genuinely parallel work, and sub-agents can spawn their own — up to a depth of 3, four concurrent per project, three per parent. **Every agent works in its own git worktree, never the shared tree**, and finishes with a PR that Main reviews:

```bash
bash scripts/agent-team.sh new dev-api-tester "Writes contract tests for the orders API" "tests/api/**,src/orders/**"
bash scripts/agent-team.sh start dev-api-tester    # branch + worktree
#   ... agent works in .agents/worktrees/dev-api-tester ...
bash scripts/agent-team.sh finish dev-api-tester   # rebase, gate, push, open PR
bash scripts/agent-team.sh cleanup dev-api-tester  # after merge
```

No agent merges its own work. A PR is classified `mechanical` (docs/tests/formatting only, no sensitive path, under 400 lines) or `administrator` by the script — never by an agent's own judgement — and only Main may merge, and only when `main_merge: true`. Full charter, spawn limits and the sensitive-path list: `AGENT_TEAM.md`.

### Releases (SemVer)

`VERSION` is the single source of truth, SemVer 2.0.0, no `v` prefix. Agents never touch it — they report `version-impact: none|patch|minor|major` and a one-line changelog entry to Main, who runs the **`semver-release`** skill to bump, promote `[Unreleased]`, validate and tag. See the bump table in `AGENTS.md` section 3.

### Architecture Decision Records (ADRs)

A change that affects the overall architecture — a new external dependency, a changed data model, a new service or integration boundary, a changed deployment model — gets an ADR (`AGENTS.md` section 2 requires it). One Markdown file per decision in `docs/adr/`, numbered sequentially, following [Michael Nygard's template](docs/adr/template.md) and the conventions of [npryce/adr-tools](https://github.com/npryce/adr-tools) — reimplemented here as `scripts/adr.mjs` (Node, no dependency on that project or on bash):

```bash
node scripts/adr.mjs new "Use Postgres for the orders service"
node scripts/adr.mjs new "Switch to event sourcing" --supersedes 0003   # cross-links both files
node scripts/adr.mjs list
node scripts/adr.mjs toc --write   # writes docs/adr/README.md
```

Superseding never deletes a decision — the old ADR is marked `Superseded by` and links forward, the new one links back, so the record of *why* stays intact.

### Monitoring dashboard

`scripts/gate.sh` logs every run itself — no manual step, and it can never affect the gate's own pass/fail result:

```
gate runs  →  appends to .agents/log/executions.jsonl  →  refreshes ai-dash/data.json
```

Set `AILOG_*` environment variables before the gate for richer entries (task type, agent, model, token counts) instead of a bare pass/fail:

```bash
AILOG_TASK_TYPE=fix-bug AILOG_AGENT=dev-api-tester AILOG_MODEL=claude-opus-5 \
AILOG_TOKENS_IN=18420 AILOG_TOKENS_OUT=2310 AILOG_CACHE_READ=15200 \
  bash scripts/gate.sh
```

Both the log and `ai-dash/data.json` resolve to the repo's **shared git root**, not the current directory — every worktree writes to the same files, so parallel agents never fragment the data.

`ai-dash/` (named to avoid colliding with a project's own `dashboard/` folder) is a dependency-free static page (no build, no framework) showing tokens, cache reuse, gate first-pass rate, cost, and per-agent/per-task activity, light and dark. Deploy it on Vercel with **Root Directory** set to `ai-dash` — nothing else to configure.

**The aggregate holds counts only** — no prompts, no file paths, no source content — and task names come from the fixed taxonomy in `docs/tasks.md` for exactly that reason, since a Vercel deployment is public by default. Turn on Deployment Protection before the first deploy if the project is client work; details in `ai-dash/README.md`. Cost stays blank until you fill in `docs/model-prices.json` yourself — a stale price is worse than none.

### Skills

Two skills are vendored in the template and travel with every project (`.claude/skills/`, committed):

| Skill | Does |
|---|---|
| `semver-release` | Decides the bump, updates `VERSION` and manifests, promotes `[Unreleased]`, validates, prepares the tag |
| `photo-generation` | Routes photorealistic images to OpenAI; non-photographic assets (icons, diagrams, UI, charts) stay with Claude |

Account-level and plugin skills are **referenced, not copied** — vendoring them would duplicate files that already load automatically. `AGENTS.md` section 6 tells agents when to reach for `dataviz` (charts), `frontend-design` (UI), `skill-creator` (capturing a repeated procedure) and `deep-research`; if one isn't installed, the agent just works without it. Project-specific skills you write later belong in the project's own `.claude/skills/`; promote one to the starter only when it applies to every project.

---

## Command reference

| Task | Command |
|---|---|
| Verify everything | `bash scripts/gate.sh` |
| Verify + release-mode checks | `bash scripts/gate.sh --release` |
| See the agent team | `bash scripts/agent-team.sh list` |
| Create a new agent | `bash scripts/agent-team.sh new <name> "<description>" "<owned paths>"` |
| Start an agent in its worktree | `bash scripts/agent-team.sh start <name>` |
| Sync an agent's branch onto `main` | `bash scripts/agent-team.sh sync <name>` |
| Classify a branch's diff | `bash scripts/agent-team.sh classify <name>` |
| Gate it and open its PR | `bash scripts/agent-team.sh finish <name>` |
| Remove a finished agent's worktree | `bash scripts/agent-team.sh cleanup <name>` |
| Declare intent on paths | `bash scripts/agent-team.sh claim <name> "<paths>"` |
| Release a claim | `bash scripts/agent-team.sh release <name>` |
| Validate every agent file | `bash scripts/agent-team.sh check` |
| Log one execution manually | `node scripts/ai-log.mjs --task-type <type> ...` |
| Refresh the dashboard manually | `node scripts/ai-report.mjs` |
| Create an ADR | `node scripts/adr.mjs new "<title>"` |
| Supersede an ADR | `node scripts/adr.mjs new "<title>" --supersedes <NNNN>` |
| List all ADRs | `node scripts/adr.mjs list` |
| Regenerate the ADR index | `node scripts/adr.mjs toc --write` |
| See release state | `bash .claude/skills/semver-release/scripts/bump.sh status` |
| Cut a release | ask Claude to run the `semver-release` skill |
| Generate a photo | ask Claude — it uses the `photo-generation` skill |

## Configuration

All of it lives in two committed files — nothing is hidden in code:

**`AGENTS.md` §0 — project knobs**

| Knob | Meaning |
|---|---|
| Test coverage floor | Minimum coverage agents must hold the line at |
| Max file / function lines | Size limits that trigger a split |
| Mutation allowed in hot paths | Whether measured local mutation is acceptable |
| Branch model | e.g. trunk (`main`) |
| Release cadence | e.g. on demand |

**`AGENT_TEAM.md` — team behavior**

| Setting | Values | Meaning |
|---|---|---|
| `auto_agents` | `true` / `false` / `disabled` / `ask` | May any agent spawn sub-agents without approval? |
| `main_merge` | `true` / `false` / `ask` | May Main merge PRs the script classifies as `mechanical`? |

Both default to `ask` — Main asks once, at the start of the first plan, and records the answer.

Local, per-machine overrides for the gate itself go in `.agents/gate.conf` (copy from `.agents/gate.conf.example`); this file is git-ignored on purpose.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `AILOG_TASK_TYPE`, `AILOG_AGENT`, `AILOG_MODEL`, `AILOG_SIZE` | `ai-log.mjs` (via `gate.sh`) | Identify the execution being logged |
| `AILOG_TOKENS_IN`, `AILOG_TOKENS_OUT`, `AILOG_CACHE_READ`, `AILOG_CACHE_WRITE`, `AILOG_TOOL_CALLS`, `AILOG_DURATION` | `ai-log.mjs` | Usage numbers for the dashboard |
| `AILOG_PR`, `AILOG_OUTCOME` | `ai-log.mjs` | PR classification / final outcome, once known |
| `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` | `photo-generation` skill | Generate photorealistic images directly. Without them the skill prepares a request file for you to run manually in ChatGPT |

A flag always overrides its `AILOG_*` env var when both are given to `ai-log.mjs` directly. `AILOG_GATE` and `AILOG_GATE_FIRST_TRY` are set by `gate.sh` itself and shouldn't be overridden by hand.

## Troubleshooting

**`bash: command not found` / WSL errors on Windows.** The `.sh` scripts (`init-project.sh`, `agent-team.sh`, `semver-release`'s `bump.sh`/`check-version.sh`) need a real `bash` — Git Bash or a working WSL install. If yours is broken, run the Node scripts directly (`node scripts/ai-log.mjs`, `node scripts/ai-report.mjs`) and use plain `git` from PowerShell, which works natively; ask Claude to run the bash-dependent steps for you and push the result.

**Gate step marked "skip: ... (not configured)".** Expected when your stack doesn't match the auto-detected npm/Deno/pyproject/Cargo conventions. Set the command explicitly in `.agents/gate.conf`.

**Dashboard shows no data / "no data yet".** No execution has run through `scripts/gate.sh` in this repo yet — run it once, or `node scripts/ai-report.mjs` after `node scripts/ai-log.mjs` has appended at least one line.

**Dashboard cost column is blank.** By design — fill in real numbers in `docs/model-prices.json` first; the starter never ships example prices, since a stale price is worse than none.

**A tag was pushed before `main` was up to date.** Delete and recreate it: `git push origin :refs/tags/vX.Y.Z && git tag -d vX.Y.Z`, then `git fetch origin && git reset --hard origin/main`, retag, and push.

## Repo layout (this repo itself)

- `template/` — everything copied into new projects. **Edit here**, never in a generated project.
- `init-project.sh` — the bash bootstrap script.
- `cli/` — the Node CLI (`init`/`update`/`adopt`/`doctor`); wraps `template/`, doesn't replace it. See [The CLI](#the-cli) and [`cli/README.md`](cli/README.md).
- `VERSION` / `CHANGELOG.md` at the repo root — the **starter's own** version, independent of any project it creates (which always starts at `0.0.1`).
