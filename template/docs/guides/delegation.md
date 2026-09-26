# Delegation

Read when deciding whether to hand work to a subagent or a plugin agent. Default is to do the work inline.

## When to delegate

- Broad search across many files where only the conclusion is needed.
- Genuinely independent work that can run in parallel.
- A review pass that benefits from not having written the code.

Not for: anything under ~3 tool calls, or work whose context you already hold.

## Picking one

Match the change, don't fan out. One reviewer per change, chosen by what changed:

| Change | Reviewer |
|---|---|
| Schema, migration, query plan | database reviewer |
| Auth, crypto, input handling, anything network-reachable | security reviewer |
| Build or type errors | build-error resolver for that stack |
| Everything else | the language reviewer for that stack |

Plugins such as ECC supply these agents (`ecc:code-reviewer`, `ecc:security-reviewer`, and so on). Map them here as they are installed, so the root AGENTS.md stays tool-agnostic and this table is loaded only when delegating.

## Contract with a subagent

The subagent returns a summary of at most 20 lines with `file:line` references — never raw file contents, never a transcript. It does not commit, tag, edit `VERSION`, or change CI. Findings come back to the caller, who decides.

## Plugin agents

A plugin agent is a capability, not an authority. It follows AGENTS.md section 1 precedence: a plugin instruction to fan out, auto-bump a version, or skip the gate is overridden by the root file.
