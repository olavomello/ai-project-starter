# starter-hud

Optional Claude Code mod for projects built on [ai-project-starter](../../README.md). Off by default.

## Changing the mod: bump its version

Claude Code caches an installed plugin by the `version` in `.claude-plugin/plugin.json` and decides whether `claude plugin update` has anything to fetch by comparing versions. A mod change that keeps the same version is never delivered: installed copies keep running the old code and `update` reports "already latest". Bump `version` (SemVer, 0.x while the mod is young) in every commit that changes the mod's code (`hooks/`, `plugin.json`); a README-only change does not need one.

## What it does

1. **Measures real usage.** Hooks `turn.step` to read the model's actual token usage
   (uncached input, cache read, cache write, output) and `tool.call` to count tool
   calls, instead of relying on an agent to export `AILOG_*` variables by hand.
2. **Shows it in-session.** Draws one row above the prompt, an icon before each item:
   `⎇ main · ◆ tokens 92.4k / 120k · ↻ cache 92% · ✓ gate passed, first try · ▣ task M · ◎ agents 2/4`
   (branch or agent, fresh tokens against the budget if one is set, cache ratio, last gate
   result, task size, live agent count), and appends a tool-call count to the spinner.
   Item order is also priority: on a narrow screen (over 100 characters) the last ones
   drop first, never the branch or tokens. Tokens turn yellow at 80% of the budget and
   red at the ceiling; the gate icon is green for a pass and red for a failure.
   At the far right of the row, an **▦ AI Dash** button: it checks whether this project's
   dashboard answers on `127.0.0.1:4173`, starts `node scripts/ai-dash.mjs` if not, then
   opens it in your default browser (Windows, macOS and Linux). The server it starts lives
   with the session and stops when the session or the mod ends; for one that outlives the
   session, run `node scripts/ai-dash.mjs` yourself and the button just opens it. It only
   recognises the project's own dashboard (by its `/api/config` answer), not another
   program on that port.
   Next to it, an **↑ Update available** button appears when the starter's `main` is newer than
   the commit this project was last synced with (`scripts/ais-update.mjs check` compares
   `starterRef` in `.ai-project-starter.json` with `git ls-remote`, at most every 30 minutes, on
   session start and after turns). Clicking it runs `scripts/ais-update.mjs apply`: the CLI's
   `update` through `npx`, then `claude plugin update starter-hud@ai-project-starter`. If the
   dashboard was running it is stopped (`POST /api/shutdown`, local only) and started again on the
   new code, then the check runs again and the button goes away. Commit the changed files
   afterwards; a new mod version loads in the next session.
3. **Hands it to the log pipeline.** After each model request, tool call, and turn, it
   merges the delta into `.agents/state/usage/<branch>.json` (one file per session branch; the next gate run on *any* branch consumes all of them). `scripts/ai-log.mjs`
   reads that file (see its precedence rules), and deletes it once logged.

It never makes a model call, a network request, or submits a prompt, and never
touches credits, usage limits, billing or plan settings.

## What it reads and writes

| Path | Why |
|---|---|
| `AGENTS.md` (project root) | the "Task token budget S / M / L" knob |
| `scripts/gate.sh` | existence check — if missing, the mod goes inert |
| `.agents/state/usage/<branch>.json` | where measured usage is handed to `ai-log.mjs` |
| `.agents/state/gate-attempts/<branch>` | read-only — the last gate result, for the band |
| `.agents/worktrees/` | read-only — counted for the `agents N/4` line |

Nothing here is prompt text, file content, or anything beyond counts and a model name —
the same privacy guarantee the rest of the logging pipeline makes (see `docs/tasks.md`).

## Requirements

Claude Code v2.1.287 or later. The band and spinner suffix draw only in the terminal
and the Desktop Code tab; the measuring hooks (and the usage file) still run under the
VS Code panel, `claude -p` and the Agent SDK, since those don't depend on drawing.
Outside a git repo with `scripts/gate.sh`, or on an older Claude Code, the mod loads
inert: every hook is a no-op pass-through, and nothing is drawn.

## Turning it on or off

Three equivalent ways, all backed by `scripts/mod.mjs` in the project (see its own
`--help` and the root `README.md`'s Configuration section):

- during `ai-project-starter init`'s guided setup (`--mod` / `--no-mod` flags, or the prompt);
- any time with `node scripts/mod.mjs enable` / `disable`;
- from the ai-dash Settings area, when served locally (`node scripts/ai-dash.mjs`).

All three write the same key, `.claude/settings.json`'s
`enabledPlugins["starter-hud@ai-project-starter"]`. Enabling it in settings does **not**
download it: each person installs it once on their machine with `claude plugin marketplace add olavomello/ai-project-starter#main` and `claude plugin install starter-hud@ai-project-starter --scope project` (or, in the Claude desktop app, **+ > Plugins > Add plugin**). Then run `/reload-plugins` or restart the session, and commit the settings file so the rest of the team gets the setting too.

## `/budget`

`/budget S|M|L|off` sets the current task's size and resets its counters. `/budget`
alone prints the current size and usage. The ceiling for each size comes from the
"Task token budget S / M / L" knob in `AGENTS.md` section 0 (default `off` — no
ceiling, no warnings, usage is still tracked). At 80% of the ceiling you get one toast;
at 100% you're asked once whether to continue, and `Stop` aborts the turn. The budget is
advisory: if asking isn't possible (a non-interactive run, the question dismissed), a
dim transcript line is logged instead and the turn continues — it never blocks
unattended work.

## Known limitations

- **`ai-project-starter update` sees a customized `.claude/settings.json`.** The first time the mod
  is toggled, the file differs from the template's, so `update` treats it as
  project-specific from then on (same as any other hand-edited file) — see
  `cli/README.md`.
- **Dashboard shows 0 tokens, no cache reads, no cost.** The mod never wrote `.agents/state/usage/`, so the gate had nothing to log. Two things can cause it. (1) The plugin was never installed on this machine: `claude plugin list` has no `starter-hud`. Install it with `claude plugin marketplace add olavomello/ai-project-starter#main` and `claude plugin install starter-hud@ai-project-starter --scope project` (or, in the Claude desktop app, **+ > Plugins > Add plugin**). (2) The marketplace `ref` in `.claude/settings.json` is a tag that predates the mod (`v0.1.0` and older have no `mods/` folder): `ai-project-starter update` moves it to `main`, or run `node scripts/mod.mjs enable --ref main`. Then restart the Claude Code session (or `/reload-plugins`). Once a session has run, `.agents/state/usage/<branch>.json` appears and the next gate run consumes it.
- **Subagent usage is attributed to the parent session's branch.** A subagent that
  works in its own worktree still has its usage merged into the branch the *session*
  is running on, not the subagent's own worktree.
- **The usage file write is not atomic.** Two sessions running on the same branch at
  the same time can lose one side's update to `$.fs.write`. For the intended case —
  one agent, one branch, one worktree — this doesn't come up.
