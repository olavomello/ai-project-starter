# {{NAME}}

> {{PURPOSE}}

**Stack:** {{STACK}}

<!-- The three {{...}} placeholders above are filled by `ai-project-starter init`. If you see them, fill them in by hand (and in AGENTS.md section 0). -->

## Contents

- [Getting started](#getting-started)
- [Verify your work](#verify-your-work)
- [Project layout](#project-layout)
- [How we work](#how-we-work)
- [Monitoring](#monitoring)
- [Contributing](#contributing)
- [License](#license)

## Getting started

**Prerequisites:** `git` and `node` 18 or newer. Shell scripts (`scripts/*.sh`) need `bash`; on Windows use **Git Bash** (the `bash` on PATH in PowerShell is the WSL stub and fails with `execvpe(/bin/bash) failed`).

```bash
git clone <your-repo-url>
cd <your-repo>
```

Add your stack's install and run steps here, then mirror them in `.github/workflows/gate.yml` so CI runs the same thing.

| Task | Command |
|---|---|
| Install | _fill in_ |
| Run locally | _fill in_ |
| Build | _fill in_ |

## Verify your work

`scripts/gate.sh` is the single verification command: format, lint, types, tests and the version gate in one run. Humans and agents both run it before every commit.

```bash
bash scripts/gate.sh             # everything
bash scripts/gate.sh --release   # plus release-mode checks
```

## Project layout

| Path | What it is |
|---|---|
| `AGENTS.md` | Binding rules for every agent. Section 0 holds this project's name, purpose, stack and knobs |
| `CLAUDE.md` | One line importing `AGENTS.md` for Claude Code |
| `AGENT_TEAM.md` | How agents create and coordinate other agents |
| `docs/` | Task taxonomy, ADRs (`docs/adr/`), agent definitions (`docs/agents/`), guides (`docs/guides/`) |
| `scripts/` | The gate, agent-team tooling, the execution log and report, ADR and skill helpers |
| `ai-dash/` | Static monitoring dashboard for agents, tokens and work done |
| `.claude/` | Claude Code settings, hooks and skills |
| `.github/workflows/` | CI that runs the gate |
| `VERSION`, `CHANGELOG.md` | SemVer source of truth and the Keep a Changelog history |

## How we work

- **Rules first.** Agents read `AGENTS.md` and only open `docs/agents/*` and `docs/guides/*` when the task touches that area.
- **One verification path.** Nothing is "done" until `scripts/gate.sh` passes.
- **Decisions are written down.** Architectural changes get an ADR: `node scripts/adr.mjs new "<title>"` (see `docs/adr/`).
- **Versioning is SemVer.** `VERSION` and release entries in `CHANGELOG.md` are owned by the main agent and the administrator; record user-visible changes under `[Unreleased]`.
- **Agents work in isolation.** Parallel agents claim disjoint files or use their own worktree (`bash scripts/agent-team.sh list`).

## Monitoring

Every gate run is logged locally and aggregated for the dashboard:

```bash
node scripts/ai-dash.mjs   # serves ai-dash/ on 127.0.0.1, with a Settings area
```

`ai-dash/` is also a plain static site, so it can be deployed (for example on Vercel) as an internal monitoring page. See `ai-dash/README.md`.

## Contributing

1. Branch from `main` following the branch model in `AGENTS.md` section 0.
2. Make a focused change and add or update tests.
3. Run `bash scripts/gate.sh` until it passes.
4. Add a line under `[Unreleased]` in `CHANGELOG.md` for anything user-visible.
5. Open a pull request.

## License

_Choose a license and state it here (or add a `LICENSE` file)._

---

<p align="center"><sub>Powered by <a href="https://github.com/olavomello/ai-project-starter"><strong>AIS</strong></a> — AI Project Starter</sub></p>
