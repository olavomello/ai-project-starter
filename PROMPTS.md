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
   unless I tell you to pin a specific tag) into a temporary location, and copy
   its `template/` directory into a new directory named <project-directory>
   (ask me for this name if I haven't given it to you).
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
3. Write my answers into section 0 of the new project's `AGENTS.md` (the `- Name:`
   / `- Purpose (one line):` / `- Stack:` / `- Administrator:` lines, and the
   `Knobs` table below them) — do not touch anything else in the file.
4. Run `git init`, stage everything, and make the first commit with a message
   like "chore: initialize project from ai-project-starter (agent-guided)".
   Do not mention any AI assistant or tool name anywhere in that commit message
   or in any file you write — this is a hard rule of the starter itself
   (see AGENTS.md section 2 once it exists in the new project).
5. Run `scripts/gate.sh` inside the new project and report the result. If it's
   not executable yet, make it so first.
6. Tell me the next manual steps: adding a git remote and pushing, and reading
   through the rest of AGENTS.md.

If git isn't available, skip step 4 and tell me so — copy the files and let me
init the repo myself.
```
