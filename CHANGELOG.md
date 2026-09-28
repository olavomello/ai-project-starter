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
- `scripts/ai-log.mjs` and `scripts/ai-report.mjs` (Node, zero-dependency, cross-platform): append-only execution log and aggregation into `dashboard/data.json`.
- `docs/tasks.md`: fixed task taxonomy — keeps aggregates comparable and keeps client names out of a publishable dashboard.
- `dashboard/`: dependency-free static monitoring page (tokens, cache reuse, gate first-pass rate, cost, per-agent activity) with light/dark themes, hover tooltips and table views; deployable to Vercel with no build step.
- `docs/model-prices.json`: user-filled price table; cost is not shown until it is filled.
- AGENTS.md section 4 now requires a log line per substantial task; `docs/guides/efficiency.md` explains how to read each metric.
- Dashboard redesign: dark-first theme (matches common monitoring-dashboard conventions), stat tiles with inline sparklines and day-over-day deltas, a "recent executions" table, badge-style gate/status indicators.
- `ai-report.mjs` now emits `recent` (last 10 executions — task type, agent, model, gate, tokens; no prompts or paths) for the new table.
- Part-to-whole breakdown switched from a plain bar to a single segmented share bar (donut avoided — deprioritized for part-to-whole per the dataviz skill; a stacked/segmented bar carries the comparison better).
- `dashboard/README.md`: step-by-step for Vercel Deployment Protection (password gate, no code, no database) and a note on IP allowlisting as an additional layer.
- Fixed: a share-bar segment's `class="hit"` was silently overridden by the CSS rule that makes hover-catcher rectangles transparent, hiding the colored strip.
- Fixed: sparkline SVGs had no explicit width, so the generic `svg { width: 100% }` rule expanded them to the flex row's full width and overflowed the tile on narrow screens.
