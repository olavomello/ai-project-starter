# 3. Measure real session usage with an optional Claude Code mod

## Status

Accepted

## Context

`scripts/gate.sh` has logged every run automatically since the project started
(`ai-log.mjs` → `ai-dash/data.json`), but the token, cache, model and tool-call
fields in that log depend entirely on an agent exporting `AILOG_*` variables
before the gate runs. An agent has no reliable way to know those numbers on its
own, so in practice most records carry zeros for them — the opposite of this
starter's own rule, "measure, don't assert" (`AGENTS.md` section 4).

Claude Code v2.1.287 added **mods**: plugins whose JavaScript hooks observe,
rewrite or answer the engine's own events (`turn.step`, `tool.call`,
`ui.render`, and others), including the model's real per-request token usage.
That makes it possible to measure the numbers directly instead of asking an
agent to self-report them, and to show them during the session.

## Decision

Add an optional, off-by-default mod, `starter-hud`, that:

1. hooks `turn.step` and `tool.call` to measure real usage (uncached input,
   cache read, cache write, output tokens, tool-call count, duration);
2. hands the measured numbers to the existing log pipeline through a small
   per-branch file (`.agents/state/usage/<branch>.json`), read and deleted by
   `ai-log.mjs`, ahead of `AILOG_*` variables but behind an explicit flag;
3. draws a small band above the prompt (agent, task size and budget, cache
   ratio, last gate result, live agent count) and a tool-call count on the
   spinner.

Specific choices and why:

- **The mod lives once**, at `mods/starter-hud/` in this repo, not copied into
  `template/`. A project built from the starter loads it as a plugin from a
  marketplace this repo publishes (`.claude-plugin/marketplace.json`, a
  relative-path source so it loads without a separate `claude plugin install`
  step), rather than vendoring its code — one place to fix a bug in it.
- **The single source of truth for on/off is the project's own
  `.claude/settings.json`** (`enabledPlugins["starter-hud@ai-project-starter"]`),
  not a separate flag file. That's the file Claude Code itself already reads to
  decide what loads, so there's nothing for this starter's own tooling to keep
  in sync with the engine's.
- **One implementation of the toggle**, `scripts/mod.mjs`, called by both the
  CLI's `mod` command and the `ai-dash` Settings area's local server — never
  two copies of the same settings-file edit.
- **A hand-off file, not a rewritten shell command.** The mod could in
  principle call `ai-log.mjs` itself, but that would mean a plugin running
  commands in the user's project on its own initiative. A plain data file the
  next `gate.sh` run picks up keeps the mod passive and the log pipeline
  exactly as deterministic as it was.
- **Off by default**, and inert (every hook a no-op, nothing drawn) outside a
  git repository with `scripts/gate.sh`, or on an older Claude Code. Nothing in
  the starter depends on it; every existing project keeps working unchanged.
- **The budget it can warn about is advisory only.** It can toast at 80\% and
  ask at 100\% of a task's token ceiling, but never blocks when asking isn't
  possible (a non-interactive run, the question dismissed) — unattended work
  must never stall on a mod that happens to be on.

## Consequences

Projects that enable the mod get real numbers in `ai-dash` instead of mostly
zeros, and a live sense of where a task's budget has gone, without any agent
having to remember `AILOG_*`. Turning it on changes `.claude/settings.json`
from the template's, which means `cli update` treats that file as
project-customized from then on (flagged, never auto-applied) — a cost shared
with any other hand-edited file, documented in `cli/README.md` and
`docs/guides/claude-code.md` rather than solved here.

A session's measured usage is attributed to the branch the *session* runs on;
a subagent working in its own worktree still has its usage merged into the
parent session's branch, not its own. Two sessions running on the same branch
at the same time can lose one side's update to the usage file, since the
mods API's `$.fs.write` isn't documented as atomic — acceptable for the
intended case (one agent, one branch, one worktree at a time) and noted in
`mods/starter-hud/README.md` rather than engineered around.

The sanitizing rule that turns a branch name into a safe filename
(`scripts/gate.sh`, `scripts/ai-log.mjs`, and the mod must all derive the
identical string) is now defined in three places instead of one; a change to
it needs all three updated together. The existing `gate-attempts` files
written under the old (echo-based) sanitizing rule become harmless orphans
after this change — they're git-ignored and never read again.
