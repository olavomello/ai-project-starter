# PROMPTS

A maintained library of prompts for working with projects built on
[ai-project-starter](README.md), for people who'd rather paste a prompt into an
agent than run the CLI (`cli/`, see the root [README](README.md#the-cli)) or the
bash script (`init-project.sh`). Each entry is a complete, self-contained prompt —
paste it into your agent as-is, answer what it asks, and it leaves your project in
the same state the equivalent CLI command would.

This file grows as the framework does: whenever a new capability needs its own
prompt to drive it well, add an entry here, dated so it's clear what's current.
Existing entries get updated in place if the framework changes in a way that makes
them wrong or incomplete — never left to silently drift out of date.

## Bootstrap a new project

Creates a new project from the starter, interactively, the same way `cli init`
does with a real terminal attached: clone the template, ask the section 0
questions, fill in `AGENTS.md`, initialize git, and make the first commit — so the
project is ready to work on, not just copied.

### Date : 2026-09-29 ( data quando ele foi adicionado )

# Prompt

```
I want to start a new project from the ai-project-starter template
(https://github.com/olavomello/ai-project-starter). Do the following:

1. Clone https://github.com/olavomello/ai-project-starter.git (main branch,
   unless I tell you to pin a specific tag or ref) into a temporary location,
   and copy its `template/` directory into a new directory named
   <project-directory> (ask me for this name if I haven't given it to you).
2. Ask me these questions, one at a time, and wait for each answer before asking
   the next. Offer the default in parentheses and accept it if I answer blank:
   - Name (default: the project directory's name)
   - Purpose (one line) (default: blank)
   - Stack (default: blank)
   - Administrator (default: blank)
   - Test coverage floor (default: 80%)
   - Max file lines / function lines (default: 800 / 50)
   - Mutation allowed in hot paths — yes/no (default: no)
   - Branch model (default: trunk (`main`))
   - Release cadence (default: on demand)
   - Task token budget S / M / L (default: off)
   - Enable the in-session status mod for Claude Code? — y/N (default: no)
3. Write my answers into section 0 of the new project's `AGENTS.md` (the `- Name:`
   / `- Purpose (one line):` / `- Stack:` / `- Administrator:` lines, and the
   `Knobs` table below them, now including the task-token-budget row) — do not
   touch anything else in the file.
4. If I answered yes to the mod question, run `node scripts/mod.mjs enable`
   inside the new project before the first commit, so it's included in it.
5. Run `node <path-to-the-clone-from-step-1>/cli/bin.js adopt <project-directory>
   --ref <the branch or tag you cloned>` so the project gets
   `.ai-project-starter.json` — the manifest `ai-project-starter update` needs to
   track it later — before the first commit, so the manifest baseline matches
   what's actually committed. This is the same file the CLI's own `init` writes;
   without it I can't later pull starter improvements with `update`.
6. Run `git init`, stage everything, and make the first commit with a message
   like "chore: initialize project from ai-project-starter (agent-guided)".
   Do not mention any AI assistant or tool name anywhere in that commit message
   or in any file you write — this is a hard rule of the starter itself
   (see AGENTS.md section 2 once it exists in the new project).
7. Run `node <path-to-the-clone-from-step-1>/cli/bin.js doctor <project-directory>`
   and report the result (the same structural check `cli init` runs
   automatically at the end).
8. Run `scripts/gate.sh` inside the new project and report the result. If it's
   not executable yet, make it so first.
9. Tell me the next manual steps: adding a git remote and pushing, and reading
   through the rest of AGENTS.md.

If git isn't available, skip step 6 and tell me so — copy the files and let me
init the repo myself.
```

## Turn the in-session status mod on or off

Toggles the optional `starter-hud` session mod ([ADR](template/docs/adr/0003-measure-real-session-usage-with-an-optional-claude-code-mod.md),
`docs/guides/claude-code.md` once it exists in the project) the same way
`node scripts/mod.mjs enable`/`disable` would, for an agent working in a
project that already exists.

### Date : 2026-10-01

# Prompt

```
Turn the optional starter-hud session mod on (or off — tell me which) for this
project:

1. Confirm `scripts/mod.mjs` exists here. If it doesn't, tell me to run
   `ai-project-starter update` first and stop.
2. Run `node scripts/mod.mjs enable` (or `disable`) — don't edit
   `.claude/settings.json` by hand, that script is the one implementation of
   this toggle, shared with the CLI and the ai-dash Settings area.
3. Show me the resulting `.claude/settings.json` diff.
4. Tell me to run `/reload-plugins` (or restart the session) and to commit the
   settings file so the rest of the team gets the same setting.

Do not mention any AI assistant or tool name anywhere in the commit message if
I ask you to commit this.
```
