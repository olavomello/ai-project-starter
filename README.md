# ai-project-starter

Base for every new project: agent rules, Claude Code skills, and the version gate.
Primary target is Claude Code; also usable by Codex and other agents via `AGENTS.md`.

## New project

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/olavomello/ai-project-starter/main/init-project.sh) my-project
```

Pin a starter release instead of `main`:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/olavomello/ai-project-starter/main/init-project.sh) my-project v0.0.1
```

Then fill in section 0 of `AGENTS.md` and add the remote.

## What a new project gets

```
AGENTS.md                         rules for all agents (tool-agnostic)
CLAUDE.md                         imports AGENTS.md for Claude Code
VERSION                           0.0.1
CHANGELOG.md                      Keep a Changelog, starts with [Unreleased]
.claude/skills/semver-release/    release workflow + bump.sh + check-version.sh
.claude/skills/photo-generation/  photos via OpenAI image generation
docs/agents/                      committed agent cache: repo-map, decisions
.agents/                          local agent state (git-ignored) and media requests
.github/workflows/version-gate.yml
```

## Repo layout

- `template/` — everything copied into new projects. Edit here.
- `init-project.sh` — bootstrap script.
- `VERSION` / `CHANGELOG.md` — version of the starter itself (independent from projects, which always start at `0.0.1`).

## Environment (photo-generation)

`OPENAI_API_KEY` and `OPENAI_IMAGE_MODEL` (model name per current OpenAI docs). Without them, the skill prepares the request for manual use in ChatGPT.
