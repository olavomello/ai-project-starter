# Changelog

All notable changes to ai-project-starter are documented here.
The format follows Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]

## [0.1.0] - 2026-09-26
### Added
- `scripts/gate.sh`: single verification entrypoint (format, lint, types, tests, agent team, version gate) with stack auto-detection and `.agents/gate.conf` overrides.
- Engineering baseline in AGENTS.md: commit convention, test policy, security summary, scope limits, project knobs.
- Precedence rule placing AGENTS.md above installed plugins.
- `docs/guides/`: security checklist, efficiency detail, delegation rules — loaded on demand.
- AGENTS.md section 6: external skills (`dataviz`, `frontend-design`, `skill-creator`, `deep-research`) referenced rather than vendored; charts routed through `dataviz`.
- `AGENT_TEAM.md`: charter for agents creating agents — `auto_agents` and `main_merge` flags asked at plan time, spawn tests, depth and concurrency limits, naming convention, lifecycle.
- `scripts/agent-team.sh`: `new`, `list`, `start`, `sync`, `classify`, `finish`, `cleanup`, `claim`, `release`, `check`.
- Worktree-first isolation: every agent works in its own git worktree and finishes with a PR; rebase onto `main` and a passing gate are required before push.
- `agent-team.sh classify`: rates a branch `mechanical` or `administrator` from the diff (sensitive-path list, docs/tests-only rule, 400-line cap), so `main_merge` never depends on an agent's judgement.
- `docs/agents/_TEMPLATE.md` and AGENTS.md section 7.
- README: quick-start walkthrough (create, configure, gate, push, work).

### Changed
- AGENTS.md restructured and kept under ~130 lines; detail moved out to `docs/guides/`.
- `docs/` reorganized: `docs/agents/` holds agent definitions only; `repo-map.md` and `decisions.md` moved to `docs/`.
- CI workflow renamed to `gate.yml` and now runs the full gate instead of the version gate alone.

### Fixed
- `check-version.sh` now reads the version from compact or minified JSON manifests.
- Executable bit restored on all shipped scripts (lost in an earlier upload).
