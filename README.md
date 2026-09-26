# ai-project-starter

Base for every new project: agent rules, Claude Code skills, and a single verification gate.
Primary target is Claude Code; also usable by Codex and other agents through `AGENTS.md`.

---

## Quick start

### 1. Create the project

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/olavomello/ai-project-starter/main/init-project.sh) my-project
cd my-project
```

The script copies the template, runs `git init`, makes the first commit, and runs the gate.
To pin a starter release instead of `main`, pass a tag as the second argument:

```bash
bash <(curl -fsSL .../init-project.sh) my-project v0.1.0
```

If the starter repo is private, the `curl` form won't authenticate — clone it and run `bash ai-project-starter/init-project.sh my-project` instead.

### 2. Fill in section 0 of `AGENTS.md`

Name, purpose, stack, administrator, and the knobs (coverage floor, file-size limits, branch model). Agents read these instead of assuming defaults, so a wrong value here becomes a wrong rule everywhere.

### 3. Point the gate at your stack

```bash
bash scripts/gate.sh
```

It auto-detects npm, Deno, pyproject and Cargo. Steps it can't detect are skipped, not failed. To correct or disable a step:

```bash
cp .agents/gate.conf.example .agents/gate.conf
# LINT="npm run lint"
# TYPES="skip"
```

`scripts/gate.sh` is the only verification command agents should run. Add your stack's setup steps to `.github/workflows/gate.yml` before the gate step.

### 4. Add the remote and push

```bash
git remote add origin git@github.com:<you>/my-project.git
git push -u origin main
```

### 5. Work

Open the project in Claude Code. `CLAUDE.md` imports `AGENTS.md`, so every session starts with the rules and the vendored skills in `.claude/skills/`.

Day-to-day commands:

| Task | Command |
|---|---|
| Verify everything | `bash scripts/gate.sh` |
| See release state | `bash .claude/skills/semver-release/scripts/bump.sh status` |
| Cut a release | ask Claude to run the `semver-release` skill |
| Generate a photo | ask Claude — it uses the `photo-generation` skill |

Agents never bump `VERSION` or create tags on their own; they report a `version-impact` line and you decide.

---

## What a new project gets

```
AGENTS.md                         rules for all agents (tool-agnostic, ~110 lines)
CLAUDE.md                         imports AGENTS.md for Claude Code
VERSION                           0.0.1
CHANGELOG.md                      Keep a Changelog, starts with [Unreleased]
scripts/gate.sh                   one command: format, lint, types, tests, version gate
.claude/skills/semver-release/    release workflow + bump.sh + check-version.sh
.claude/skills/photo-generation/  photos via OpenAI image generation
docs/agents/                      loaded on demand: security, efficiency, delegation, repo-map, decisions
.agents/                          local agent state (git-ignored), gate overrides, media requests
.github/workflows/gate.yml
```

`AGENTS.md` stays short on purpose — it is loaded into every session. Everything else is read only when the task touches it.

## Skills

Two skills are vendored in the template and travel with every project:

- **`semver-release`** — decides the bump, updates `VERSION` and manifests, promotes `[Unreleased]`, validates, prepares the tag.
- **`photo-generation`** — routes photorealistic images to OpenAI; non-photographic assets stay with Claude.

Account-level and plugin skills are **referenced, not copied** — vendoring them would duplicate files that already load automatically and go stale on their own schedule. `AGENTS.md` section 6 tells agents when to reach for `dataviz` (charts), `frontend-design` (UI), `skill-creator` (capturing a repeated procedure) and `deep-research`. If one isn't installed, the agent just works without it.

Project-specific skills you create later belong in the project's own `.claude/skills/` and are committed with it. Promote one to the template only when it applies to every project.

## Repo layout

- `template/` — everything copied into new projects. Edit here, not in a generated project.
- `init-project.sh` — bootstrap script.
- `VERSION` / `CHANGELOG.md` — the starter's own version, independent from projects (which always start at `0.0.1`).

## Environment

`photo-generation` needs `OPENAI_API_KEY` and `OPENAI_IMAGE_MODEL` (model name per current OpenAI docs). Without them, the skill prepares the request file for you to run manually in ChatGPT.
