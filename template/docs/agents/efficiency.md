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
| `docs/agents/repo-map.md` | Directory map, entry points, key modules (≤150 lines) | Structure changes; the header records the git SHA it was built from |
| `docs/agents/decisions.md` | One line per durable decision, with date | Never — append only |
| `.agents/state/<task-id>.md` | Task handoff: goal, done, next, open questions, files touched | Task closed (delete the file) |

`docs/agents/` is committed. `.agents/state/` is local and git-ignored.

## Measuring

Track per task: tool calls, tokens in/out, cache read ratio, wall time, and whether the gate passed first try. A rising token count with a flat first-try pass rate means the context is bloated, not that the work got harder.
