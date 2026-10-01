# 2. Enforce project rules with Claude Code hooks instead of convention-only text

## Status

Accepted

## Context

Several rules in `AGENTS.md` and `AGENT_TEAM.md` were enforced only by convention: an
agent reads the text and is expected to follow it, but nothing stops it from doing
otherwise. Two concrete examples: "agents never bump `VERSION` or create tags on
their own" and the worktree-first push flow implicitly assumes no one force-pushes.
Convention-only rules depend on the model remembering and choosing to comply every
time; they can't be verified mechanically, and a rule that's violated once in a
hundred runs is still a rule that failed.

Claude Code's hooks (`.claude/settings.json`) run as deterministic shell commands at
fixed points in the agent's lifecycle (`PreToolUse` and others) and apply regardless
of what the model decides — including in permission modes that would otherwise skip
the prompt. They are the mechanism the tool itself provides for exactly this gap.

Separately, `docs/guides/security.md` was referenced from `AGENTS.md` as "read this
when touching auth/data/uploads/payments," but loading it depended on the agent
choosing to open the file. Claude Code's `.claude/rules/` with path-scoped frontmatter
loads a file automatically when a matching path is touched, which is a better fit for
that guide specifically than a text pointer.

## Decision

Add `.claude/settings.json` with two `PreToolUse` hooks:

- `protect-version.sh` — blocks any `Edit`/`Write` tool call on `VERSION`, and blocks
  introducing a new release heading in `CHANGELOG.md` via `Edit`/`Write`. The
  sanctioned release path (`.claude/skills/semver-release/scripts/bump.sh`) still
  works because it writes through the shell, not through `Edit`/`Write`.
- `block-force-push.sh` — blocks any `git push` containing `--force`,
  `--force-with-lease`, or `-f`.

Add `.claude/rules/security.md`: a short, path-scoped rule (auth/api/routes/
middleware/payment/webhook/upload/migrations/`.sql`/`.env*` patterns) that points at
`docs/guides/security.md` instead of duplicating it, so the checklist loads at the
moment it's relevant instead of depending on the agent choosing to open it.

Add `.mcp.json.example` at the project root: a template for projects that want to
commit shared MCP server configuration (the starter itself depends on none).

## Consequences

Easier: the version/tag and force-push rules are now enforced the same way
regardless of which agent, model, or permission mode is running, and a lapse shows
up as a blocked tool call with an explanatory message instead of a silent miss. The
security guide now loads itself at the right moment instead of relying on memory.

Harder: hooks are shell scripts that ship with the template and need testing like
any other script (see their inline tests run before this ADR was written — covered
manually, not yet under `scripts/gate.sh`). The path patterns in
`.claude/rules/security.md` are heuristic — the starter is stack-agnostic, so they
will both miss some security-sensitive files and fire on some that aren't; the rule
says so explicitly rather than implying precision it doesn't have. A hook that's
wrong blocks real work until someone fixes the script, which is a sharper failure
mode than a convention that's merely ignored.
