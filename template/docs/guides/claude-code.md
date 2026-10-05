# Claude Code specifics

Read when touching how Claude Code loads instructions, memory, skills, rules,
settings, or MCP servers in this repo. Everything here is Claude Code–only; the
tool-agnostic rules stay in `AGENTS.md`.

## How instructions load

`CLAUDE.md` contains one line: `@AGENTS.md`. Keep it that way.

Claude Code can read `AGENTS.md` on its own, but **only when no `CLAUDE.md` or
`CLAUDE.local.md` exists** in the working directory or above it. The import makes
loading independent of that rule, of the Claude Code version, and of the "Project
instructions" setting — and Claude Code never loads the same `AGENTS.md` twice, so
the import costs nothing.

- **Don't delete `CLAUDE.md`.** Without it, one personal `CLAUDE.local.md` would
  silently stop `AGENTS.md` from loading for that person.
- **Don't replace it with a symlink** to `AGENTS.md`. Git checks symlinks out as
  plain text on Windows without `core.symlinks`, leaving a one-line file instead of
  the rules.
- **Claude-only instructions** go below the import in `CLAUDE.md`, never in
  `AGENTS.md`. Keep them rare — anything Codex also needs belongs in `AGENTS.md`.
- **Personal, per-project instructions** go in `CLAUDE.local.md` (git-ignored).
  Safe here because of the import.

Check what loaded: run `/context` and look under **Memory files**.

## Two kinds of memory — don't confuse them

| | Auto memory | Project memory |
|---|---|---|
| Files | Outside the repo, in the user's Claude Code config directory | `docs/repo-map.md`, `docs/decisions.md`, `docs/adr/`, `.agents/state/` |
| Written by | Claude Code itself, automatically | Agents and people, on purpose |
| Shared | No — one machine, one user | Yes — committed, reviewed in PRs |
| Read by | Claude Code only | Every agent (Claude Code, Codex, …) and every person |
| Survives a new machine, clone, container or CI run | No | Yes |

Auto memory is on by default and needs nothing from this template. It's a personal
convenience, never a source of truth.

**Rule:** if something learned in a session matters to the team or to another
agent, record it in `docs/decisions.md` (or an ADR, if it's architectural). "Claude
remembers it" doesn't count — nobody else can see it. When auto memory and the
repo disagree, the repo wins.

## Skills, not commands

Custom commands in `.claude/commands/` were merged into skills and are the legacy
format. A skill at `.claude/skills/<name>/SKILL.md` gives the same `/<name>`
command plus supporting files, frontmatter, and loading on demand.

- New procedures are skills, in `.claude/skills/`, committed. This repo has no
  `.claude/commands/` — don't add one.
- Side-effecting procedures (release, deploy) set `disable-model-invocation: true`
  in the skill's frontmatter so only a person triggers them with `/<name>`, never
  Claude on its own judgment. `semver-release` should carry this flag once it's
  invokable as a slash command — check before assuming it already does.
- **Every skill's frontmatter must be valid YAML and complete** — `node scripts/skills.mjs check`
  enforces it (the gate and `cli doctor` run it). Required: `name` (lowercase letters,
  digits, single hyphens; equals the folder name; ≤64 chars) and `description` (≤1024
  chars) saying what the skill does **and when to use it** ("Use when…"). The classic
  breakage is an unquoted `: ` or ` #` in the description — quote it or use `>`.
  Optional fields such as `disable-model-invocation` stay as they are. View them all
  with `node scripts/skills.mjs list` or the ai-dash Skills viewer.
- Create skills with `node scripts/skills.mjs new <name> "<description>"`: it stamps
  `creation-date` and `created-by` (both optional in the format, checked when present)
  and writes the description quoted, so it can't break the YAML. "Last usage" is not
  stored in the file — a `PostToolUse` hook (`.claude/hooks/log-skill-use.sh`) records
  each use in the local, git-ignored `.agents/log/usage.jsonl`, and `list` and the
  ai-dash viewer read it from there. (The hook relies on `jq`, like the other hooks.)
- List each vendored skill in `AGENTS.md` section 6 so non-Claude agents know to
  read its `SKILL.md`.

## Path-scoped rules (`.claude/rules/`)

Claude Code loads every `.md` file under `.claude/rules/` into context — at launch
if it has no `paths:` frontmatter, or only when a matching file is opened if it
does:

```markdown
---
paths:
  - "src/api/**/*.ts"
---
- Every handler validates input with the shared schema.
```

Two things make this directory easy to misuse:

- **Every `.md` file loads, no exceptions.** A stray `README.md` dropped in here
  would be injected into every session as if it were a rule. Don't put anything
  in `.claude/rules/` that isn't meant to load as context.
- **Rules are invisible to Codex and other agents.** A rule that matters to
  everyone, not just Claude Code, has to also exist somewhere non-Claude agents
  read — `AGENTS.md`, a guide it points to, or both.

This repo ships exactly one rule, `.claude/rules/security.md` ([ADR 0002](../adr/0002-enforce-project-rules-with-claude-code-hooks-instead-of-convention-only-text.md)):
it doesn't duplicate the security checklist, it just guarantees
`docs/guides/security.md` loads the moment a security-sensitive path is touched,
instead of depending on the agent remembering to go read it — and `AGENTS.md`
section 2 still points at the same guide in words, so Codex and other agents get
the same guarantee by a different mechanism. Add another rule only when it clears
both bars above: narrow paths, and fine to be Claude-only (or backed by an
equivalent pointer elsewhere).

## Settings, hooks, and MCP

| File | Committed | Use |
|---|---|---|
| `.claude/settings.json` | Yes | Team-shared permissions, hooks, env — see below |
| `.claude/settings.local.json` | No (git-ignored) | Personal overrides |
| `.mcp.json.example` | Yes | Scaffolding only — copy to `.mcp.json` when a project needs an MCP server |
| `.mcp.json` | Yes, once created | Real, team-shared MCP servers |

Anything that must happen every time — block a command, enforce a rule regardless
of model or permission mode — is a hook in `.claude/settings.json`, not an
instruction in `AGENTS.md`. Instructions are context the model can still get
wrong; hooks run as deterministic shell checks that don't depend on the model
deciding to comply. This repo's two hooks (`.claude/hooks/`, enforcing the
`VERSION`/`CHANGELOG` and force-push rules from `AGENTS.md`) and the reasoning for
picking hooks over convention are in
[ADR 0002](../adr/0002-enforce-project-rules-with-claude-code-hooks-instead-of-convention-only-text.md).

