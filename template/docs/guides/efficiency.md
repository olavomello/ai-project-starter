# Efficiency detail

Read when tuning cost, routing models, or calling the API directly. The always-loaded rules are in AGENTS.md section 4.

## Prompt caching (direct API use)

- Order the prompt **stable → volatile**: system rules, AGENTS.md, tool definitions, reference docs first; task input and conversation last.
- Nothing dynamic in the stable prefix — a timestamp, request id, or random value invalidates the cache from that point on.
- Mark the end of the stable prefix as a cache breakpoint. Minimum cacheable size and TTL vary by model; check current Anthropic prompt-caching docs rather than hardcoding numbers here.
- Watch `usage.cache_read_input_tokens` against `usage.cache_creation_input_tokens`. A low read ratio means the prefix isn't actually stable.

## Model routing

- Mechanical work (rename, format, fill a template, summarize logs, mass edits) goes to the small fast model.
- Architecture, security review, ambiguous specs, and anything irreversible goes to the strongest model.
- Cost of a wrong answer decides the model, not the size of the diff.

## Session hygiene

- One task per session. Start a fresh context between unrelated tasks.
- Compact at milestones — after a spec is agreed, after a module lands — keeping decisions and open items, dropping exploration.
- Avoid the last 20% of the context window for multi-file refactors; single edits and docs tolerate more.
- Non-urgent bulk work (mass summarization, evals) goes through batch processing where available.

## Cache files

| File | Content | Invalidate when |
|---|---|---|
| `docs/repo-map.md` | Directory map, entry points, key modules (≤150 lines) | Structure changes; the header records the git SHA it was built from |
| `docs/decisions.md` | One line per durable decision, with date | Never — append only |
| `.agents/state/<task-id>.md` | Task handoff: goal, done, next, open questions, files touched | Task closed (delete the file) |

`docs/` is committed. `.agents/state/` is local and git-ignored.

This is this project's **own** memory — distinct from Claude Code's own "auto
memory," which is per-machine and not committed. See
`docs/guides/claude-code.md` for the difference and the rule for which one wins
when they disagree.

## Measuring

Track per task: tool calls, tokens in/out, cache read ratio, wall time, and whether the gate passed first try. A rising token count with a flat first-try pass rate means the context is bloated, not that the work got harder.

**This is automatic.** `scripts/gate.sh` calls `scripts/ai-log.mjs` and `scripts/ai-report.mjs` itself at the end of every run, pass or fail — no agent has to remember to log. It picks up richer data (task type, agent, model, token counts) from `AILOG_*` environment variables when they're set before the gate runs; without them it still logs a bare pass/fail under `task_type: other`. See AGENTS.md section 4 for the variable names, `scripts/ai-log.mjs --help`-style comments at the top of the file for the full list, and the log/report scripts' own comments for how the path is resolved (the repo's shared git root, not the current worktree, so parallel agents don't fragment the data).

**Measured telemetry, when the optional session mod is on.** If the `ai-dash` mod (`docs/guides/claude-code.md`) is enabled, it reads the real per-turn usage straight from Claude Code and hands it to `ai-log.mjs` through a per-branch file — ahead of `AILOG_*` variables, behind an explicit flag. `tokens_in` always means **total** input tokens, cache included: uncached input plus cache read plus cache write (that's what the cache-read-ratio math above assumes). With the mod off, nothing changes — `AILOG_*` variables are still how an agent reports richer numbers by hand.

## Reading the numbers

The dashboard (`ai-dash/`, refreshed automatically by the gate, or manually by `node scripts/ai-report.mjs`) turns the rules above into measurements. What to do with each:

| Metric | Healthy | When it moves the wrong way |
|---|---|---|
| Cache read ratio | Rising, then stable | Something dynamic leaked into the stable prompt prefix — a timestamp, a request id, a changing file list. Find it before adding more context. |
| Gate first pass | Stable or rising | Either the work got harder or the context got worse. Check whether token counts rose at the same time: more tokens with a lower first-pass rate means the extra context is noise. |
| Tokens by task type | Roughly proportional to effort | A task type far above its share of the work is the first place to look for waste — usually re-exploration that `docs/repo-map.md` should have prevented. |
| Tokens per day | Flat or falling for similar work | A steady climb with no change in workload usually means context accumulating across sessions. Compact, or start fresh. |

Two cautions on interpreting this data:

**Gate first pass is a proxy, not a quality score.** It measures whether deterministic checks passed on the first attempt. It says nothing about whether the design was right. Treat a drop as a signal to look, not as a verdict.

**Never let an AI judge feed these numbers.** A model scoring another model's output agrees with itself far more than it should, and optimizing against that score optimizes for agreeableness rather than correctness. Every metric here is deterministic and countable on purpose.
