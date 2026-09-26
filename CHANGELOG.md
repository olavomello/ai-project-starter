# Changelog

All notable changes to ai-project-starter are documented here.
The format follows Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]
### Added
- `scripts/gate.sh`: single verification entrypoint (format, lint, types, tests, version gate) with stack auto-detection and `.agents/gate.conf` overrides.
- Engineering baseline in AGENTS.md: commit convention, test policy, security summary, scope limits, project knobs.
- Precedence rule placing AGENTS.md above installed plugins.
- `docs/agents/security.md`, `docs/agents/efficiency.md`, `docs/agents/delegation.md`.

### Changed
- AGENTS.md restructured to 104 lines; detail moved to `docs/agents/`.
- CI workflow now runs the full gate instead of the version gate alone.

### Fixed
- `check-version.sh` now reads the version from compact or minified JSON manifests.
- AGENTS.md section 6: external skills table (`dataviz`, `frontend-design`, `skill-creator`, `deep-research`) referenced rather than vendored; charts routed through `dataviz`.
- README: quick-start walkthrough (create, configure, gate, push, work) and a skills section.
- `AGENT_TEAM.md`: charter for agents creating agents — `auto_agents` flag, spawn tests, depth/concurrency limits, naming, lifecycle, anti-clobber protocol.
- `scripts/agent-team.sh`: `new`, `list`, `claim`, `release`, `sync`, `check` with atomic claims and overlap detection; wired into `scripts/gate.sh`.
- `docs/agents/_TEMPLATE.md` and AGENTS.md section 7.

### Changed
- `docs/` reorganized: `docs/agents/` now holds agent definitions only; guides moved to `docs/guides/`; `repo-map.md` and `decisions.md` moved to `docs/`.
- `main_merge` flag asked at plan time, alongside `auto_agents`.
- Worktree-first isolation: `agent-team.sh start | sync | finish | cleanup`, with rebase onto `main`, gate before push, and automatic PR creation via `gh` when available.
- `agent-team.sh classify`: rates a branch `mechanical` or `administrator` from the diff (sensitive-path list, docs/tests-only rule, 400-line cap).
