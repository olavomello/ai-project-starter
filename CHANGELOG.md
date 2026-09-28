# Changelog

All notable changes to ai-project-starter are documented here.
The format follows Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]
### Added
- Automatic execution logging: `scripts/gate.sh` now calls `ai-log.mjs` and `ai-report.mjs` itself at the end of every run (pass or fail), so `ai-dash/data.json` is always current without any agent having to remember a manual step. Never affects the gate's own pass/fail result (best-effort, errors swallowed).
- `AILOG_*` environment-variable convention (`AILOG_TASK_TYPE`, `AILOG_AGENT`, `AILOG_MODEL`, `AILOG_SIZE`, `AILOG_TOKENS_IN`, `AILOG_TOKENS_OUT`, `AILOG_CACHE_READ`, `AILOG_CACHE_WRITE`, `AILOG_TOOL_CALLS`, `AILOG_DURATION`, `AILOG_PR`, `AILOG_OUTCOME`) so an agent can export richer data before running the gate instead of calling `ai-log.mjs` separately; `ai-log.mjs` accepts the same fields as flags too, flag wins over env var.
- `gate_first_try` is now tracked automatically per branch, under `.agents/state/gate-attempts/`: a fail increments the counter, a pass resets it, and the log records whether *this* run was a clean first pass.
- `.agents/README.md`: explains what actually lives in `.agents/` (worktrees, locks, the raw log, local state) and that it is deliberately separate from `docs/agents/`, which holds the committed agent roster.
- `ai-dash/index.html`: animated loading indicator ([thinking-orbs-universal](https://libraries.dev/orbs), loaded from jsDelivr via `import()`, no bundler) replaces the plain "loading…" text while `data.json` fetches and the "no data yet" empty state; degrades to text if the CDN is unreachable.
- `cli/`: zero-dependency Node CLI (`init`, `update`, `adopt`, `doctor`) wrapping `template/`. `init` needs only `git` and `node` — no `bash` — so it works the same on Windows as `init-project.sh` doesn't. `update` pulls starter improvements into an already-created project via a manifest-tracked, content-hash three-way diff: a file only changes automatically when the project never touched it since the last sync; anything else is left alone with `<file>.incoming` written for manual review. `AGENTS.md`, `AGENT_TEAM.md`, `VERSION`, `CHANGELOG.md`, `docs/model-prices.json` and `docs/agents/**` are never auto-applied. Not published to npm yet (`npx github:olavomello/ai-project-starter#main cli <command>` works without publishing).

### Changed
- Dashboard folder renamed `dashboard/` → `ai-dash/` (script, docs and generated `data.json` all moved with it) so it doesn't collide with a `dashboard/` folder a project built on this starter might already have for its own product.
- `scripts/ai-log.mjs` and `scripts/ai-report.mjs` resolve the log and `ai-dash/data.json` against the repo's shared root (`git rev-parse --git-common-dir`) instead of the current working directory, so every git worktree of a project writes to the same files instead of fragmenting the data.
- AGENTS.md section 4, `docs/guides/efficiency.md` and `ai-dash/README.md` updated to describe the automatic logging and the `AILOG_*` convention; the old "every task ends with a manual log line" instruction is gone.
- AGENT_TEAM.md and AGENTS.md section 7 now state explicitly, up front, that agent definitions live in `docs/agents/` and `.agents/` is unrelated runtime state — the split was previously implicit and easy to miss.
- `ai-dash/index.html`: header logo swapped for the same bar-chart glyph as the favicon (was an unrelated gradient dot); "Theme" text button replaced with a sun/moon icon toggle; the "Aggregates only — no prompts, file paths or source content are recorded" footer note removed from the page (the guarantee itself is unchanged and still documented in `ai-dash/README.md` and the root README).

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