`.mcp.json` doesn't exist in this template because the starter itself depends on
no MCP server. `.mcp.json.example` is the committed scaffold — copy it, fill in
real servers, and commit the result when a project built on this starter needs
one; everyone who clones the repo then gets a one-time approval prompt for it.

## Session mod (optional)

A **mod** is a plugin whose JavaScript hooks run inside Claude Code. This starter
publishes one, `starter-hud`, at `mods/starter-hud/` in the
[ai-project-starter repo itself](https://github.com/olavomello/ai-project-starter)
(not copied into `template/` — a project built from this starter loads it from
there as a plugin, it doesn't vendor its code).

**What it shows and measures:** a 1-3 line band above the prompt — agent, task
size, fresh tokens against the "Task token budget" knob (section 0) if one is
set, cache ratio, the last gate result, live agent count — plus a tool-call
count appended to the spinner. It measures real per-turn token and tool-call
usage and hands it to `scripts/ai-log.mjs` through a per-branch file, so the log
stops depending on an agent remembering to export `AILOG_*` variables.

**Turning it on or off is an Administrator decision**, same as `auto_agents` and
`main_merge` in `AGENT_TEAM.md` — not something an agent enables on its own
initiative. Three equivalent ways, all backed by the single implementation in
`scripts/mod.mjs`:

- `cli init`'s guided setup (or its `--mod`/`--no-mod` flags);
- any time afterwards: `node scripts/mod.mjs enable` / `disable`, or
  `ai-project-starter mod enable` / `disable` through the CLI;
- the **Settings** area (gear icon) in `ai-dash`, when it's served locally with
  `node scripts/ai-dash.mjs` — read-only on static hosting.

All three write the same key: `.claude/settings.json`'s
`enabledPlugins["starter-hud@ai-project-starter"]`. Commit that file so the rest
of the team gets the same setting, and run `/reload-plugins` (or restart the
session) after toggling it.

**Where it runs and where it doesn't:** the band and spinner suffix draw only in
the terminal and the Desktop Code tab — the measuring hooks and the usage file
still run under the VS Code panel and `claude -p`, since those don't depend on
drawing. It never loads in a cloud session (cloud sessions don't add
marketplaces declared in a repo's settings) or in any non-Claude-Code agent
(Codex and the rest). Off, missing, or on an older Claude Code (before
v2.1.287), the mod is inert and everything behaves exactly as it does today:
`ai-log.mjs` falls back to `AILOG_*` variables, same as always. Full detail,
including its known limitations: `mods/starter-hud/README.md` at the repo root.
