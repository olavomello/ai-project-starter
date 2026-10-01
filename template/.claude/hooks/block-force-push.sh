#!/bin/bash
# PreToolUse hook (Bash) — blocks `git push --force` / `-f`.
# Worktree-first isolation (AGENTS.md section 2 / AGENT_TEAM.md) assumes every
# push lands as a rebase-then-push onto a reviewed branch; a force-push can
# silently discard a commit someone else is working from. This is a
# technical guardrail, not a judgment call — it applies regardless of which
# agent or permission mode is running.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ "$COMMAND" =~ git[[:space:]]+push ]] && [[ "$COMMAND" =~ (--force|--force-with-lease|[[:space:]]-f([[:space:]]|$)) ]]; then
  echo "Blocked: force-push is not allowed through this hook. Rebase onto the target branch and push normally; if history genuinely needs rewriting, that's an Administrator decision made outside the agent loop." >&2
  exit 2
fi

exit 0
